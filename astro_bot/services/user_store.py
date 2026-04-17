"""Kullanıcı durumu: SQLite (yerel) veya Railway PostgreSQL (DATABASE_URL)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# user_data içinden kalıcı tutulacak anahtarlar
PERSIST_KEYS = ("lang", "profile", "chat_history", "memory_summary", "chat_mode")

MAX_CHAT_HISTORY_MSGS = 100


def _trim_payload(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in PERSIST_KEYS:
        if k not in data:
            continue
        v = data[k]
        if k == "chat_history" and isinstance(v, list) and len(v) > MAX_CHAT_HISTORY_MSGS:
            v = v[-MAX_CHAT_HISTORY_MSGS:]
        out[k] = v
    return out


class UserStore(ABC):
    @abstractmethod
    async def load(self, user_id: int) -> dict[str, Any] | None: ...

    @abstractmethod
    async def save(self, user_id: int, data: dict[str, Any]) -> None: ...


class SqliteUserStore(UserStore):
    def __init__(self, db_path: Path) -> None:
        self._path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        import sqlite3

        with sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_state (
                    user_id INTEGER PRIMARY KEY NOT NULL,
                    data TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _load_sync(self, user_id: int) -> dict[str, Any] | None:
        import sqlite3

        with sqlite3.connect(self._path) as conn:
            row = conn.execute(
                "SELECT data FROM user_state WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if not row:
                return None
            return json.loads(row[0])

    def _save_sync(self, user_id: int, data: dict[str, Any]) -> None:
        import sqlite3

        blob = json.dumps(data, ensure_ascii=False)
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                INSERT INTO user_state (user_id, data) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET data = excluded.data
                """,
                (user_id, blob),
            )
            conn.commit()

    async def load(self, user_id: int) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._load_sync, user_id)

    async def save(self, user_id: int, data: dict[str, Any]) -> None:
        payload = _trim_payload(data)
        if not payload:
            return
        await asyncio.to_thread(self._save_sync, user_id, payload)


class PostgresUserStore(UserStore):
    """psycopg2 — Railway DATABASE_URL (postgres:// → postgresql://)."""

    def __init__(self, dsn: str) -> None:
        import psycopg2

        if dsn.startswith("postgres://"):
            dsn = dsn.replace("postgres://", "postgresql://", 1)
        self._dsn = dsn
        self._psycopg2 = psycopg2
        self._init_db()

    def _init_db(self) -> None:
        with self._psycopg2.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_state (
                        user_id BIGINT PRIMARY KEY,
                        data JSONB NOT NULL
                    )
                    """
                )
            conn.commit()

    def _load_sync(self, user_id: int) -> dict[str, Any] | None:
        with self._psycopg2.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM user_state WHERE user_id = %s", (user_id,))
                row = cur.fetchone()
                if not row:
                    return None
                d = row[0]
                if isinstance(d, dict):
                    return d
                return json.loads(d) if isinstance(d, str) else dict(d)

    def _save_sync(self, user_id: int, data: dict[str, Any]) -> None:
        from psycopg2.extras import Json

        with self._psycopg2.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO user_state (user_id, data)
                    VALUES (%s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data
                    """,
                    (user_id, Json(data)),
                )
            conn.commit()

    async def load(self, user_id: int) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._load_sync, user_id)

    async def save(self, user_id: int, data: dict[str, Any]) -> None:
        payload = _trim_payload(data)
        if not payload:
            return
        await asyncio.to_thread(self._save_sync, user_id, payload)


def create_user_store(project_root: Path) -> UserStore:
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        logger.info("Kullanıcı deposu: PostgreSQL (DATABASE_URL)")
        return PostgresUserStore(url)
    data_dir = os.getenv("DATA_DIR", "").strip()
    path = Path(data_dir) if data_dir else project_root / "data"
    db_file = path / "bot_state.db"
    logger.info("Kullanıcı deposu: SQLite (%s)", db_file)
    return SqliteUserStore(db_file)
