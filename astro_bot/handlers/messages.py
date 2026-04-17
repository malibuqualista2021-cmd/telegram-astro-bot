"""Serbest metin mesajları."""

from __future__ import annotations

import logging
from typing import Any

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, ContextTypes, MessageHandler, filters

from astro_bot import settings
from astro_bot.i18n import get_lang, t
from astro_bot.services.faq_service import FaqService
from astro_bot.services.intent_service import classify_intent
from astro_bot.services.llm_service import LlmAstrologyService
from astro_bot.services.memory_service import should_summarize, split_for_summarize
from astro_bot.services.profile_service import profile_from_user_data
from astro_bot.services.rate_limit import ChatRateLimiter

logger = logging.getLogger(__name__)


def _trim_history(
    history: list[dict[str, Any]],
    max_turns: int,
) -> list[dict[str, Any]]:
    max_msgs = max(2, max_turns * 2)
    return history[-max_msgs:]


async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return

    text = update.message.text.strip()
    chat_id = update.effective_chat.id if update.effective_chat else 0
    lang = get_lang(context.user_data.get("lang"))

    limiter: ChatRateLimiter = context.bot_data["rate_limiter"]
    if not limiter.allow(chat_id):
        await update.message.reply_text(t("rate_limit", lang))
        return

    faq: FaqService = context.bot_data["faq"]
    llm_svc: LlmAstrologyService = context.bot_data["llm"]
    max_turns: int = context.bot_data["conversation_turns"]
    mem_threshold: int = context.bot_data.get(
        "memory_threshold_msgs",
        settings.MEMORY_SUMMARIZE_AT_MSGS,
    )
    mem_keep: int = context.bot_data.get(
        "memory_keep_pairs",
        settings.MEMORY_KEEP_PAIRS,
    )

    await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    entry = faq.find_entry(text)
    if entry:
        await update.message.reply_text(entry.answer)
        logger.info("Yanıt kaynağı=SSS id=%s chat_id=%s", entry.entry_id, chat_id)
        return

    hist_raw: list[dict[str, Any]] = list(context.user_data.get("chat_history") or [])

    if should_summarize(hist_raw, mem_threshold):
        old_part, kept = split_for_summarize(hist_raw, mem_keep)
        if old_part:
            summ = await llm_svc.summarize_chunk(old_part, lang)
            if summ:
                prev = (context.user_data.get("memory_summary") or "").strip()
                merged = (prev + "\n" + summ).strip() if prev else summ
                context.user_data["memory_summary"] = merged[-4000:]
            context.user_data["chat_history"] = kept
            hist_raw = kept

    history = _trim_history(hist_raw, max_turns)
    profile = profile_from_user_data(context.user_data)
    hint = profile.to_llm_hint(lang) if profile.birth_date else ""
    intent = classify_intent(text, lang)
    mem = (context.user_data.get("memory_summary") or "").strip()

    reply = await llm_svc.reply(
        text,
        history=history,
        lang=lang,
        profile_hint=hint,
        memory_summary=mem,
        intent=intent,
    )

    await update.message.reply_text(reply)
    logger.info("Yanıt kaynağı=LLM chat_id=%s intent=%s", chat_id, intent)

    new_hist = list(context.user_data.get("chat_history") or [])
    new_hist.append({"role": "user", "content": text})
    new_hist.append({"role": "assistant", "content": reply})
    context.user_data["chat_history"] = _trim_history(new_hist, max_turns)


def register_message_handlers(application: Application) -> None:
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message))
