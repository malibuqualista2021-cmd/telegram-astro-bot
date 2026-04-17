"""Komut işleyicileri."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from astro_bot.handlers import keyboards as kb
from astro_bot.services.faq_service import FaqService
from astro_bot.texts import ABOUT_TEXT, BURCLAR_TEXT, HELP_TEXT

logger = logging.getLogger(__name__)

START_TEXT = (
    "<b>Merhaba!</b> Genel astroloji bilgisi paylaşan bir asistanım.\n\n"
    "Burçlar, gezegenler, evler ve harita kavramları hakkında yazabilirsin. "
    "Önce yerel bilgi tabanımdan ararım; gerekirse kısa bir özet üretirim.\n\n"
    "Aşağıdaki menüyü kullan veya doğrudan sorunu yaz."
)


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    context.user_data["chat_history"] = []
    await update.message.reply_text(
        START_TEXT,
        reply_markup=kb.main_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )
    logger.info("Kullanıcı /start: chat_id=%s", update.effective_chat.id if update.effective_chat else None)


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    await update.message.reply_text(
        HELP_TEXT,
        reply_markup=kb.back_to_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )
    logger.info("Kullanıcı /help: chat_id=%s", update.effective_chat.id if update.effective_chat else None)


async def menu_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    faq: FaqService = context.bot_data["faq"]
    await update.message.reply_text(
        "<b>Ana menü</b>\n\nKısayol seç veya mesaj yaz.",
        reply_markup=kb.main_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )
    logger.info("Kullanıcı /menu: chat_id=%s", update.effective_chat.id if update.effective_chat else None)


async def sss_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    faq: FaqService = context.bot_data["faq"]
    await update.message.reply_text(
        "<b>SSS kategorileri</b>\n\nBir kategori seç:",
        reply_markup=kb.category_list_keyboard(faq),
        parse_mode=ParseMode.HTML,
    )


async def burclar_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    await update.message.reply_text(
        BURCLAR_TEXT,
        reply_markup=kb.back_to_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )


async def hakkinda_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    await update.message.reply_text(
        ABOUT_TEXT,
        reply_markup=kb.back_to_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )


def register_command_handlers(application: Application) -> None:
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("menu", menu_command))
    application.add_handler(CommandHandler("sss", sss_command))
    application.add_handler(CommandHandler("burclar", burclar_command))
    application.add_handler(CommandHandler("hakkinda", hakkinda_command))
