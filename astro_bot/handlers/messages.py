"""Serbest metin mesajları (özel sohbet + grupta mention)."""

from __future__ import annotations

import logging
import re
from datetime import timezone
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
from astro_bot.services.horary_service import format_horary_context, user_has_saved_coordinates
from astro_bot.services.intent_service import classify_intent
from astro_bot.services.llm_service import LlmAstrologyService
from astro_bot.services.memory_service import should_summarize, split_for_summarize
from astro_bot.services.profile_service import (
    partner_from_user_data,
    partner_to_llm_hint,
    profile_from_user_data,
)
from astro_bot.services.rate_limit import ChatRateLimiter
from astro_bot.services.chart_service import build_computed_chart_context, build_synastry_context
from astro_bot.services.claim_guard import maybe_append_data_footnote
from astro_bot.services.expert_style import (
    astro_style_instruction,
    get_astro_style,
    parse_astro_style_phrases,
)
from astro_bot.services.user_learning import add_learning_note, format_learning_for_llm

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

    if context.user_data.pop("pending_feedback", None):
        if add_learning_note(context.user_data, text):
            await update.message.reply_text(t("feedback_saved", lang))
        else:
            await update.message.reply_text(t("feedback_empty", lang))
        logger.info("Geri bildirim notu chat_id=%s", chat_id)
        return

    style_parsed, text = parse_astro_style_phrases(text, lang)
    if style_parsed is not None:
        context.user_data["astro_style"] = style_parsed
        logger.info("astro_style güncellendi chat_id=%s style=%s", chat_id, style_parsed)

    text = text.strip()
    remember = re.match(
        r"^(?:hatırla|hatirla|remember)\s*:\s*(.+)$",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if remember:
        note = (remember.group(1) or "").strip()
        if add_learning_note(context.user_data, note):
            await update.message.reply_text(
                "Not kaydedildi; sonraki yanıtlarda dikkate alınacak."
                if lang != "en"
                else "Saved — I’ll take this into account in future replies.",
            )
        else:
            await update.message.reply_text(
                "Boş not. Örnek: hatırla: Daha samimi yaz."
                if lang != "en"
                else "Empty note. Example: remember: keep it warmer.",
            )
        logger.info("Kullanıcı notu eklendi chat_id=%s", chat_id)
        return

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
    partner_prof = partner_from_user_data(context.user_data)
    hint_parts: list[str] = []
    if profile.birth_date:
        hint_parts.append(profile.to_llm_hint(lang))
    if partner_prof.birth_date:
        hint_parts.append(partner_to_llm_hint(partner_prof, lang))
    hint = "\n\n".join(hint_parts)
    chart_facts = build_computed_chart_context(profile, lang) if profile.birth_date else ""
    synastry_facts = (
        build_synastry_context(profile, partner_prof, lang)
        if profile.birth_date and partner_prof.birth_date
        else ""
    )
    learned_notes = format_learning_for_llm(context.user_data, lang)
    intent = classify_intent(text, lang)
    mem = (context.user_data.get("memory_summary") or "").strip()

    rag_svc = context.bot_data.get("knowledge_rag")
    rag_text = ""
    if rag_svc is not None:
        try:
            rag_text = rag_svc.retrieve(text, lang)
        except Exception:
            logger.exception("RAG retrieve")
    style_block = astro_style_instruction(get_astro_style(context.user_data), lang)

    horary_context = ""
    if chat_mode == "horary" and update.effective_message:
        msg_dt = update.effective_message.date
        if msg_dt.tzinfo is None:
            msg_dt = msg_dt.replace(tzinfo=timezone.utc)
        else:
            msg_dt = msg_dt.astimezone(timezone.utc)
        horary_context = format_horary_context(
            msg_dt,
            profile.lat,
            profile.lon,
            lang,
            used_custom_location=user_has_saved_coordinates(context.user_data),
        )

    reply = await llm_svc.reply(
        text,
        history=history,
        lang=lang,
        profile_hint=hint,
        chart_facts=chart_facts,
        synastry_facts=synastry_facts,
        learned_notes=learned_notes,
        memory_summary=mem,
        intent=intent,
        chat_mode=chat_mode,
        horary_context=horary_context,
        rag_context=rag_text,
        expert_style_block=style_block,
        model_override=(
            context.bot_data.get("llm_model_deep")
            if (
                context.bot_data.get("llm_model_deep")
                and (
                    len(text) > 420
                    or bool(synastry_facts)
                    or chat_mode == "chart"
                    or (len(chart_facts) > 2500 if chart_facts else False)
                )
            )
            else None
        ),
        use_chain=bool(
            context.bot_data.get("chain_llm")
            and (bool(chart_facts) or bool(synastry_facts) or len(text) > 200),
        ),
    )

    reply = maybe_append_data_footnote(reply, chart_facts, lang=lang)

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
