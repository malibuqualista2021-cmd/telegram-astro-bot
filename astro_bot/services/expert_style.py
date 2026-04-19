"""Astroloji yorum üslubu: klasik / psikolojik / popüler / dengeli."""

from __future__ import annotations

import re
from typing import Any, Literal

AstroStyle = Literal["balanced", "classical", "psychological", "popular"]

_STYLE_ORDER: tuple[AstroStyle, ...] = ("balanced", "classical", "psychological", "popular")

_PATTERNS_TR: list[tuple[re.Pattern[str], AstroStyle]] = [
    (re.compile(r"\b(?:klasik|geleneksel)\s+(?:astroloji|yorum|üslup)\b", re.I), "classical"),
    (re.compile(r"\bklasik\s+mod\b", re.I), "classical"),
    (re.compile(r"\bpsikolojik\s+astroloji\b", re.I), "psychological"),
    (re.compile(r"\bpsikolojik\s+mod\b", re.I), "psychological"),
    (re.compile(r"\b(?:popüler|modern)\s+(?:astroloji|yorum)\b", re.I), "popular"),
    (re.compile(r"\binstagram\s+tarzı\b", re.I), "popular"),
    (re.compile(r"\bdengeli\s+üslup\b", re.I), "balanced"),
    (re.compile(r"\bvarsayılan\s+üslup\b", re.I), "balanced"),
]

_PATTERNS_EN: list[tuple[re.Pattern[str], AstroStyle]] = [
    (re.compile(r"\bclassical\s+(?:astrology|style)\b", re.I), "classical"),
    (re.compile(r"\bpsychological\s+astrology\b", re.I), "psychological"),
    (re.compile(r"\bpopular\s+astrology\b", re.I), "popular"),
    (re.compile(r"\bmodern\s+sun-?sign\s+style\b", re.I), "popular"),
    (re.compile(r"\bbalanced\s+style\b", re.I), "balanced"),
]


def _normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse_astro_style_phrases(text: str, lang: str) -> tuple[AstroStyle | None, str]:
    if not (text or "").strip():
        return None, ""
    patterns = _PATTERNS_EN if lang == "en" else _PATTERNS_TR
    cleaned = text
    last: AstroStyle | None = None
    for _ in range(12):
        best: tuple[int, int, AstroStyle] | None = None
        for pat, style in patterns:
            m = pat.search(cleaned)
            if m:
                span = (m.start(), m.end(), style)
                if best is None or span[0] < best[0]:
                    best = span
        if best is None:
            break
        start, end, style = best
        cleaned = cleaned[:start] + " " + cleaned[end:]
        last = style
        cleaned = _normalize_ws(cleaned)
    return last, cleaned


def normalize_astro_style(raw: object) -> AstroStyle:
    if isinstance(raw, str) and raw in _STYLE_ORDER:
        return raw  # type: ignore[return-value]
    return "balanced"


def astro_style_instruction(style: AstroStyle, lang: str) -> str:
    if style == "balanced":
        return ""
    if lang == "en":
        if style == "classical":
            return (
                "Expert style: classical/traditional emphasis—dignities, sect (if relevant), "
                "clear rulerships, lean on established techniques; avoid pop-psych fluff; stay readable."
            )
        if style == "psychological":
            return (
                "Expert style: psychological / humanistic—archetypes, inner dynamics, growth framing; "
                "still respect computed chart facts; no clinical diagnosis."
            )
        return (
            "Expert style: popular/modern accessible—plain language, relatable examples, light on jargon; "
            "still accurate to computed data; no clickbait fear or fate."
        )
    if style == "classical":
        return (
            "Uzman üslup: klasik/geleneksel vurgu — itibarlar, yöneticiler, geleneksel tekniklere sadık kal; "
            "popüler psikoloji diliyle sulandırma; yine de okunaklı ol."
        )
    if style == "psychological":
        return (
            "Uzman üslup: psikolojik/insancıl — arketip, iç dinamik, gelişim çerçevesi; "
            "hesaplanan harita gerçeklerine saygı; klinik tanı yok."
        )
    return (
        "Uzman üslup: popüler/modern — sade dil, günlük hayata yakın örnekler; "
        "hesaplanan veriye sadık kal; korku/kader tıkamacı yok."
    )


def get_astro_style(ud: dict[str, Any]) -> AstroStyle:
    return normalize_astro_style(ud.get("astro_style"))
