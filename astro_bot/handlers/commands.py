"""Komut işleyicileri."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from astro_bot.handlers import keyboards as kb
from astro_bot.i18n import Lang, get_lang, t
from astro_bot.services.chart_service import format_chart_text
from astro_bot.services.faq_service import FaqService
from astro_bot.services.profile_service import (
    parse_date_arg,
    parse_lat_lon,
    parse_time_arg,
    profile_from_user_data,
    save_profile,
)

logger = logging.getLogger(__name__)


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    context.user_data["chat_history"] = []
    context.user_data["memory_summary"] = ""
    await update.message.reply_text(
        t("start", lang),
        reply_markup=kb.main_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )
    logger.info("Kullanıcı /start: chat_id=%s", update.effective_chat.id if update.effective_chat else None)


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    await update.message.reply_text(
        t("help", lang),
        reply_markup=kb.back_to_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )
    logger.info("Kullanıcı /help: chat_id=%s", update.effective_chat.id if update.effective_chat else None)


async def menu_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    await update.message.reply_text(
        t("menu", lang),
        reply_markup=kb.main_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )


async def lang_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    cur = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(
            "Kullanım: /lang tr veya /lang en\nUsage: /lang tr or /lang en",
        )
        return
    code = context.args[0].strip().lower()
    if code not in ("tr", "en"):
        await update.message.reply_text(
            "Geçersiz. /lang tr veya /lang en\nInvalid. Use /lang tr or /lang en",
        )
        return
    context.user_data["lang"] = code
    new_lang: Lang = "en" if code == "en" else "tr"
    await update.message.reply_text(t("lang_ok", new_lang))


async def profil_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    p = profile_from_user_data(context.user_data)
    if not p.birth_date:
        await update.message.reply_text(t("profil_empty", lang))
        return
    lines = [t("profil_ok", lang)]
    lines.append(f"• date: {p.birth_date.isoformat()}" if lang == "en" else f"• tarih: {p.birth_date.isoformat()}")
    if p.birth_time:
        lines.append(
            f"• time: {p.birth_time.strftime('%H:%M')}"
            if lang == "en"
            else f"• saat: {p.birth_time.strftime('%H:%M')}"
        )
    lines.append(f"• lat/lon: {p.lat:.4f}, {p.lon:.4f}")
    lines.append(f"• tz: {p.tz_name}")
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)


async def dogum_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("dogum_bad", lang))
        return
    raw = " ".join(context.args)
    d = parse_date_arg(raw)
    if not d:
        await update.message.reply_text(t("dogum_bad", lang))
        return
    save_profile(context.user_data, birth_date=d.isoformat())
    await update.message.reply_text(t("dogum_ok", lang, d=d.isoformat()))


async def saat_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("saat_bad", lang))
        return
    raw = " ".join(context.args)
    tm = parse_time_arg(raw)
    if not tm:
        await update.message.reply_text(t("saat_bad", lang))
        return
    save_profile(context.user_data, birth_time=tm.strftime("%H:%M"))
    await update.message.reply_text(t("saat_ok", lang, t=tm.strftime("%H:%M")))


async def konum_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("konum_bad", lang))
        return
    ll = parse_lat_lon(list(context.args))
    if not ll:
        await update.message.reply_text(t("konum_bad", lang))
        return
    lat, lon = ll
    save_profile(context.user_data, lat=lat, lon=lon)
    await update.message.reply_text(t("konum_ok", lang, lat=f"{lat:.4f}", lon=f"{lon:.4f}"))


async def harita_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    p = profile_from_user_data(context.user_data)
    if not p.birth_date:
        await update.message.reply_text(t("chart_need_date", lang))
        return
    text = format_chart_text(p, lang)
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


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
    lang = get_lang(context.user_data.get("lang"))
    await update.message.reply_text(
        t("burclar", lang),
        reply_markup=kb.back_to_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )


async def hakkinda_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    await update.message.reply_text(
        t("about", lang),
        reply_markup=kb.back_to_menu_keyboard(),
        parse_mode=ParseMode.HTML,
    )


def register_command_handlers(application: Application) -> None:
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("menu", menu_command))
    application.add_handler(CommandHandler("lang", lang_command))
    application.add_handler(CommandHandler("profil", profil_command))
    application.add_handler(CommandHandler("dogum", dogum_command))
    application.add_handler(CommandHandler("saat", saat_command))
    application.add_handler(CommandHandler("konum", konum_command))
    application.add_handler(CommandHandler("harita", harita_command))
    application.add_handler(CommandHandler("sss", sss_command))
    application.add_handler(CommandHandler("burclar", burclar_command))
    application.add_handler(CommandHandler("hakkinda", hakkinda_command))
