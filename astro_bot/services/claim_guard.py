"""Hesaplanan Güneş/Ay burcu ile yanıttaki açık ifadeler çelişirse dipnot ekler."""

from __future__ import annotations

import re


def _tr_norm(s: str) -> str:
    t = s.lower().strip()
    for a, b in (("ı", "i"), ("ğ", "g"), ("ü", "u"), ("ş", "s"), ("ö", "o"), ("ç", "c")):
        t = t.replace(a, b)
    return t


def _sun_sign_token_from_facts_tr(chart_facts: str) -> str | None:
    for line in chart_facts.splitlines():
        if "güneş" not in line.lower():
            continue
        m = re.search(r"Güneş:\s*([A-Za-zÇçĞğİıÖöŞşÜüâÂ]+)", line)
        if m:
            return _tr_norm(m.group(1))
    return None


def _moon_sign_token_from_facts_tr(chart_facts: str) -> str | None:
    for line in chart_facts.splitlines():
        if "ay:" in line.lower() and "düğüm" not in line.lower():
            m = re.search(r"Ay:\s*([A-Za-zÇçĞğİıÖöŞşÜüâÂ]+)", line, re.I)
            if m:
                return _tr_norm(m.group(1))
    return None


def _sun_sign_token_from_facts_en(chart_facts: str) -> str | None:
    for line in chart_facts.splitlines():
        if "sun" not in line.lower():
            continue
        m = re.search(r"Sun:\s*([A-Za-z]+)", line, re.I)
        if m:
            return m.group(1).lower().strip()
    return None


def _moon_sign_token_from_facts_en(chart_facts: str) -> str | None:
    for line in chart_facts.splitlines():
        if re.search(r"^-\s*Moon:", line, re.I):
            m = re.search(r"Moon:\s*([A-Za-z]+)", line, re.I)
            if m:
                return m.group(1).lower().strip()
    return None


def _reply_explicit_sun_tr(reply: str) -> str | None:
    r = reply.lower()
    patterns = [
        r"güneş(?:im| burcum)?\s*(?:burcu)?\s*(?:olarak)?\s*:?\s*([a-zçğıöşüâ]+)",
        r"güneş\s+burcu(?:m|mu)?\s*:?\s*([a-zçğıöşüâ]+)",
    ]
    for pat in patterns:
        m = re.search(pat, r)
        if m:
            return _tr_norm(m.group(1))
    return None


def _reply_explicit_moon_tr(reply: str) -> str | None:
    r = reply.lower()
    patterns = [
        r"ay\s+burcu(?:m|mu)?\s*:?\s*([a-zçğıöşüâ]+)",
        r"ay(?:im)?\s*(?:burcu)?\s*(?:olarak)?\s*:?\s*([a-zçğıöşüâ]+)",
    ]
    for pat in patterns:
        m = re.search(pat, r)
        if m:
            return _tr_norm(m.group(1))
    return None


def _reply_explicit_sun_en(reply: str) -> str | None:
    m = re.search(
        r"(?:my\s+)?sun\s*(?:sign)?\s*(?:is|=|:)?\s*([a-z]+)",
        reply.lower(),
    )
    if m:
        return m.group(1).strip()
    return None


def _reply_explicit_moon_en(reply: str) -> str | None:
    m = re.search(
        r"(?:my\s+)?moon\s*(?:sign)?\s*(?:is|=|:)?\s*([a-z]+)",
        reply.lower(),
    )
    if m:
        return m.group(1).strip()
    return None


def maybe_append_data_footnote(
    reply: str,
    chart_facts: str,
    *,
    lang: str,
) -> str:
    if not reply.strip() or not chart_facts.strip():
        return reply
    notes: list[str] = []
    if lang == "en":
        exp_s = _sun_sign_token_from_facts_en(chart_facts)
        st_s = _reply_explicit_sun_en(reply)
        if exp_s and st_s and st_s != exp_s and len(st_s) > 3:
            notes.append(
                f"Note: computed Sun sign in chart data is {exp_s.title()}; prefer that over a conflicting phrase above."
            )
        exp_m = _moon_sign_token_from_facts_en(chart_facts)
        st_m = _reply_explicit_moon_en(reply)
        if exp_m and st_m and st_m != exp_m and len(st_m) > 3:
            notes.append(
                f"Note: computed Moon sign in chart data is {exp_m.title()}; Moon moves quickly—trust the block if unsure."
            )
    else:
        exp_s = _sun_sign_token_from_facts_tr(chart_facts)
        st_s = _reply_explicit_sun_tr(reply)
        if exp_s and st_s and st_s != exp_s and len(st_s) > 2:
            notes.append(
                f"Not: Hesaplanan Güneş burcun '{exp_s}'; yukarıda çelişki varsa önce teknik özete güven."
            )
        exp_m = _moon_sign_token_from_facts_tr(chart_facts)
        st_m = _reply_explicit_moon_tr(reply)
        if exp_m and st_m and st_m != exp_m and len(st_m) > 2:
            notes.append(
                f"Not: Hesaplanan Ay burcun '{exp_m}'; Ay hızlı ilerler, emin değilsen hesap satırına bak."
            )
    if not notes:
        return reply
    sep = "\n\n— " if lang == "en" else "\n\n— "
    return reply.rstrip() + sep + ("\n— ".join(notes))
