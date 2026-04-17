"""Basit niyet sınıflandırması (anahtar kelime; ağır LLM yok)."""

from __future__ import annotations

import re
from typing import Literal

Intent = Literal["info", "horoscope", "joke", "other"]


def classify_intent(text: str, lang: str) -> Intent:
    t = text.lower().strip()
    if not t:
        return "other"

    if lang == "en":
        if re.search(
            r"\b(joke|funny|lol|haha|meme)\b",
            t,
            re.I,
        ):
            return "joke"
        if re.search(
            r"\b(today|tomorrow|horoscope|luck|fortune|will i|should i)\b",
            t,
            re.I,
        ):
            return "horoscope"
        return "info"

    # Turkish
    if re.search(
        r"\b(şaka|espri|komik|haha|xd|gül)\b",
        t,
        re.I,
    ):
        return "joke"
    if re.search(
        r"\b(bugün|yarın|fal|kehanet|şansım|ne olacak|bana söyle|yıldızım|burcum)\b",
        t,
        re.I,
    ):
        return "horoscope"
    return "info"


def intent_instruction(intent: Intent, lang: str) -> str:
    if intent == "joke":
        if lang == "en":
            return "Intent: light playful tone; still no medical/legal/financial advice; one short witty line if appropriate, else gentle decline."
        return "Niyet: hafif şaka tonu; yine de tıbbi/hukuki/finans yok; uygunsa çok kısa espri, değilse nazikçe reddet."
    if intent == "horoscope":
        if lang == "en":
            return "Intent: user sounds like daily horoscope-style question. Give symbolic, non-predictive general themes only; no certainty about future events."
        return "Niyet: günlük fal/kehanet tarzı. Kesin gelecek iddiası yok; sembolik genel temalar, kısa ve güvenli."
    return ""
