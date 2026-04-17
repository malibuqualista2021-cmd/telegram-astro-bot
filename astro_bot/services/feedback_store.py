"""Basit 👍/👎 geri bildirimi — SQLite (data/analytics.db)."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class FeedbackStore:
    def __init__(self, db_path: Path) -> None:
        self._path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    chat_id INTEGER NOT NULL,
                    helpful INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _insert_sync(self, user_id: int, chat_id: int, helpful: bool) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                "INSERT INTO feedback (user_id, chat_id, helpful, created_at) VALUES (?, ?, ?, ?)",
                (user_id, chat_id, 1 if helpful else 0, ts),
            )
            conn.commit()

    async def log(self, user_id: int, chat_id: int, helpful: bool) -> None:
        try:
            await asyncio.to_thread(self._insert_sync, user_id, chat_id, helpful)
        except Exception:
            logger.exception("Geri bildirim kaydedilemedi")


def create_feedback_store(project_root: Path) -> FeedbackStore:
    return FeedbackStore(project_root / "data" / "analytics.db")
