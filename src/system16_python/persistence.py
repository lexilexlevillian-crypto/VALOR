"""Atomic local persistence for the isolated module; no game-owner integration."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .dependencies import MockDependencies
from .engine import transition
from .state import Command, Object, State, canonical, require


def execute(database: str | Path, command: Command, dependencies: MockDependencies | None = None) -> Object:
    """Serialize concurrent writers and commit a complete state transition once.

    Each branch has an independent JSON snapshot. The database is private to this
    module. External participants are no-op, idempotency-keyed mock functions.
    PrepareMessage must commit before CommitMessage is requested. Recover repeats
    committed/aborted participant notifications using their original keys.
    """
    with closing(sqlite3.connect(str(database), timeout=30, isolation_level=None)) as connection:
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("CREATE TABLE IF NOT EXISTS system16_state (branch_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)")
        connection.execute("BEGIN IMMEDIATE")
        try:
            row = connection.execute("SELECT snapshot FROM system16_state WHERE branch_id = ?", (command["branch_id"],)).fetchone()
            state = json.loads(row[0]) if row else State().to_json()
            outcome = transition(state, command, dependencies)
            connection.execute("INSERT INTO system16_state VALUES (?, ?) ON CONFLICT(branch_id) DO UPDATE SET snapshot=excluded.snapshot", (command["branch_id"], canonical(outcome["state"])))
            connection.execute("COMMIT")
            return outcome["result"]
        except BaseException:
            connection.execute("ROLLBACK")
            raise


def load(database: str | Path, branch_id: str) -> Object:
    with closing(sqlite3.connect(str(database))) as connection:
        row = connection.execute("SELECT snapshot FROM system16_state WHERE branch_id=?", (branch_id,)).fetchone()
        require(row is not None, "BRANCH_UNAVAILABLE")
        return State.from_json(json.loads(row[0])).to_json()


def save(database: str | Path, branch_id: str, state: Object) -> None:
    """Trusted import of an already validated snapshot; never a player command."""
    snapshot = State.from_json(state)
    require(all(row["branch_id"] == branch_id for kind in ("communication_endpoint", "communication", "submission", "scheduled_work") for row in snapshot.table(kind).values()), "BRANCH_MISMATCH")
    with closing(sqlite3.connect(str(database))) as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS system16_state (branch_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)")
        connection.execute("INSERT INTO system16_state VALUES (?, ?) ON CONFLICT(branch_id) DO UPDATE SET snapshot=excluded.snapshot", (branch_id, canonical(snapshot.to_json())))
        connection.commit()
