"""Schema-validating in-memory stand-in for the supabase-py client.

Why: every pipeline test used to mock Supabase with permissive fakes, so
PR #15's partial clips upsert (missing NOT NULL voiceover / visual_prompt /
setting_id / duration_s) passed CI and lost 4 paid Kie renders in prod.
This fake validates every insert / upsert / update payload against
tests/schema/schema_snapshot.json (generated from the migrations) and
raises like postgrest's APIError with the Postgres error code:

  PGRST204  unknown column
  23502     NOT NULL column missing / null on INSERT or UPSERT
            (upsert is INSERT ... ON CONFLICT: the INSERT half must be a
            valid row even when the conflicting row already exists)
  23514     value outside a simple CHECK (col = ANY (ARRAY[...])) list
  22P02     value not in an enum (job_status) / not a uuid / not an integer
  42P10     on_conflict columns don't match a unique constraint
  23505     duplicate key on INSERT
  23503     foreign key into a public table points at no row

It also stores rows, so tests can read back what the pipeline wrote.
Supported query surface (what modal_app.py / src use): table().insert /
upsert / update / delete / select + eq / neq / in_ / is_ / order / limit /
single / maybe_single / execute, rpc().execute, storage.from_().upload.

Fidelity is checked against real Postgres in tests/db/test_real_postgres.py
(CI db-schema job): the same accept/reject matrix runs through both.
"""
from __future__ import annotations

import copy
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

SNAPSHOT_PATH = Path(__file__).resolve().parent.parent / "schema" / "schema_snapshot.json"

try:  # Raise the real class when supabase-py is installed (Modal image / dev).
    from postgrest.exceptions import APIError as _PostgrestAPIError
except Exception:  # pragma: no cover - depends on the environment
    class _PostgrestAPIError(Exception):  # type: ignore[no-redef]
        def __init__(self, error: dict):
            self._raw_error = error
            self.message = error.get("message")
            self.code = error.get("code")
            self.hint = error.get("hint")
            self.details = error.get("details")
            super().__init__(self.message)

        def json(self) -> dict:
            return self._raw_error


class APIError(_PostgrestAPIError):
    """postgrest.exceptions.APIError look-alike carrying a PG error code."""

    def __init__(self, code: str, message: str, details: str | None = None):
        super().__init__({"code": code, "message": message,
                          "details": details, "hint": None})
        self.code = code
        self.message = message

    def __str__(self) -> str:
        return f"{{'code': '{self.code}', 'message': {self.message!r}}}"


_IN_LIST = re.compile(r"^CHECK \(\((\w+) = ANY \(ARRAY\[(.*)\]\)\)\)$")
_LITERAL = re.compile(r"'((?:[^']|'')*)'::\w+")


