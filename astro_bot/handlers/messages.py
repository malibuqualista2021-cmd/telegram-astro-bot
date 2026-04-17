"""Serbest metin mesajları."""

from __future__ import annotations

import logging
from typing import Any

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, ContextTypes, MessageHandler, filters

from astro_bot.services.faq_service import FaqService
from astro_bot.services.openai_service import OpenAiAstrologyService
from astro_bot.services.rate_limit import ChatRateLimiter
from astro_bot.texts import RATE_LIMIT_TEXT

logger = logging.getLogger(__name__)


def _trim_history(
    history: list[dict[str, Any]],
    max_turns: int,
) -> list[dict[str, Any]]:
    """Son N kullanıcı-asistan turunu OpenAI mesaj formatında tutar."""
    max_msgs = max(2, max_turns * 2)
    return history[-max_msgs:]


async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return

    text = update.message.text.strip()
    chat_id = update.effective_chat.id if update.effective_chat else 0

    limiter: ChatRateLimiter = context.bot_data["rate_limiter"]
    if not limiter.allow(chat_id):
        await update.message.reply_text(RATE_LIMIT_TEXT)
        return

    faq: FaqService = context.bot_data["faq"]
    openai_svc: OpenAiAstrologyService = context.bot_data["openai"]
    max_turns: int = context.bot_data["conversation_turns"]

    await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    entry = faq.find_entry(text)
    if entry:
        await update.message.reply_text(entry.answer)
        logger.info("Yanıt kaynağı=SSS id=%s chat_id=%s", entry.entry_id, chat_id)
        return

    hist_raw: list[dict[str, Any]] = context.user_data.get("chat_history") or []
    history = _trim_history(hist_raw, max_turns)

    reply = await openai_svc.reply(text, history=history)

    await update.message.reply_text(reply)
    logger.info("Yanıt kaynağı=OpenAI chat_id=%s", chat_id)

    new_hist = list(hist_raw)
    new_hist.append({"role": "user", "content": text})
    new_hist.append({"role": "assistant", "content": reply})
    context.user_data["chat_history"] = _trim_history(new_hist, max_turns)


def register_message_handlers(application: Application) -> None:
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message))
