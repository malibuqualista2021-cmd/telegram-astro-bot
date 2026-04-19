"""Hesaplanan Güneş burcu ile yanıttaki açık 'güneşim X' ifadesi çelişirse dipnot ekler."""

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


def _sun_sign_token_from_facts_en(chart_facts: str) -> str | None:
    for line in chart_facts.splitlines():
        if "sun" not in line.lower():
            continue
        m = re.search(r"Sun:\s*([A-Za-z]+)", line, re.I)
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


def _reply_explicit_sun_en(reply: str) -> str | None:
    m = re.search(
        r"(?:my\s+)?sun\s*(?:sign)?\s*(?:is|=|:)?\s*([a-z]+)",
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
    if lang == "en":
        expected = _sun_sign_token_from_facts_en(chart_facts)
        stated = _reply_explicit_sun_en(reply)
        if expected and stated and stated != expected and len(stated) > 3:
            return (
                reply.rstrip()
                + "\n\n— Note: your computed Sun sign in the chart data is "
                + f"{expected.title()}; if that conflicts with a phrase above, prefer the computed data."
            )
    else:
        expected = _sun_sign_token_from_facts_tr(chart_facts)
        stated = _reply_explicit_sun_tr(reply)
        if expected and stated and stated != expected and len(stated) > 2:
            return (
                reply.rstrip()
                + "\n\n— Not: Hesaplanan veride Güneş burcun "
                + f"'{expected}' görünüyor; yukarıda farklı yazdıysam önce bu teknik özete güven."
            )
    return reply
