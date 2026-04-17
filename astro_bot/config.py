"""Ortam değişkenleri ve yol sabitleri."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from astro_bot import settings

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = _PROJECT_ROOT
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


def _resolve_llm() -> tuple[str, str, str]:
    """(provider, api_key, model) — provider: openai | groq | gemini"""
    explicit = os.getenv("LLM_PROVIDER", "").strip().lower()
    openai_k = os.getenv("OPENAI_API_KEY", "").strip()
    groq_k = os.getenv("GROQ_API_KEY", "").strip()
    gemini_k = os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("GOOGLE_API_KEY", "").strip()
    model_override = os.getenv("LLM_MODEL", "").strip()

    if explicit in ("openai", "groq", "gemini"):
        if explicit == "openai":
            if not openai_k:
                raise RuntimeError(
                    "LLM_PROVIDER=openai seçildi; OPENAI_API_KEY gerekli "
                    "(https://platform.openai.com/api-keys)."
                )
            model = model_override or os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
            return "openai", openai_k, model
        if explicit == "groq":
            if not groq_k:
                raise RuntimeError(
                    "LLM_PROVIDER=groq seçildi; GROQ_API_KEY gerekli "
                    "(ücretsiz: https://console.groq.com/keys)."
                )
            model = model_override or "llama-3.3-70b-versatile"
            return "groq", groq_k, model
        if explicit == "gemini":
            if not gemini_k:
                raise RuntimeError(
                    "LLM_PROVIDER=gemini seçildi; GEMINI_API_KEY veya GOOGLE_API_KEY gerekli "
                    "(https://aistudio.google.com/apikey)."
                )
            model = model_override or "gemini-1.5-flash"
            return "gemini", gemini_k, model

    # Otomatik: hangi anahtar varsa onu kullan (öncelik: OpenAI → Groq → Gemini)
    if openai_k:
        model = model_override or os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
        return "openai", openai_k, model
    if groq_k:
        model = model_override or "llama-3.3-70b-versatile"
        return "groq", groq_k, model
    if gemini_k:
        model = model_override or "gemini-1.5-flash"
        return "gemini", gemini_k, model

    raise RuntimeError(
        "LLM için en az bir API anahtarı gerekli. Örnekler:\n"
        "  • GROQ_API_KEY — ücretsiz katman: https://console.groq.com/keys\n"
        "  • OPENAI_API_KEY — https://platform.openai.com/api-keys\n"
        "  • GEMINI_API_KEY veya GOOGLE_API_KEY — https://aistudio.google.com/apikey\n"
        "İsteğe bağlı: LLM_PROVIDER=openai|groq|gemini ve LLM_MODEL=..."
    )


TELEGRAM_BOT_TOKEN: str = _require_env("TELEGRAM_BOT_TOKEN")

LLM_PROVIDER, LLM_API_KEY, LLM_MODEL = _resolve_llm()

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


def resolved_max_user_message_chars() -> int:
    v = _optional_int("MAX_USER_MESSAGE_CHARS", 0)
    return settings.MAX_USER_MESSAGE_CHARS if v <= 0 else max(500, min(12000, v))
