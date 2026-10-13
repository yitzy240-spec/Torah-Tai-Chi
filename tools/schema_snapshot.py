#!/usr/bin/env python3
"""Build (or check) tests/schema/schema_snapshot.json from the migrations.

The snapshot is the schema the pipeline's write payloads are validated
against — offline by tests/fakes/fake_supabase.py, and against real
Postgres by the `db`-marked tests in the db-schema CI job. It exists
because PR #15 shipped a partial clips upsert that violated NOT NULL and
only failed in prod: every test mocked Supabase, so nothing ever compared
a payload to the real schema.

Replay order (each file in its own implicit transaction):
  1. tests/schema/bootstrap.sql            Supabase shims (auth, roles, publication)
  2. dashboard/supabase/migrations/*.sql   lexical order, each preceded by
     tests/schema/before/<same name>.sql  if present (replay-order shims)
  3. tests/schema/prod_drift.sql           prod objects no migration creates

Usage (needs an EMPTY scratch Postgres — never point this at Supabase):
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \\
    python tools/schema_snapshot.py --apply --write    # regenerate
    python tools/schema_snapshot.py --apply --check    # CI: fail if stale

--check compares structurally and prints a per-table diff; exit 1 on drift.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "dashboard" / "supabase" / "migrations"
SCHEMA_DIR = ROOT / "tests" / "schema"
SNAPSHOT_PATH = SCHEMA_DIR / "schema_snapshot.json"
BOOTSTRAP = SCHEMA_DIR / "bootstrap.sql"
BEFORE_DIR = SCHEMA_DIR / "before"
PROD_DRIFT = SCHEMA_DIR / "prod_drift.sql"

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", ""}


def replay_plan() -> list[tuple[str, Path]]:
    """Ordered (label, path) list of every SQL file the replay applies."""
    plan: list[tuple[str, Path]] = [("bootstrap", BOOTSTRAP)]
    for mig in sorted(MIGRATIONS_DIR.glob("*.sql")):
        shim = BEFORE_DIR / mig.name
        if shim.exists():
            plan.append((f"before/{mig.name}", shim))
        plan.append((mig.name, mig))
    plan.append(("prod_drift", PROD_DRIFT))
    return plan


def _guard_scratch_db(url: str) -> None:
    host = urlparse(url).hostname or ""
    if host not in LOCAL_HOSTS and not os.environ.get("SCHEMA_SNAPSHOT_ALLOW_REMOTE"):
        sys.exit(
            f"refusing to touch non-local database host {host!r} — this tool "
            f"DDLs its target. Use a scratch Postgres (set "
            f"SCHEMA_SNAPSHOT_ALLOW_REMOTE=1 only for a disposable remote DB)."
        )


def apply_migrations(conn) -> None:
    exists = conn.execute(
        "select count(*) from information_schema.tables where table_schema = 'public'"
    ).fetchone()[0]
    if exists:
        sys.exit(
            f"refusing to --apply: public schema already has {exists} tables "
            f"(need an empty scratch database)"
        )
    for label, path in replay_plan():
        sql = path.read_text(encoding="utf-8")
        try:
            # No params -> simple-query protocol: the whole file runs as one
            # implicit transaction, like `psql -1 -f`.
            conn.execute(sql)
        except Exception as e:
            sys.exit(f"replay failed at {label}: {type(e).__name__}: {e}")
        print(f"applied {label}")


def introspect(conn) -> dict:
    tables: dict[str, dict] = {}
    for table, col, udt, nullable, default in conn.execute(
        """
        select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        """
    ).fetchall():
        t = tables.setdefault(
            table, {"checks": {}, "columns": {}, "foreign_keys": [], "unique": []})
        t["columns"][col] = {
            "default": default, "nullable": nullable == "YES", "type": udt,
        }
    for table, name, contype, definition, cols in conn.execute(
        """
        select rel.relname, con.conname, con.contype::text,
               pg_get_constraintdef(con.oid),
               array(select a.attname::text
                     from unnest(con.conkey) with ordinality k(attnum, ord)
                     join pg_attribute a
                       on a.attrelid = con.conrelid and a.attnum = k.attnum
                     order by k.ord)
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace n on n.oid = rel.relnamespace
        where n.nspname = 'public' and con.contype in ('c', 'u', 'p')
        """
    ).fetchall():
        if table not in tables:
            continue
        if contype == "c":
            tables[table]["checks"][name] = definition
        else:
            tables[table]["unique"].append(list(cols))
    # Foreign keys into public tables (auth.users etc. are Supabase-owned
    # and not modelled by the fake).
    for table, cols, ref_table, ref_cols in conn.execute(
        """
        select rel.relname,
               array(select a.attname::text
                     from unnest(con.conkey) with ordinality k(attnum, ord)
                     join pg_attribute a
                       on a.attrelid = con.conrelid and a.attnum = k.attnum
                     order by k.ord),
               ref.relname,
               array(select a.attname::text
                     from unnest(con.confkey) with ordinality k(attnum, ord)
                     join pg_attribute a
                       on a.attrelid = con.confrelid and a.attnum = k.attnum
                     order by k.ord)
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace n on n.oid = rel.relnamespace
        join pg_class ref on ref.oid = con.confrelid
        join pg_namespace rn on rn.oid = ref.relnamespace
        where n.nspname = 'public' and rn.nspname = 'public'
          and con.contype = 'f'
        """
    ).fetchall():
        if table in tables:
            tables[table]["foreign_keys"].append({
                "columns": list(cols), "ref_table": ref_table,
                "ref_columns": list(ref_cols),
            })
    for t in tables.values():
        t["unique"].sort()
        t["foreign_keys"].sort(key=lambda fk: (fk["columns"], fk["ref_table"]))
    enums = {
        name: list(labels)
        for name, labels in conn.execute(
            """
            select t.typname::text,
                   array_agg(e.enumlabel::text order by e.enumsortorder)
            from pg_type t
            join pg_enum e on e.enumtypid = t.oid
            join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = 'public'
            group by t.typname
            """
        ).fetchall()
    }
    return {"enums": enums, "tables": tables}


def render(snapshot: dict) -> str:
    return json.dumps(snapshot, indent=2, sort_keys=True) + "\n"


def diff(committed: dict, fresh: dict) -> list[str]:
    """Human-readable structural differences (committed -> fresh)."""
    out: list[str] = []
    ce, fe = committed.get("enums", {}), fresh.get("enums", {})
    for name in sorted(set(ce) | set(fe)):
        if ce.get(name) != fe.get(name):
            out.append(f"enum {name}: {ce.get(name)} -> {fe.get(name)}")
    ct, ft = committed.get("tables", {}), fresh.get("tables", {})
    for table in sorted(set(ct) | set(ft)):
        if table not in ft:
            out.append(f"table {table}: only in committed snapshot")
            continue
        if table not in ct:
            out.append(f"table {table}: only in migrations")
            continue
        a, b = ct[table], ft[table]
        for col in sorted(set(a["columns"]) | set(b["columns"])):
            if a["columns"].get(col) != b["columns"].get(col):
                out.append(
                    f"{table}.{col}: {a['columns'].get(col)} -> {b['columns'].get(col)}"
                )
        for name in sorted(set(a["checks"]) | set(b["checks"])):
            if a["checks"].get(name) != b["checks"].get(name):
                out.append(
                    f"{table} check {name}: {a['checks'].get(name)} -> {b['checks'].get(name)}"
                )
        if sorted(a["unique"]) != sorted(b["unique"]):
            out.append(f"{table} unique: {a['unique']} -> {b['unique']}")
        if a.get("foreign_keys", []) != b.get("foreign_keys", []):
            out.append(
                f"{table} foreign_keys: {a.get('foreign_keys')} -> {b.get('foreign_keys')}"
            )
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--apply", action="store_true",
                    help="replay bootstrap + migrations + drift into an EMPTY db first")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="write the snapshot file")
    mode.add_argument("--check", action="store_true",
                      help="exit 1 if the committed snapshot differs")
    ap.add_argument("--out", type=Path, default=SNAPSHOT_PATH)
    args = ap.parse_args(argv)

    if not args.database_url:
        ap.error("DATABASE_URL (or --database-url) is required")
    _guard_scratch_db(args.database_url)

    import psycopg  # dev extra; imported late so --help works without it

    with psycopg.connect(args.database_url, autocommit=True) as conn:
        if args.apply:
            apply_migrations(conn)
        fresh = introspect(conn)

    if args.write:
        args.out.write_text(render(fresh), encoding="utf-8")
        print(f"wrote {args.out}")
        return 0

    committed = json.loads(args.out.read_text(encoding="utf-8"))
    problems = diff(committed, fresh)
    if problems:
        print(f"{args.out} is out of date with the migrations:")
        for p in problems:
            print(f"  - {p}")
        print("Regenerate: python tools/schema_snapshot.py --apply --write "
              "(against an empty scratch Postgres) and commit the result. "
              "If the change is prod drift, fix it in tests/schema/prod_drift.sql "
              "or a new migration — never by editing an applied migration.")
        return 1
    print(f"{args.out} matches the migrations "
          f"({len(fresh['tables'])} tables).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
