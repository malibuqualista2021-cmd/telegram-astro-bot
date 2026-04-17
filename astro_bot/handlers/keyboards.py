"""Inline klavye düzenleri."""

from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from astro_bot.services.faq_service import FaqService


def main_menu_keyboard() -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton("📚 SSS konuları", callback_data="cat:root"),
            InlineKeyboardButton("♈ Burçlar", callback_data="static:burclar"),
        ],
        [
            InlineKeyboardButton("❓ Yardım", callback_data="static:help"),
            InlineKeyboardButton("ℹ️ Hakkında", callback_data="static:about"),
        ],
    ]
    return InlineKeyboardMarkup(rows)


def category_list_keyboard(faq: FaqService) -> InlineKeyboardMarkup:
    keys = faq.category_keys_ordered()
    rows: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for i, key in enumerate(keys):
        label = faq.category_label(key)
        row.append(InlineKeyboardButton(label[:32], callback_data=f"cat:{key}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton("⬅️ Ana menü", callback_data="menu:root")])
    return InlineKeyboardMarkup(rows)


def faq_items_keyboard(faq: FaqService, category: str) -> InlineKeyboardMarkup:
    entries = faq.entries_in_category(category)
    rows: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for i, e in enumerate(entries):
        title = e.title[:40] if len(e.title) > 40 else e.title
        row.append(InlineKeyboardButton(f"• {title}", callback_data=f"faq:{e.entry_id}"))
        if len(row) == 1:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append(
        [
            InlineKeyboardButton("⬅️ Kategoriler", callback_data="cat:root"),
            InlineKeyboardButton("🏠 Menü", callback_data="menu:root"),
        ]
    )
    return InlineKeyboardMarkup(rows)


def back_to_menu_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("🏠 Ana menü", callback_data="menu:root")]]
    )
