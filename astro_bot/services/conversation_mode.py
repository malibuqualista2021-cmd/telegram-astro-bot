"""Sohbet içi konuşma modu — komut yok; doğal dilde mod değişimi."""

from __future__ import annotations

import re
from typing import Literal

ChatMode = Literal["default", "info", "daily", "chatty", "chart", "horary"]

_MODE_ORDER: tuple[ChatMode, ...] = ("default", "info", "daily", "chatty", "chart", "horary")

# (regex with re.I, mode) — uzun eşleşmeler önce denenir
_PATTERNS_TR: list[tuple[re.Pattern[str], ChatMode]] = [
    (re.compile(r"\b(?:artık\s+)?(?:normal|varsayılan)\s+mod(?:a)?(?:\s+(?:geç|dön))?\b", re.I), "default"),
    (re.compile(r"\bmodu?\s+sıfırla\b", re.I), "default"),
    (re.compile(r"\bfabrika\s+ayar(?:ı|ına)?\b", re.I), "default"),
    (re.compile(r"\b(?:bundan\s+sonra\s+)?sadece\s+bilgi(?:\s+modu)?\b", re.I), "info"),
    (re.compile(r"\bansiklopedik(?:\s+mod)?\b", re.I), "info"),
    (re.compile(r"\böğretici\s+mod\b", re.I), "info"),
    (re.compile(r"\bders\s+gibi\s+anlat\b", re.I), "info"),
    (re.compile(r"\bkuru\s+bilgi\b", re.I), "info"),
    (re.compile(r"\bgünlük\s+fal(?:\s+tarzı)?\b", re.I), "daily"),
    (re.compile(r"\bfal\s+tarzı(?:nda)?\b", re.I), "daily"),
    (re.compile(r"\bgünlük\s+tema\b", re.I), "daily"),
    (re.compile(r"\byıldız\s+yorumu\s+gibi\b", re.I), "daily"),
    (re.compile(r"\bsohbet\s+gibi\b", re.I), "chatty"),
    (re.compile(r"\bsamimi\s+konuş\b", re.I), "chatty"),
    (re.compile(r"\bdostça(?:\s+ol)?\b", re.I), "chatty"),
    (re.compile(r"\brahat\s+bir\s+üslupla\b", re.I), "chatty"),
    (re.compile(r"\bdoğum\s+haritam(?:a|ı)?\s+göre\b", re.I), "chart"),
    (re.compile(r"\bharitam(?:a|ı)?\s+göre\b", re.I), "chart"),
    (re.compile(r"\bprofilime\s+göre\b", re.I), "chart"),
    (re.compile(r"\bnatal(?:e)?\s+haritam(?:a|ı)?\s+göre\b", re.I), "chart"),
    (re.compile(r"\bhorary\b", re.I), "horary"),
    (re.compile(r"\bsaat\s+astrolojisi(?:\s+modu)?\b", re.I), "horary"),
    (re.compile(r"\bsoru\s+haritası(?:\s+modu)?\b", re.I), "horary"),
    (re.compile(r"\bsoru\s+anı\s+haritası\b", re.I), "horary"),
]

_PATTERNS_EN: list[tuple[re.Pattern[str], ChatMode]] = [
    (re.compile(r"\b(?:back\s+to\s+)?(?:normal|default)\s+mode\b", re.I), "default"),
    (re.compile(r"\breset\s+mode\b", re.I), "default"),
    (re.compile(r"\bfacts?\s+only(?:\s+mode)?\b", re.I), "info"),
    (re.compile(r"\bencyclopedia\s+style\b", re.I), "info"),
    (re.compile(r"\bteaching\s+mode\b", re.I), "info"),
    (re.compile(r"\bdaily\s+horoscope\s+style\b", re.I), "daily"),
    (re.compile(r"\bhoroscope\s+style\b", re.I), "daily"),
    (re.compile(r"\bchatty(?:\s+(?:tone|mode))?\b", re.I), "chatty"),
    (re.compile(r"\bcasual\s+tone\b", re.I), "chatty"),
    (re.compile(r"\bfriendly\s+tone\b", re.I), "chatty"),
    (re.compile(r"\bbased\s+on\s+my\s+(?:birth\s+)?chart\b", re.I), "chart"),
    (re.compile(r"\busing\s+my\s+profile\b", re.I), "chart"),
    (re.compile(r"\bnatal\s+chart\s+context\b", re.I), "chart"),
    (re.compile(r"\bhorary\b", re.I), "horary"),
    (re.compile(r"\bhorary\s+astrology\b", re.I), "horary"),
    (re.compile(r"\bquestion\s+chart\s+mode\b", re.I), "horary"),
]


