"""Özel sohbette kullanıcı verisini SQLite/Postgres ile yükle/kaydet."""

from __future__ import annotations

import logging

from telegram import Update
from telegram.constants import ChatType
from telegram.ext import Application, ContextTypes, TypeHandler

from astro_bot.services.user_store import UserStore

logger = logging.getLogger(__name__)


async def load_user_persistence(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.effective_chat:
        return
    if update.effective_chat.type != ChatType.PRIVATE:
        return
    store: UserStore | None = context.bot_data.get("user_store")
    if not store:
        return
    uid = update.effective_user.id
    try:
        data = await store.load(uid)
    except Exception:
        logger.exception("Kullanıcı durumu yüklenemedi user_id=%s", uid)
        return
    if not data:
        return
    for k, v in data.items():
        if v is not None:
            context.user_data[k] = v


async def save_user_persistence(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.effective_chat:
        return
    if update.effective_chat.type != ChatType.PRIVATE:
        return
    store: UserStore | None = context.bot_data.get("user_store")
    if not store:
        return
    uid = update.effective_user.id
    try:
        await store.save(uid, dict(context.user_data))
    except Exception:
        logger.exception("Kullanıcı durumu kaydedilemedi user_id=%s", uid)


def register_persistence_handlers(application: Application) -> None:
    application.add_handler(TypeHandler(Update, load_user_persistence), group=-1)
    application.add_handler(TypeHandler(Update, save_user_persistence), group=100)
