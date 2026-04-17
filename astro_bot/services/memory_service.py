"""Uzun sohbette özet sıkıştırma (LLM ile)."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def should_summarize(history: list[dict[str, Any]], threshold_msgs: int) -> bool:
    return len(history) >= threshold_msgs


def split_for_summarize(
    history: list[dict[str, Any]],
    keep_last_pairs: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """İlk kısmı özetlenecek, son keep_last_pairs tur kalır."""
    keep_n = max(2, keep_last_pairs * 2)
    if len(history) <= keep_n:
        return [], list(history)
    return history[:-keep_n], history[-keep_n:]


SUMMARY_PROMPT_TR = (
    "Aşağıdaki astroloji sohbetini 2-3 cümleyle Türkçe özetle; isim yoksa 'kullanıcı' de. "
    "Sadece özet metni ver."
)
SUMMARY_PROMPT_EN = (
    "Summarize the following astrology chat in 2-3 short English sentences. "
    "Output summary text only."
)
