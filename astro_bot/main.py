"""Uygulama giriş noktası — polling ile yerel geliştirme."""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler

from telegram import Update
from telegram.ext import Application

from astro_bot import __version__, settings
from astro_bot.config import (
    FAQ_PATH,
    LLM_API_KEY,
    LLM_MODEL,
    LLM_PROVIDER,
    LOGS_DIR,
    LOG_LEVEL,
    TELEGRAM_BOT_TOKEN,
    resolved_conversation_turns,
    resolved_faq_fuzzy_threshold,
    resolved_openai_max_tokens,
    resolved_openai_temperature,
    resolved_rate_limit_per_minute,
)
from astro_bot.handlers.callbacks import register_callback_handlers
from astro_bot.handlers.commands import register_command_handlers
from astro_bot.handlers.messages import register_message_handlers
from astro_bot.services.faq_service import FaqService
from astro_bot.services.llm_service import LlmAstrologyService
from astro_bot.services.rate_limit import ChatRateLimiter


def setup_logging() -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOGS_DIR / "astro_bot.log"
    root = logging.getLogger()
    root.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)

    fh = RotatingFileHandler(
        log_file,
        maxBytes=settings.LOG_MAX_BYTES,
        backupCount=settings.LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("telegram").setLevel(logging.INFO)


def main() -> None:
    setup_logging()
    log = logging.getLogger(__name__)
    log.info(
        "Astroloji bot başlıyor (sürüm %s, LLM=%s, model=%s)",
        __version__,
        LLM_PROVIDER,
        LLM_MODEL,
    )

    fuzzy = resolved_faq_fuzzy_threshold()
    faq = FaqService(FAQ_PATH, fuzzy_threshold=fuzzy)
    llm_svc = LlmAstrologyService(
        provider=LLM_PROVIDER,
        api_key=LLM_API_KEY,
        model=LLM_MODEL,
        max_tokens=resolved_openai_max_tokens(),
        temperature=resolved_openai_temperature(),
    )
    rate_limiter = ChatRateLimiter(resolved_rate_limit_per_minute())
    turns = resolved_conversation_turns()

    application = (
        Application.builder()
        .token(TELEGRAM_BOT_TOKEN)
        .concurrent_updates(True)
        .build()
    )
    application.bot_data["faq"] = faq
    application.bot_data["llm"] = llm_svc
    application.bot_data["rate_limiter"] = rate_limiter
    application.bot_data["conversation_turns"] = turns

    register_command_handlers(application)
    register_callback_handlers(application)
    register_message_handlers(application)

    log.info("Polling başlatılıyor…")
    application.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)
