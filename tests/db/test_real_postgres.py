"""Pipeline write payloads executed against REAL Postgres (CI db-schema job).

The db-schema job replays bootstrap + every migration + prod-drift shims
into a postgres:15 service (tools/schema_snapshot.py --apply), then runs
`pytest -m db`. Each case runs inside a transaction that is rolled back.

Payloads are built by the same helpers the pipeline uses and sent the way
PostgREST sends them: the JSON body is decoded with
json_populate_record(NULL::<table>, body) — PostgREST's own json->record
coercion, not per-value ::casts — and written with INSERT ... ON CONFLICT
(...) DO UPDATE for upserts (so NOT NULL is checked on the INSERT half —
the PR #15 failure mode). Filters (?col=eq.value) are text cast to the
column type, as PostgREST does.

Limit: the schema is migrations + tests/schema/prod_drift.sql shims, not a
dump of prod, so prod-only drift is caught only as far as the shims go.

Skips cleanly when DATABASE_URL is unset or psycopg isn't installed, so
the plain python CI job and local runs are unaffected.
"""
from __future__ import annotations

import json
import os

import pytest

from tests.db_write_cases import CASES, CODE_TO_OUTCOME, OK, SEED_ROWS, Case
from tests.fakes.fake_supabase import load_snapshot
from tests.test_db_write_payloads import run_case_on_fake

pytestmark = pytest.mark.db

DATABASE_URL = os.environ.get("DATABASE_URL")
psycopg = pytest.importorskip("psycopg") if DATABASE_URL else None

if not DATABASE_URL:
    pytest.skip("DATABASE_URL not set — real-Postgres schema tests skipped",
                allow_module_level=True)

from psycopg import sql  # noqa: E402

SNAPSHOT = load_snapshot()


def _sql_type(udt: str) -> str:
    return f"{udt[1:]}[]" if udt.startswith("_") else udt


def _filter_param(table: str, col: str, value):
    """(placeholder, value) for a WHERE filter: PostgREST sends filter
    values as text and casts them to the column type."""
    spec = SNAPSHOT["tables"][table]["columns"].get(col)
    if spec is None:
        return sql.Placeholder(), value
    typ = _sql_type(spec["type"])
    return sql.SQL("{}::{}").format(sql.Placeholder(), sql.SQL(typ)), value


def _body(table: str, cols: list[str]) -> sql.Composable:
    """SELECT <cols> FROM json_populate_record(NULL::<table>, %s::json).
    An unknown column raises 42703 (PostgREST: PGRST204)."""
    return sql.SQL("SELECT {} FROM json_populate_record(NULL::{}, {}::json)").format(
        sql.SQL(", ").join(map(sql.Identifier, cols)),
        sql.Identifier(table), sql.Placeholder(),
    )


def _execute(conn, table: str, op: str, payload: dict, on_conflict: str | None = None,
             where: dict | None = None) -> None:
    cols = list(payload)
    values = [json.dumps(payload)]
    if op in ("insert", "upsert"):
        q = sql.SQL("INSERT INTO {} ({}) ").format(
            sql.Identifier(table),
            sql.SQL(", ").join(map(sql.Identifier, cols)),
        ) + _body(table, cols)
        if op == "upsert":
            target = [c.strip() for c in (on_conflict or "").split(",") if c.strip()]
            updates = [c for c in cols if c not in target]
            q += sql.SQL(" ON CONFLICT ({}) ").format(
                sql.SQL(", ").join(map(sql.Identifier, target)))
            q += (sql.SQL("DO UPDATE SET {}").format(sql.SQL(", ").join(
                sql.SQL("{0} = EXCLUDED.{0}").format(sql.Identifier(c)) for c in updates))
                if updates else sql.SQL("DO NOTHING"))
    elif op == "update":
        where = where or {}
        wparams = [_filter_param(table, c, v) for c, v in where.items()]
        q = sql.SQL("UPDATE {} SET ({}) = ({}) WHERE {}").format(
            sql.Identifier(table),
            sql.SQL(", ").join(map(sql.Identifier, cols)),
            _body(table, cols),
            sql.SQL(" AND ").join(
                sql.SQL("{} = {}").format(sql.Identifier(c), p)
                for c, (p, _) in zip(where, wparams)),
        )
        values += [v for _, v in wparams]
    else:
        raise ValueError(op)
    conn.execute(q, values)


class _Rollback(Exception):
    pass


@pytest.fixture(scope="module")
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=True) as c:
        yield c


def run_case_on_postgres(conn, case: Case) -> str:
    outcome = OK
    try:
        with conn.transaction():
            for table, row in SEED_ROWS:
                _execute(conn, table, "insert", row)
            try:
                with conn.transaction():  # savepoint: isolate the case's error
                    _execute(conn, case.table, case.op, case.payload,
                             case.on_conflict, case.where)
            except psycopg.Error as e:
                outcome = CODE_TO_OUTCOME.get(e.sqlstate, f"unmapped:{e.sqlstate}: {e}")
            raise _Rollback
    except _Rollback:
        pass
    return outcome


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_write_case_on_postgres(conn, case):
    assert run_case_on_postgres(conn, case) == case.expect


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_fake_agrees_with_postgres(conn, case):
    """Fidelity guard: if the fake accepts what Postgres rejects (or vice
    versa) the offline tests are lying — fix the fake."""
    assert run_case_on_fake(case) == run_case_on_postgres(conn, case)


def test_increment_job_cost_rpc_exists(conn):
    from tests.db_write_cases import JOB_ID
    try:
        with conn.transaction():
            for table, row in SEED_ROWS:
                _execute(conn, table, "insert", row)
            conn.execute("select increment_job_cost(%s::uuid, %s::numeric)", [JOB_ID, 2.87])
            total = conn.execute(
                "select total_cost_usd from jobs where id = %s::uuid", [JOB_ID]).fetchone()[0]
            assert float(total) == pytest.approx(2.87)
            raise _Rollback
    except _Rollback:
        pass
