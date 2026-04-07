"""Persistent storage for chat sessions and messages.

SQLite-backed (stdlib `sqlite3` + `asyncio.to_thread`), zero new dependencies.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any, Iterator


_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT    PRIMARY KEY,
    title               TEXT    NOT NULL,
    working_dir         TEXT    NOT NULL,
    owner_id            TEXT,
    created_at          REAL    NOT NULL,
    last_active_at      REAL    NOT NULL,
    message_count       INTEGER NOT NULL DEFAULT 0,
    total_input_tokens  INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd      REAL    NOT NULL DEFAULT 0,
    deleted_at          REAL
);

CREATE INDEX IF NOT EXISTS idx_sessions_active
    ON sessions(last_active_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    seq         INTEGER NOT NULL,
    role        TEXT    NOT NULL CHECK(role IN ('user','assistant','system')),
    content     TEXT    NOT NULL,
    is_partial  INTEGER NOT NULL DEFAULT 0,
    created_at  REAL    NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, seq);

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_SCHEMA_VERSION = "1"


class SessionStore:
    """SQLite-backed store for chat sessions and messages."""

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = str(db_path)
        if self._db_path != ":memory:":
            Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    # ----- low-level helpers --------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _txn(self) -> Iterator[sqlite3.Connection]:
        """Open a transactional connection. Commits on success, rolls back on error."""
        conn = self._connect()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with closing(self._connect()) as conn:
            if self._db_path != ":memory:":
                conn.execute("PRAGMA journal_mode = WAL")
            with conn:
                conn.executescript(_SCHEMA)
                conn.execute(
                    "INSERT OR IGNORE INTO schema_meta(key, value) VALUES('schema_version', ?)",
                    (_SCHEMA_VERSION,),
                )

    # ----- sessions: async public API ----------------------------------------

    async def create_session(
        self,
        sid: str,
        title: str,
        working_dir: str,
        owner_id: str | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._create_session, sid, title, working_dir, owner_id
        )

    async def get_session(self, sid: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_session, sid)

    async def list_sessions(
        self,
        limit: int = 50,
        offset: int = 0,
        owner_id: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        return await asyncio.to_thread(self._list_sessions, limit, offset, owner_id)

    async def update_session(
        self,
        sid: str,
        *,
        title: str | None = None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._update_session, sid, title)

    async def delete_session(self, sid: str) -> bool:
        return await asyncio.to_thread(self._delete_session, sid)

    async def update_session_stats(
        self,
        sid: str,
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost: float = 0.0,
    ) -> None:
        await asyncio.to_thread(
            self._update_session_stats, sid, input_tokens, output_tokens, cost
        )

    # ----- messages: async public API ----------------------------------------

    async def append_message(
        self,
        sid: str,
        role: str,
        content: list[dict[str, Any]],
        is_partial: bool = False,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._append_message, sid, role, content, is_partial
        )

    async def list_messages(self, sid: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_messages, sid)

    # ----- sync internals -----------------------------------------------------

    def _create_session(
        self,
        sid: str,
        title: str,
        working_dir: str,
        owner_id: str | None,
    ) -> dict[str, Any]:
        now = time.time()
        with self._txn() as conn:
            conn.execute(
                """
                INSERT INTO sessions (
                    id, title, working_dir, owner_id, created_at, last_active_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (sid, title, working_dir, owner_id, now, now),
            )
        result = self._get_session(sid)
        assert result is not None  # just inserted
        return result

    def _get_session(self, sid: str) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL",
                (sid,),
            ).fetchone()
        return dict(row) if row else None

    def _list_sessions(
        self,
        limit: int,
        offset: int,
        owner_id: str | None,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = ["deleted_at IS NULL"]
        params: list[Any] = []
        if owner_id is not None:
            clauses.append("owner_id = ?")
            params.append(owner_id)
        where = " WHERE " + " AND ".join(clauses)

        with closing(self._connect()) as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM sessions{where}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM sessions{where} "
                "ORDER BY last_active_at DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
        return [dict(r) for r in rows], int(total)

    def _update_session(
        self,
        sid: str,
        title: str | None,
    ) -> dict[str, Any] | None:
        if title is not None:
            with self._txn() as conn:
                conn.execute(
                    "UPDATE sessions SET title = ? "
                    "WHERE id = ? AND deleted_at IS NULL",
                    (title, sid),
                )
        return self._get_session(sid)

    def _delete_session(self, sid: str) -> bool:
        with self._txn() as conn:
            cur = conn.execute(
                "UPDATE sessions SET deleted_at = ? "
                "WHERE id = ? AND deleted_at IS NULL",
                (time.time(), sid),
            )
            return cur.rowcount > 0

    def _update_session_stats(
        self,
        sid: str,
        input_tokens: int,
        output_tokens: int,
        cost: float,
    ) -> None:
        with self._txn() as conn:
            conn.execute(
                """
                UPDATE sessions
                   SET total_input_tokens  = total_input_tokens  + ?,
                       total_output_tokens = total_output_tokens + ?,
                       total_cost_usd      = total_cost_usd      + ?,
                       last_active_at      = ?
                 WHERE id = ?
                """,
                (input_tokens, output_tokens, cost, time.time(), sid),
            )

    def _append_message(
        self,
        sid: str,
        role: str,
        content: list[dict[str, Any]],
        is_partial: bool,
    ) -> dict[str, Any]:
        now = time.time()
        content_json = json.dumps(content, ensure_ascii=False)
        with self._txn() as conn:
            seq_row = conn.execute(
                "SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE session_id = ?",
                (sid,),
            ).fetchone()
            seq = int(seq_row[0])
            cur = conn.execute(
                """
                INSERT INTO messages (
                    session_id, seq, role, content, is_partial, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (sid, seq, role, content_json, int(is_partial), now),
            )
            msg_id = cur.lastrowid
            conn.execute(
                """
                UPDATE sessions
                   SET message_count  = message_count + 1,
                       last_active_at = ?
                 WHERE id = ?
                """,
                (now, sid),
            )
        return {
            "id": msg_id,
            "session_id": sid,
            "seq": seq,
            "role": role,
            "content": content,
            "is_partial": is_partial,
            "created_at": now,
        }

    def _list_messages(self, sid: str) -> list[dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC",
                (sid,),
            ).fetchall()
        result: list[dict[str, Any]] = []
        for r in rows:
            d = dict(r)
            d["content"] = json.loads(d["content"])
            d["is_partial"] = bool(d["is_partial"])
            result.append(d)
        return result