def _normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse_chat_mode_phrases(text: str, lang: str) -> tuple[ChatMode | None, str]:
    """Mod ifadelerini metinden çıkarır. Dönüş: (son eşleşen mod veya None, LLM'e gidecek temiz metin)."""
    if not (text or "").strip():
        return None, ""

    patterns = _PATTERNS_EN if lang == "en" else _PATTERNS_TR
    cleaned = text
    last_mode: ChatMode | None = None

    for _ in range(24):
        best: tuple[int, int, ChatMode] | None = None
        for pat, mode in patterns:
            m = pat.search(cleaned)
            if m:
                span = (m.start(), m.end(), mode)
                if best is None or span[0] < best[0]:
                    best = span
        if best is None:
            break
        start, end, mode = best
        cleaned = cleaned[:start] + " " + cleaned[end:]
        last_mode = mode
        cleaned = _normalize_ws(cleaned)

    return last_mode, cleaned


def normalize_chat_mode(raw: object) -> ChatMode:
    if isinstance(raw, str) and raw in _MODE_ORDER:
        return raw  # type: ignore[return-value]
    return "default"


def mode_system_instruction(mode: ChatMode, lang: str) -> str:
    """Sistem prompt'una eklenecek ek üslup talimatı."""
    if mode == "default":
        return ""

    if lang == "en":
        if mode == "info":
            return (
                "Conversation mode: user asked for factual / teaching tone. Clear definitions are OK, but still connect ideas "
                "like an astrologer explaining—not a dry encyclopedia list unless they want lists."
            )
        if mode == "daily":
            return (
                "Conversation mode: daily-horoscope style. Short symbolic themes and mood-flavour wording only; "
                "no predictions of specific future events; remind that it is symbolic."
            )
        if mode == "chatty":
            return (
                "Conversation mode: warm and chatty. A bit more personality and empathy in tone; "
                "still accurate on astrology basics and safety rules."
            )
        if mode == "chart":
            return (
                "Conversation mode: natal / profile-first. Interpret placements as a practitioner would—themes, house emphasis, "
                "tensions; if birth data is thin, say what’s missing and still reason interpretively, not generically."
            )
        if mode == "horary":
            return (
                "Conversation mode: horary. A full chart-data block (houses Placidus or whole-sign fallback, Asc ruler, major aspects) "
                "is in the system message—your answer MUST interpret that data in a coherent narrative. "
                "Forbidden: generic pop Sun-sign boilerplate not tied to those placements. "
                "Use symbolic, conditional language; no legal/medical/financial verdicts."
            )
    else:
        if mode == "info":
            return (
                "Konuşma modu: kullanıcı bilgi/öğretici ton istedi. Tanım verebilirsin ama mümkünse astroloğun anlatımı gibi bağla; "
                "kuru madde listesinden kaçın (liste özellikle istenmedikçe)."
            )
        if mode == "daily":
            return (
                "Konuşma modu: günlük fal / tema tarzı. Kısa, sembolik tema ve havadan bahset; "
                "belirli gelecek olayları kehanet etme; bunun sembolik çerçeve olduğunu ima et."
            )
        if mode == "chatty":
            return (
                "Konuşma modu: samimi sohbet. Biraz daha sıcak ve doğal üslup; "
                "astroloji içeriği ve güvenlik kuralları aynı kalır."
            )
        if mode == "chart":
            return (
                "Konuşma modu: doğum / profil öncelikli. Veriyi bir yorumcu gibi işle: temalar, ev vurgusu, gerilimler; "
                "veri eksikse neyin eksik olduğunu söyle, yine de yorumlayıcı üslup kullan."
            )
        if mode == "horary":
            return (
                "Konuşma modu: horary. Sistem mesajında evler (Placidus veya tam burç yedek), yükselen yöneticisi ve majör açılar var; "
                "yanıtın BUNLARI sentezleyerek bir bütün olarak yorumlanmalı. "
                "Yasak: o veriye bağlanmadan internetteki gibi düz Güneş burcu kişilik metni. "
                "Sembolik ve koşullu dil kullan; hukuki/tıbbi/finansal kesin hüküm yok."
            )
    return ""


def mode_ack_message(mode: ChatMode, lang: str) -> str:
    """Yalnızca mod değiştiği ve soru metni kalmadığında gönderilecek kısa onay."""
    if lang == "en":
        hints = {
            "default": "balanced style",
            "info": "more educational, facts-first",
            "daily": "short symbolic daily-style themes",
            "chatty": "warmer, more conversational",
            "chart": "using your chart / profile context when available",
            "horary": "horary-style replies using the chart for each message’s time (UTC)",
        }
        return (
            f"Got it — I'll answer in {hints[mode]} from now on. "
            "Ask anything about astrology in your own words."
        )
    hints_tr = {
        "default": "dengeli üslup",
        "info": "daha öğretici, bilgi öncelikli",
        "daily": "kısa, sembolik günlük tema tarzı",
        "chatty": "daha samimi sohbet tonu",
        "chart": "mümkünse doğum / harita bağlamını öne çıkararak",
        "horary": "her mesajın gönderildiği ana göre soru haritası (horary) çerçevesinde",
    }
    return (
        f"Tamam — bundan sonra yanıtlarım {hints_tr[mode]} olacak. "
        "Astrolojiyle ilgili sorunu düz yazıyla yazman yeterli."
    )
