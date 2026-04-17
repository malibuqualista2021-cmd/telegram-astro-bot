"""Basit niyet sınıflandırması (anahtar kelime; ağır LLM yok)."""

from __future__ import annotations

import re
from typing import Literal

Intent = Literal["info", "horoscope", "joke", "chat", "other"]


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
        if re.match(
            r"^(hi|hello|hey|good morning|good evening|good afternoon)\b[!.\s]*$",
            t,
            re.I,
        ):
            return "chat"
        if re.match(r"^(how are you|what\'?s up|how\'?s it going)\b", t, re.I) and len(t) < 50:
            return "chat"
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
    if re.match(
        r"^(merhaba|selam|sa\b|hey|günaydın|iyi\s+akşamlar|iyi\s+günler)\b[!.\s]*$",
        t,
        re.I,
    ):
        return "chat"
    if re.match(
        r"^(nasılsın|naber|napıyorsun|ne haber)\b[!.\s?]*$",
        t,
        re.I,
    ):
        return "chat"
    if len(t) <= 42 and re.match(
        r"^(merhaba|selam|hey)\b",
        t,
        re.I,
    ):
        return "chat"
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
    if intent == "chat":
        if lang == "en":
            return (
                "Intent: greeting or small talk. Reply in a warm, natural chatty way (1–4 short sentences); "
                "invite them to ask anything about astrology in plain words—no slash commands required."
            )
        return (
            "Niyet: selamlaşma veya kısa sohbet açılışı. Samimi, sohbetvari 1–4 kısa cümleyle yanıt ver; "
            "astrolojiyle ilgili istediğini düz yazıyla sorabileceğini hatırlat (/komut şart değil)."
        )
    return ""
