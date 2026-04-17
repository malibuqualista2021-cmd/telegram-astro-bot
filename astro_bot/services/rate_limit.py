"""Sohbet başına basit hız sınırı (sliding window)."""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

logger = logging.getLogger(__name__)


class ChatRateLimiter:
    """Dakika başına en fazla N istek; aşılırsa False döner."""

    def __init__(self, max_per_minute: int) -> None:
        self._max = max(1, max_per_minute)
        self._window_sec = 60.0
        self._hits: dict[int, deque[float]] = defaultdict(deque)

    def allow(self, chat_id: int) -> bool:
        now = time.monotonic()
        dq = self._hits[chat_id]
        cutoff = now - self._window_sec
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= self._max:
            logger.warning("Hız sınırı: chat_id=%s", chat_id)
            return False
        dq.append(now)
        return True
