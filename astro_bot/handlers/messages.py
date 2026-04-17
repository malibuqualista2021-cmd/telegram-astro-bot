"""Serbest metin mesajları (özel sohbet + grupta mention)."""

from __future__ import annotations

import logging
import re
from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatAction
from telegram.ext import Application, ContextTypes, MessageHandler, filters

from astro_bot import settings
from astro_bot.i18n import get_lang, t
from astro_bot.services.conversation_mode import (
    mode_ack_message,
    normalize_chat_mode,
    parse_chat_mode_phrases,
)
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


def _feedback_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("👍", callback_data="fb:1"),
                InlineKeyboardButton("👎", callback_data="fb:0"),
            ]
        ]
    )


async def _process_free_text(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
) -> None:
    if not update.message:
        return

    max_c = context.bot_data.get(
        "max_user_message_chars",
        settings.MAX_USER_MESSAGE_CHARS,
    )
    if len(text) > max_c:
        text = text[:max_c]

    chat_id = update.effective_chat.id if update.effective_chat else 0
    lang = get_lang(context.user_data.get("lang"))

    limiter: ChatRateLimiter = context.bot_data["rate_limiter"]
    if not limiter.allow(chat_id):
        await update.message.reply_text(t("rate_limit", lang))
        return

    mode_parsed, text = parse_chat_mode_phrases(text, lang)
    if mode_parsed is not None:
        context.user_data["chat_mode"] = mode_parsed
        logger.info("Konuşma modu güncellendi chat_id=%s mode=%s", chat_id, mode_parsed)

    text = text.strip()
    if not text:
        if mode_parsed is not None:
            ack = mode_ack_message(
                normalize_chat_mode(context.user_data.get("chat_mode")),
                lang,
            )
            await update.message.reply_text(ack)
            logger.info("Yanıt=mod_onayı chat_id=%s", chat_id)
            return
        await update.message.reply_text(
            "Mesajın boş görünüyor. Astrolojiyle ilgili bir şey yaz."
            if lang != "en"
            else "Your message looks empty. Write something about astrology."
        )
        return

    chat_mode = normalize_chat_mode(context.user_data.get("chat_mode"))

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

    faq_ans = faq.find_answer(text, lang)
    if faq_ans:
        await update.message.reply_text(faq_ans)
        logger.info("Yanıt kaynağı=SSS chat_id=%s", chat_id)
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
        chat_mode=chat_mode,
    )

    await update.message.reply_text(reply, reply_markup=_feedback_keyboard())
    logger.info(
        "Yanıt kaynağı=LLM chat_id=%s intent=%s mode=%s",
        chat_id,
        intent,
        chat_mode,
    )

    new_hist = list(context.user_data.get("chat_history") or [])
    new_hist.append({"role": "user", "content": text})
    new_hist.append({"role": "assistant", "content": reply})
    context.user_data["chat_history"] = _trim_history(new_hist, max_turns)


async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return
    await _process_free_text(update, context, update.message.text.strip())


def _strip_bot_mention(text: str, bot_username: str) -> str:
    if not bot_username:
        return text
    pat = rf"@?{re.escape(bot_username)}\s*"
    return re.sub(pat, "", text, count=1, flags=re.IGNORECASE).strip()


async def group_text_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return
    bot_username = (context.bot_data.get("bot_username") or "").strip().lower()
    if not bot_username:
        return
    raw = update.message.text
    if f"@{bot_username}" not in raw.lower():
        return
    clean = _strip_bot_mention(raw.strip(), bot_username)
    if not clean:
        await update.message.reply_text(
            "Astroloji sorusunu @bot ile birlikte yazabilirsin."
            if get_lang(context.user_data.get("lang")) == "tr"
            else "Write your astrology question next to @bot."
        )
        return
    await _process_free_text(update, context, clean)


def register_message_handlers(application: Application) -> None:
    application.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE,
            text_message,
        )
    )
    application.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND & filters.ChatType.GROUPS,
            group_text_message,
        )
    )
