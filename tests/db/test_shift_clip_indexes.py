"""public.shift_clip_indexes_after_delete on real Postgres (-m db).

Called by dashboard remove-plan-clip.ts after it deletes one clip row.
Defined by migration 20261013_shift_clip_indexes_after_delete.sql; prod
had no such function before it.
"""
from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.db

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    pytest.skip("DATABASE_URL not set — real-Postgres schema tests skipped",
                allow_module_level=True)
psycopg = pytest.importorskip("psycopg")

JOB = "00000000-0000-4000-8000-0000000000d1"
OTHER = "00000000-0000-4000-8000-0000000000d2"


@pytest.fixture
def cur():
    """A cursor inside a transaction that is always rolled back."""
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as c:
            c.execute("insert into jobs (id) values (%s), (%s)", [JOB, OTHER])
            yield c
        conn.rollback()


def _clips(cur, job_id, indexes):
    # Insert high-to-low so physical order is the worst case for a naive
    # single-statement `SET index = index - 1` under UNIQUE (job_id, index).
    for i in sorted(indexes, reverse=True):
        cur.execute(
            "insert into clips (job_id, index, voiceover, visual_prompt, setting_id, duration_s) "
            "values (%s, %s, %s, %s, 'DOJO', 8)",
            [job_id, i, f"vo {i}", f"vp {i}"],
        )


def _indexes(cur, job_id):
    cur.execute("select index, voiceover from clips where job_id = %s order by index", [job_id])
    return cur.fetchall()


def test_closes_the_gap_after_a_delete(cur):
    _clips(cur, JOB, range(5))
    _clips(cur, OTHER, range(3))
    cur.execute("delete from clips where job_id = %s and index = 1", [JOB])
    cur.execute("select public.shift_clip_indexes_after_delete(%s::uuid, %s::int)", [JOB, 1])
    assert cur.fetchone()[0] == 3
    assert _indexes(cur, JOB) == [(0, "vo 0"), (1, "vo 2"), (2, "vo 3"), (3, "vo 4")]
    assert [i for i, _ in _indexes(cur, OTHER)] == [0, 1, 2]  # other jobs untouched


def test_deleting_the_last_clip_moves_nothing(cur):
    _clips(cur, JOB, range(3))
    cur.execute("delete from clips where job_id = %s and index = 2", [JOB])
    cur.execute("select public.shift_clip_indexes_after_delete(%s::uuid, %s::int)", [JOB, 2])
    assert cur.fetchone()[0] == 0
    assert [i for i, _ in _indexes(cur, JOB)] == [0, 1]


def test_occupied_slot_fails_atomically(cur):
    """Called without deleting first: 23505 and no index changed."""
    _clips(cur, JOB, range(3))
    cur.execute("savepoint s")
    with pytest.raises(psycopg.errors.UniqueViolation):
        cur.execute("select public.shift_clip_indexes_after_delete(%s::uuid, %s::int)", [JOB, 0])
    cur.execute("rollback to savepoint s")
    assert [i for i, _ in _indexes(cur, JOB)] == [0, 1, 2]


def test_only_service_role_may_execute(cur):
    sig = "public.shift_clip_indexes_after_delete(uuid, integer)"
    for role, allowed in (("anon", False), ("authenticated", False), ("service_role", True)):
        cur.execute("select has_function_privilege(%s, %s, 'EXECUTE')", [role, sig])
        assert cur.fetchone()[0] is allowed, role


def test_invoker_with_pinned_search_path(cur):
    cur.execute(
        "select prosecdef, proconfig from pg_proc "
        "where oid = 'public.shift_clip_indexes_after_delete(uuid, integer)'::regprocedure"
    )
    secdef, config = cur.fetchone()
    assert secdef is False
    assert "search_path=public, pg_temp" in (config or [])
