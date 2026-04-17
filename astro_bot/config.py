"""Ortam değişkenleri ve yol sabitleri."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from astro_bot import settings

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Eksik ortam değişkeni: {name}")
    return value


def _optional_int(name: str, fallback: int) -> int:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return fallback
    try:
        return int(str(raw).strip())
    except ValueError:
        return fallback


def _optional_float(name: str, fallback: float) -> float:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return fallback
    try:
        return float(str(raw).strip())
    except ValueError:
        return fallback


TELEGRAM_BOT_TOKEN: str = _require_env("TELEGRAM_BOT_TOKEN")
OPENAI_API_KEY: str = _require_env("OPENAI_API_KEY")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()

KNOWLEDGE_DIR: Path = _PROJECT_ROOT / "knowledge"
FAQ_PATH: Path = KNOWLEDGE_DIR / "faq.json"
LOGS_DIR: Path = _PROJECT_ROOT / "logs"

LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").strip().upper()


def resolved_openai_max_tokens() -> int:
    v = _optional_int("OPENAI_MAX_TOKENS", 0)
    return settings.OPENAI_MAX_TOKENS if v <= 0 else v


def resolved_openai_temperature() -> float:
    v = _optional_float("OPENAI_TEMPERATURE", -1.0)
    return settings.OPENAI_TEMPERATURE if v < 0 else v


def resolved_faq_fuzzy_threshold() -> int:
    v = _optional_int("FAQ_FUZZY_THRESHOLD", 0)
    return settings.FAQ_FUZZY_THRESHOLD if v <= 0 else min(100, max(50, v))


def resolved_rate_limit_per_minute() -> int:
    v = _optional_int("RATE_LIMIT_PER_MINUTE", 0)
    return settings.RATE_LIMIT_PER_MINUTE if v <= 0 else max(5, v)


def resolved_conversation_turns() -> int:
    v = _optional_int("CONVERSATION_MAX_TURNS", 0)
    return settings.CONVERSATION_MAX_TURNS if v <= 0 else max(1, min(8, v))
