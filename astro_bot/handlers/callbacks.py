"""Inline düğme geri aramaları."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.constants import ParseMode
from telegram.error import BadRequest
from telegram.ext import Application, CallbackQueryHandler, ContextTypes

from astro_bot.handlers import keyboards as kb
from astro_bot.i18n import get_lang, t
from astro_bot.services.faq_service import FaqService
from astro_bot.services.feedback_store import FeedbackStore

logger = logging.getLogger(__name__)


async def feedback_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.data:
        return
    store: FeedbackStore | None = context.bot_data.get("feedback_store")
    uid = query.from_user.id if query.from_user else 0
    cid = query.message.chat_id if query.message else 0
    helpful = query.data == "fb:1"
    lang = get_lang(context.user_data.get("lang"))
    if helpful:
        if store:
            await store.log(uid, cid, True)
        await query.answer("Teşekkürler!" if lang == "tr" else "Thanks!")
        return
    if store:
        await store.log(uid, cid, False)
    context.user_data["pending_feedback"] = True
    await query.answer()
    if query.message:
        await query.message.reply_text(t("feedback_why", lang))


async def callback_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return
    await query.answer()
    data = query.data or ""
    faq: FaqService = context.bot_data["faq"]
    lang = get_lang(context.user_data.get("lang"))

    try:
        if data == "menu:root":
            if lang == "en":
                text = "<b>Main menu</b>\n\nUse the shortcuts below or type your question."
            else:
                text = "<b>Ana menü</b>\n\nAşağıdaki kısayolları kullan veya doğrudan sorunu yaz."
            await _edit_or_send(query, context, text, kb.main_menu_keyboard())
            return

        if data == "cat:root":
            await _edit_or_send(
                query,
                context,
                "<b>SSS kategorileri</b>\n\nBir kategori seç:",
                kb.category_list_keyboard(faq),
            )
            return

        if data.startswith("cat:"):
            cat = data.split(":", 1)[1]
            if cat == "root":
                return
            label = faq.category_label(cat)
            entries = faq.entries_in_category(cat)
            if not entries:
                await _edit_or_send(
                    query,
                    context,
                    "Bu kategoride kayıt yok.",
                    kb.category_list_keyboard(faq),
                )
                return
            await _edit_or_send(
                query,
                context,
                f"<b>{_escape_html(label)}</b>\n\nBir başlık seç:",
                kb.faq_items_keyboard(faq, cat),
            )
            return

        if data.startswith("faq:"):
            eid = data.split(":", 1)[1]
            entry = faq.get_by_id(eid)
            if not entry:
                await _edit_or_send(
                    query,
                    context,
                    "Kayıt bulunamadı.",
                    kb.back_to_menu_keyboard(),
                )
                return
            safe = _escape_html(entry.text_for_lang(lang))
            await _edit_or_send(
                query,
                context,
                f"<b>{_escape_html(entry.title)}</b>\n\n{safe}",
                kb.faq_items_keyboard(faq, entry.category),
            )
            return

        if data.startswith("static:"):
            key = data.split(":", 1)[1]
            if key == "help":
                await _edit_or_send(query, context, t("help", lang), kb.back_to_menu_keyboard())
            elif key == "about":
                await _edit_or_send(query, context, t("about", lang), kb.back_to_menu_keyboard())
            elif key == "burclar":
                await _edit_or_send(query, context, t("burclar", lang), kb.back_to_menu_keyboard())
            return
    except Exception:
        logger.exception("Callback işlenemedi: data=%s", data)


def _escape_html(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


async def _edit_or_send(query, context: ContextTypes.DEFAULT_TYPE, text: str, markup) -> None:
    try:
        await query.edit_message_text(
            text=text,
            reply_markup=markup,
            parse_mode=ParseMode.HTML,
        )
    except BadRequest:
        if query.message:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=text,
                reply_markup=markup,
                parse_mode=ParseMode.HTML,
            )


def register_callback_handlers(application: Application) -> None:
    application.add_handler(CallbackQueryHandler(feedback_callback, pattern=r"^fb:[01]$"))
    application.add_handler(CallbackQueryHandler(callback_router, pattern=r"^(menu|cat|faq|static):"))
