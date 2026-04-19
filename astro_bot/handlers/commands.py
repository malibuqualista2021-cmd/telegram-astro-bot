"""Komut işleyicileri."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from astro_bot.handlers import keyboards as kb
from astro_bot.i18n import Lang, get_lang, t
from astro_bot.services.chart_service import build_synastry_context, format_chart_text
from astro_bot.services.faq_service import FaqService
from astro_bot.services.expert_style import AstroStyle
from astro_bot.services.profile_service import (
    clear_all_user_chart_data,
    clear_partner,
    parse_date_arg,
    parse_lat_lon,
    parse_time_arg,
    parse_tz_arg,
    partner_from_user_data,
    profile_from_user_data,
    save_partner,
    save_profile,
)
from astro_bot.services.user_learning import (
    add_learning_note,
    clear_learning_notes,
    list_notes_for_user,
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
    lines.append(
        f"• house system: {p.house_system}" if lang == "en" else f"• ev sistemi: {p.house_system}"
    )
    st = context.user_data.get("astro_style")
    if isinstance(st, str) and st != "balanced":
        lines.append(f"• style: {st}" if lang == "en" else f"• üslup: {st}")
    pp = partner_from_user_data(context.user_data)
    if pp.birth_date:
        lines.append("" if lang == "en" else "")
        lines.append("<b>Partner</b>" if lang == "en" else "<b>Partner</b>")
        lines.append(
            f"• date: {pp.birth_date.isoformat()}" if lang == "en" else f"• tarih: {pp.birth_date.isoformat()}"
        )
        if pp.birth_time:
            lines.append(
                f"• time: {pp.birth_time.strftime('%H:%M')}"
                if lang == "en"
                else f"• saat: {pp.birth_time.strftime('%H:%M')}"
            )
        lines.append(f"• lat/lon: {pp.lat:.4f}, {pp.lon:.4f}")
        lines.append(f"• tz: {pp.tz_name}")
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


async def pdogum_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("pdogum_bad", lang))
        return
    d = parse_date_arg(" ".join(context.args))
    if not d:
        await update.message.reply_text(t("pdogum_bad", lang))
        return
    save_partner(context.user_data, birth_date=d.isoformat())
    await update.message.reply_text(t("pdogum_ok", lang, d=d.isoformat()))


async def psaat_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("psaat_bad", lang))
        return
    tm = parse_time_arg(" ".join(context.args))
    if not tm:
        await update.message.reply_text(t("psaat_bad", lang))
        return
    save_partner(context.user_data, birth_time=tm.strftime("%H:%M"))
    await update.message.reply_text(t("psaat_ok", lang, t=tm.strftime("%H:%M")))


async def pkonum_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("pkonum_bad", lang))
        return
    ll = parse_lat_lon(list(context.args))
    if not ll:
        await update.message.reply_text(t("pkonum_bad", lang))
        return
    lat, lon = ll
    save_partner(context.user_data, lat=lat, lon=lon)
    await update.message.reply_text(t("pkonum_ok", lang, lat=f"{lat:.4f}", lon=f"{lon:.4f}"))


async def ptz_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("ptz_bad", lang))
        return
    tz = parse_tz_arg(" ".join(context.args))
    if not tz:
        await update.message.reply_text(t("ptz_bad", lang))
        return
    save_partner(context.user_data, tz=tz)
    await update.message.reply_text(t("ptz_ok", lang, tz=tz))


async def psil_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    clear_partner(context.user_data)
    await update.message.reply_text(t("psil_ok", lang))


async def sinastri_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    p = profile_from_user_data(context.user_data)
    pp = partner_from_user_data(context.user_data)
    if not p.birth_date or not pp.birth_date:
        await update.message.reply_text(t("sinastri_need", lang))
        return
    text = build_synastry_context(p, pp, lang, max_chars=3900)
    if not text.strip():
        await update.message.reply_text(t("sinastri_empty", lang))
        return
    await update.message.reply_text(text[:4090])


_STIL_ALIASES: dict[str, AstroStyle] = {
    "dengeli": "balanced",
    "balanced": "balanced",
    "varsayilan": "balanced",
    "klasik": "classical",
    "classical": "classical",
    "geleneksel": "classical",
    "psikolojik": "psychological",
    "psychological": "psychological",
    "populer": "popular",
    "popular": "popular",
    "modern": "popular",
}


async def stil_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("stil_usage", lang))
        return
    raw = context.args[0].strip().lower()
    style = _STIL_ALIASES.get(raw)
    if not style:
        await update.message.reply_text(t("stil_bad", lang))
        return
    context.user_data["astro_style"] = style
    lab = (
        {"balanced": "Balanced", "classical": "Classical", "psychological": "Psychological", "popular": "Popular"}
        if lang == "en"
        else {"balanced": "Dengeli", "classical": "Klasik", "psychological": "Psikolojik", "popular": "Popüler"}
    )
    await update.message.reply_text(t("stil_ok", lang, label=lab[style]), parse_mode=ParseMode.HTML)


_HOUSE_ALIASES = {
    "placidus": "placidus",
    "p": "placidus",
    "whole": "whole",
    "wholesign": "wholesign",
    "tam": "wholesign",
    "equal": "equal",
    "esit": "equal",
    "koch": "koch",
    "campanus": "campanus",
    "regiomontanus": "regiomontanus",
    "regio": "regiomontanus",
    "porphyry": "porphyry",
    "porfiri": "porphyry",
}


async def evsistemi_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("evsistemi_usage", lang))
        return
    raw = context.args[0].strip().lower()
    hs = _HOUSE_ALIASES.get(raw)
    if not hs:
        await update.message.reply_text(t("evsistemi_bad", lang))
        return
    save_profile(context.user_data, house_system=hs)
    await update.message.reply_text(t("evsistemi_ok", lang, hs=hs), parse_mode=ParseMode.HTML)


async def sil_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    clear_all_user_chart_data(context.user_data)
    await update.message.reply_text(t("sil_ok", lang))


async def hatirla_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    if not context.args:
        await update.message.reply_text(t("hatirla_usage", lang))
        return
    raw = " ".join(context.args).strip()
    if add_learning_note(context.user_data, raw):
        await update.message.reply_text(t("hatirla_ok", lang))
    else:
        await update.message.reply_text(t("hatirla_bad", lang))


async def notlarim_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    await update.message.reply_text(
        list_notes_for_user(context.user_data, lang),
        parse_mode=ParseMode.HTML,
    )


async def notlar_temizle_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    lang = get_lang(context.user_data.get("lang"))
    clear_learning_notes(context.user_data)
    await update.message.reply_text(t("notlar_cleared", lang))


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
    application.add_handler(CommandHandler(["hatirla", "remember"], hatirla_command))
    application.add_handler(CommandHandler(["notlarim", "mynotes"], notlarim_command))
    application.add_handler(CommandHandler(["notlartemizle", "clearnotes"], notlar_temizle_command))
    application.add_handler(CommandHandler(["pdogum", "pbirth"], pdogum_command))
    application.add_handler(CommandHandler(["psaat", "ptime"], psaat_command))
    application.add_handler(CommandHandler(["pkonum", "ploc"], pkonum_command))
    application.add_handler(CommandHandler(["ptz", "ptimezone"], ptz_command))
    application.add_handler(CommandHandler(["psil", "pclearpartner"], psil_command))
    application.add_handler(CommandHandler(["sinastri", "synastry"], sinastri_command))
    application.add_handler(CommandHandler(["sil", "delete_my_data"], sil_command))
    application.add_handler(CommandHandler(["stil", "style"], stil_command))
    application.add_handler(CommandHandler(["evsistemi", "housesystem"], evsistemi_command))