def load_snapshot(path: Path = SNAPSHOT_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def simple_check_lists(table_schema: dict) -> dict[str, list[str]]:
    """{column: allowed values} for every `col = ANY (ARRAY[...])` CHECK."""
    out: dict[str, list[str]] = {}
    for definition in table_schema.get("checks", {}).values():
        m = _IN_LIST.match(definition)
        if m:
            out[m.group(1)] = [v.replace("''", "'") for v in _LITERAL.findall(m.group(2))]
    return out


class _Response:
    def __init__(self, data: Any, count: Optional[int] = None):
        self.data = data
        self.count = count


class FakeSupabase:
    """Drop-in for `supabase.create_client(...)` in unit tests."""

    def __init__(self, snapshot: Optional[dict] = None):
        self.schema = snapshot or load_snapshot()
        self.rows: dict[str, list[dict]] = {t: [] for t in self.schema["tables"]}
        self.writes: list[tuple[str, str, Any]] = []   # (table, op, payload)
        self.rpcs: list[tuple[str, dict]] = []
        self.uploads: list[tuple[str, str, int]] = []  # (bucket, path, nbytes)
        self.fail_next: dict[str, list[BaseException]] = {}  # table -> errors
        self.storage = _Storage(self)

    # -- supabase-py surface -------------------------------------------------
    def table(self, name: str) -> "_Query":
        if name not in self.schema["tables"]:
            raise APIError("42P01", f'relation "public.{name}" does not exist')
        return _Query(self, name)

    from_ = table

    def rpc(self, fn: str, params: dict) -> "_Rpc":
        return _Rpc(self, fn, params)

    # -- test helpers ----------------------------------------------------------
    def fail_on_next_write(self, table: str, *errors: BaseException) -> None:
        """Make the next len(errors) writes to `table` raise these (transient
        failure injection — validation still runs on later attempts)."""
        self.fail_next.setdefault(table, []).extend(errors)

    def seed(self, table: str, **row: Any) -> dict:
        """Insert a valid row (validated like any insert) and return it."""
        return self.table(table).insert(row).execute().data[0]

    # -- validation ----------------------------------------------------------
    def columns(self, table: str) -> dict:
        return self.schema["tables"][table]["columns"]

    def validate_row(self, table: str, row: dict, *, full_row: bool) -> None:
        cols = self.columns(table)
        for key in row:
            if key not in cols:
                raise APIError(
                    "PGRST204",
                    f"Could not find the '{key}' column of '{table}' in the schema cache",
                )
        for name, spec in cols.items():
            present = name in row
            value = row.get(name)
            if not spec["nullable"]:
                # INSERT half of insert/upsert: a missing column falls back to
                # its default; an explicit null never does.
                missing_no_default = full_row and not present and spec["default"] is None
                if missing_no_default or (present and value is None):
                    raise APIError(
                        "23502",
                        f'null value in column "{name}" of relation "{table}" '
                        f"violates not-null constraint",
                    )
            if present and value is not None:
                self._check_type(table, name, spec["type"], value)
        allowed = simple_check_lists(self.schema["tables"][table])
        for name, values in allowed.items():
            v = row.get(name)
            if v is not None and v not in values:
                raise APIError(
                    "23514",
                    f'new row for relation "{table}" violates check constraint '
                    f'"{table}_{name}_check" (value {v!r} not in {values})',
                )

    def _check_type(self, table: str, col: str, typ: str, v: Any) -> None:
        def bad(kind: str) -> APIError:
            return APIError("22P02", f'invalid input syntax for type {kind}: "{v}" ({table}.{col})')

        if typ in self.schema.get("enums", {}):
            if v not in self.schema["enums"][typ]:
                raise APIError("22P02", f'invalid input value for enum {typ}: "{v}"')
        elif typ == "uuid":
            try:
                uuid.UUID(str(v))
            except ValueError:
                raise bad("uuid") from None
        elif typ in ("int2", "int4", "int8"):
            # JSON 8.0 -> PG integer input "8.0" is rejected; so are bools.
            if isinstance(v, bool) or not isinstance(v, int):
                raise bad("integer")
        elif typ == "numeric":
            if isinstance(v, bool) or not isinstance(v, (int, float, str)):
                raise bad("numeric")
            try:
                float(v)
            except ValueError:
                raise bad("numeric") from None
        elif typ == "bool":
            if not isinstance(v, bool):
                raise bad("boolean")
        elif typ in ("text", "varchar"):
            if not isinstance(v, str):
                raise bad("text")
        elif typ in ("timestamptz", "timestamp", "date"):
            if not isinstance(v, (str, datetime)):
                raise bad(typ)
        elif typ.startswith("_"):
            if not isinstance(v, list):
                raise APIError("22P02", f'malformed array literal: "{v}" ({table}.{col})')
            for item in v:
                if item is not None:
                    self._check_type(table, col, typ[1:], item)
        elif typ in ("json", "jsonb"):
            try:
                json.dumps(v)
            except (TypeError, ValueError):
                raise bad(typ) from None

    def check_foreign_keys(self, table: str, row: dict) -> None:
        """23503 if a non-null FK value has no matching referenced row
        (FKs into auth.* aren't in the snapshot, so aren't checked)."""
        for fk in self.schema["tables"][table].get("foreign_keys", []):
            vals = [row.get(c) for c in fk["columns"]]
            if any(v is None for v in vals):
                continue  # MATCH SIMPLE: any NULL column skips the check
            ref_cols = fk["ref_columns"]
            if not any(
                all(str(r.get(rc)) == str(v) for rc, v in zip(ref_cols, vals))
                for r in self.rows[fk["ref_table"]]
            ):
                raise APIError(
                    "23503",
                    f'insert or update on table "{table}" violates foreign key '
                    f'({", ".join(fk["columns"])}) -> {fk["ref_table"]}'
                    f'({", ".join(ref_cols)}): {vals} not present',
                )

    def unique_sets(self, table: str) -> list[list[str]]:
        return self.schema["tables"][table]["unique"]

    def materialize(self, table: str, row: dict) -> dict:
        """Apply column defaults the way Postgres would on INSERT."""
        out = {}
        for name, spec in self.columns(table).items():
            if name in row:
                out[name] = row[name]
            else:
                out[name] = _eval_default(spec["default"])
        return out


def _eval_default(default: Optional[str]) -> Any:
    if default is None:
        return None
    if default == "gen_random_uuid()":
        return str(uuid.uuid4())
    if default == "now()":
        return datetime.now(timezone.utc).isoformat()
    if default in ("true", "false"):
        return default == "true"
    m = re.match(r"^'(.*)'::(\w+)$", default, re.S)
    if m:
        lit, typ = m.group(1).replace("''", "'"), m.group(2)
        return json.loads(lit) if typ in ("json", "jsonb") else lit
    try:
        return int(default)
    except ValueError:
        try:
            return float(default)
        except ValueError:
            return default


class _Rpc:
    def __init__(self, sb: FakeSupabase, fn: str, params: dict):
        self.sb, self.fn, self.params = sb, fn, params

    def execute(self) -> _Response:
        self.sb.rpcs.append((self.fn, self.params))
        if self.fn == "increment_job_cost":
            for job in self.sb.rows.get("jobs", []):
                if job["id"] == self.params.get("j_id"):
                    job["total_cost_usd"] = float(job.get("total_cost_usd") or 0) + float(
                        self.params.get("delta") or 0)
        return _Response(None)


class _Storage:
    def __init__(self, sb: FakeSupabase):
        self.sb = sb

    def from_(self, bucket: str) -> "_Bucket":
        return _Bucket(self.sb, bucket)


class _Bucket:
    def __init__(self, sb: FakeSupabase, bucket: str):
        self.sb, self.bucket = sb, bucket

    def upload(self, path: str, data: bytes, file_options: Optional[dict] = None) -> dict:
        self.sb.uploads.append((self.bucket, path, len(data)))
        return {"Key": f"{self.bucket}/{path}"}


class _Query:
    def __init__(self, sb: FakeSupabase, table: str):
        self.sb, self.table_name = sb, table
        self.op = "select"
        self.payload: Any = None
        self.on_conflict: Optional[str] = None
        self.filters: list = []
        self._single: Optional[str] = None
        self._limit: Optional[int] = None

    # ---- verbs ----
    def select(self, *_cols, **_kw) -> "_Query":
        if self.op not in ("insert", "upsert", "update", "delete"):
            self.op = "select"
        return self

    def insert(self, rows, **_kw) -> "_Query":
        self.op, self.payload = "insert", rows
        return self

    def upsert(self, rows, on_conflict: Optional[str] = None, **_kw) -> "_Query":
        self.op, self.payload, self.on_conflict = "upsert", rows, on_conflict
        return self

    def update(self, values: dict, **_kw) -> "_Query":
        self.op, self.payload = "update", values
        return self

    def delete(self, **_kw) -> "_Query":
        self.op = "delete"
        return self

    # ---- filters ----
    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals: Iterable):
        vals = list(vals)
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def is_(self, col, val):
        if val in (None, "null"):
            self.filters.append(lambda r: r.get(col) is None)
        else:
            target = {"true": True, "false": False}.get(val, val)
            self.filters.append(lambda r: r.get(col) == target)
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    def single(self):
        self._single = "single"
        return self

    def maybe_single(self):
        self._single = "maybe"
        return self

    # ---- execution ----
    def _matching(self) -> list[dict]:
        rows = [r for r in self.sb.rows[self.table_name] if all(f(r) for f in self.filters)]
        return rows[: self._limit] if self._limit is not None else rows

    def execute(self):
        sb, table = self.sb, self.table_name
        if self.op in ("insert", "upsert", "update", "delete"):
            sb.writes.append((table, self.op, copy.deepcopy(self.payload)))
            pending = sb.fail_next.get(table)
            if pending:
                raise pending.pop(0)
        if self.op == "select":
            rows = [copy.deepcopy(r) for r in self._matching()]
            if self._single == "maybe":
                return _Response(rows[0]) if rows else None  # supabase-py quirk
            if self._single == "single":
                if len(rows) != 1:
                    raise APIError("PGRST116", f"JSON object requested, {len(rows)} rows returned")
                return _Response(rows[0])
            return _Response(rows)
        if self.op == "delete":
            gone = self._matching()
            sb.rows[table] = [r for r in sb.rows[table] if r not in gone]
            return _Response(gone)
        if self.op == "update":
            sb.validate_row(table, self.payload, full_row=False)
            hit = self._matching()
            for r in hit:
                sb.check_foreign_keys(table, {**r, **self.payload})
            for r in hit:
                r.update(copy.deepcopy(self.payload))
            return _Response([copy.deepcopy(r) for r in hit])
        return self._insert_or_upsert()

    def _insert_or_upsert(self) -> _Response:
        sb, table = self.sb, self.table_name
        rows = self.payload if isinstance(self.payload, list) else [self.payload]
        # supabase-py bulk writes default to default_to_null=True: PostgREST
        # takes the union of keys and sends NULL for any key a row lacks.
        keys = set().union(*(r.keys() for r in rows)) if rows else set()
        rows = [{k: r.get(k) for k in keys} for r in rows]
        conflict: Optional[list[str]] = None
        if self.op == "upsert":
            uniques = sb.unique_sets(table)
            conflict = ([c.strip() for c in self.on_conflict.split(",")]
                        if self.on_conflict else (uniques[0] if uniques else []))
            if sorted(conflict) not in [sorted(u) for u in uniques]:
                raise APIError(
                    "42P10",
                    "there is no unique or exclusion constraint matching the "
                    f"ON CONFLICT specification ({table}: {conflict})",
                )
        for row in rows:  # one statement: validate everything before writing
            sb.validate_row(table, row, full_row=True)
        out = []
        for row in rows:
            existing = None
            if conflict is not None:
                existing = next(
                    (r for r in sb.rows[table]
                     if all(r.get(c) == row.get(c) and row.get(c) is not None for c in conflict)),
                    None,
                )
            if existing is not None:
                sb.check_foreign_keys(table, {**existing, **row})
                existing.update(copy.deepcopy(row))  # DO UPDATE SET <sent columns>
                out.append(copy.deepcopy(existing))
                continue
            new = sb.materialize(table, copy.deepcopy(row))
            sb.check_foreign_keys(table, new)
            for u in sb.unique_sets(table):
                if all(new.get(c) is not None for c in u) and any(
                    all(r.get(c) == new.get(c) for c in u) for r in sb.rows[table]
                ):
                    raise APIError(
                        "23505",
                        f'duplicate key value violates unique constraint on {table}({", ".join(u)})',
                    )
            sb.rows[table].append(new)
            out.append(copy.deepcopy(new))
        return _Response(out)
