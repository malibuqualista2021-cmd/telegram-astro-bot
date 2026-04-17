"""Telegram güncelleme işleyicileri."""

from astro_bot.handlers.callbacks import register_callback_handlers
from astro_bot.handlers.commands import register_command_handlers
from astro_bot.handlers.messages import register_message_handlers

__all__ = [
    "register_callback_handlers",
    "register_command_handlers",
    "register_message_handlers",
]
