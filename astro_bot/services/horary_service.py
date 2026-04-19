"""Horary (soru anı) — soru geldiği Telegram mesajının UTC zamanı + konum; evler, yönetici, açılar."""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

from astro_bot.i18n import Lang
from astro_bot.services.chart_service import (
    _ascendant_deg,
    _positions_ephem,
    _tropical_longitude_ephem,
    sign_name,
)

logger = logging.getLogger(__name__)

# Klasik yükselen burç yöneticisi (modern gezegen yok)
_SIGN_RULER_EN = (
    "Mars",
    "Venus",
    "Mercury",
    "Moon",
    "Sun",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Saturn",
    "Jupiter",
)

_PLANET_KEYS = ("Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn")


def _sign_idx(lon_deg: float) -> int:
    return int(lon_deg // 30) % 12


def _planet_lon_ephem(dt_utc: datetime, lat_deg: float, lon_deg: float, name: str) -> float:
    import ephem

    obs = ephem.Observer()
    obs.lat = str(lat_deg)
    obs.lon = str(lon_deg)
    obs.pressure = 0
    obs.horizon = "0"
    obs.date = dt_utc.strftime("%Y/%m/%d %H:%M:%S")
    body = getattr(ephem, name)()
    return _tropical_longitude_ephem(body, obs)


def _house_placidus(lon: float, cusps_1_12: list[float]) -> int:
    """cusps[i] = i. ev başlangıcı (1..12)."""
    lon = lon % 360
    c = [cusps_1_12[i] % 360 for i in range(12)]
    for i in range(12):
        a, b = c[i], c[(i + 1) % 12]
        if a <= b:
            if a <= lon < b or (i == 11 and abs(lon - b) < 1e-9):
                return i + 1
        else:
            if lon >= a or lon < b:
                return i + 1
    return 1


def _house_whole_sign(planet_lon: float, asc_lon: float) -> int:
    p = _sign_idx(planet_lon)
    a = _sign_idx(asc_lon)
    return (p - a) % 12 + 1


def _aspect_pairs(lons: dict[str, float], orb: float = 7.0) -> list[tuple[str, str, str, float]]:
    """Majör açılar: kavuşum, karşıt, kare, üçgen, altılı."""
    keys = [k for k in _PLANET_KEYS if k in lons]
    out: list[tuple[str, str, str, float]] = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = keys[i], keys[j]
            d = abs(lons[a] - lons[b]) % 360
            sep = min(d, 360 - d)
            label = ""
            if sep <= orb:
                label = "conjunction"
            elif abs(sep - 180) <= orb:
                label = "opposition"
            elif abs(sep - 90) <= orb:
                label = "square"
            elif abs(sep - 120) <= orb:
                label = "trine"
            elif abs(sep - 60) <= orb:
                label = "sextile"
            if label:
                out.append((a, b, label, sep))
    return sorted(out, key=lambda x: x[3])


def _horary_swisseph(
    dt_utc: datetime,
    lat_deg: float,
    lon_deg: float,
) -> tuple[dict[str, float], float, float, str, list[float] | None] | None:
    try:
        import swisseph as swe
    except ImportError:
        return None

    try:
        swe.set_ephe_path("")
        y, m, d = dt_utc.year, dt_utc.month, dt_utc.day
        ut = (
            dt_utc.hour
            + dt_utc.minute / 60.0
            + dt_utc.second / 3600.0
            + dt_utc.microsecond / 3.6e9
        )
        jd = swe.julday(y, m, d, ut, swe.GREG_CAL)
        flg = swe.FLG_SWIEPH | swe.FLG_SPEED
        pairs = [
            ("Sun", swe.SUN),
            ("Moon", swe.MOON),
            ("Mercury", swe.MERCURY),
            ("Venus", swe.VENUS),
            ("Mars", swe.MARS),
            ("Jupiter", swe.JUPITER),
            ("Saturn", swe.SATURN),
        ]
        lons: dict[str, float] = {}
        for label, pid in pairs:
            xx, _ = swe.calc_ut(jd, pid, flg)
            lons[label] = float(xx[0]) % 360
        cusps, ascmc = swe.houses(jd, lat_deg, lon_deg, b"P")
        asc = float(ascmc[0]) % 360
        mc = float(ascmc[1]) % 360
        c12 = [float(cusps[i]) for i in range(1, 13)]
        return lons, asc, mc, "Swiss Ephemeris (Placidus)", c12
    except Exception:
        logger.exception("Horary Swiss hesap hatası")
        return None


def _horary_ephem_fallback(
    dt_utc: datetime,
    lat_deg: float,
    lon_deg: float,
) -> tuple[dict[str, float], float, float, str, None]:
    lon_sun, lon_moon, lon_asc = _positions_ephem(dt_utc, lat_deg, lon_deg)
    lons = {
        "Sun": lon_sun,
        "Moon": lon_moon,
        "Mercury": _planet_lon_ephem(dt_utc, lat_deg, lon_deg, "Mercury"),
        "Venus": _planet_lon_ephem(dt_utc, lat_deg, lon_deg, "Venus"),
        "Mars": _planet_lon_ephem(dt_utc, lat_deg, lon_deg, "Mars"),
        "Jupiter": _planet_lon_ephem(dt_utc, lat_deg, lon_deg, "Jupiter"),
        "Saturn": _planet_lon_ephem(dt_utc, lat_deg, lon_deg, "Saturn"),
    }
    import ephem

    obs = ephem.Observer()
    obs.lat = str(lat_deg)
    obs.lon = str(lon_deg)
    obs.pressure = 0
    obs.horizon = "0"
    obs.date = dt_utc.strftime("%Y/%m/%d %H:%M:%S")
    lst_rad = float(obs.sidereal_time())
    ramc_deg = math.degrees(lst_rad) % 360
    lat_rad = float(obs.lat) * 180.0 / math.pi
    mc_approx = _ascendant_deg(ramc_deg, lat_rad)
    return lons, lon_asc, mc_approx, "ephem (whole-sign houses from Asc)", None


def format_horary_context(
    question_utc: datetime,
    lat_deg: float,
    lon_deg: float,
    lang: Lang,
    *,
    used_custom_location: bool,
) -> str:
    """LLM: haritaya özgü ev, yönetici, açılar + yorum talimatı (genel burç metni yasak)."""
    try:
        q = question_utc.astimezone(timezone.utc)
    except Exception:
        logger.exception("Horary UTC dönüşümü")
        q = question_utc.replace(tzinfo=timezone.utc) if question_utc.tzinfo is None else question_utc

    pack = _horary_swisseph(q, lat_deg, lon_deg)
    if pack is None:
        lons, asc, mc, src, cusps = _horary_ephem_fallback(q, lat_deg, lon_deg)
    else:
        lons, asc, mc, src, cusps = pack

    asc_idx = _sign_idx(asc)
    ruler_name = _SIGN_RULER_EN[asc_idx]
    ruler_lon = lons.get(ruler_name)
    if ruler_lon is None:
        ruler_name = "Mercury"
        ruler_lon = lons["Mercury"]

    labels_tr = {
        "Sun": "Güneş",
        "Moon": "Ay",
        "Mercury": "Merkür",
        "Venus": "Venüs",
        "Mars": "Mars",
        "Jupiter": "Jüpiter",
        "Saturn": "Satürn",
    }
    asp_tr = {
        "conjunction": "kavuşum",
        "opposition": "karşıt",
        "square": "kare",
        "trine": "üçgen",
        "sextile": "altılı",
    }

    house_lines: list[str] = []
    for key in _PLANET_KEYS:
        lon = lons[key]
        if cusps is not None:
            hn = _house_placidus(lon, cusps)
            hnote = f"ev {hn} (Placidus)"
        else:
            hn = _house_whole_sign(lon, asc)
            hnote = f"ev {hn} (Yükselen’e göre tam burç)"
        if lang == "en":
            house_lines.append(f"{key}: {sign_name(_sign_idx(lon), lang)} ~{lon:.1f}°, {hnote}")
        else:
            house_lines.append(f"{labels_tr[key]}: {sign_name(_sign_idx(lon), lang)} ~{lon:.1f}°, {hnote}")

    aspects = _aspect_pairs(lons)
    asp_lines: list[str] = []
    for p1, p2, kind, sep in aspects[:14]:
        if lang == "en":
            asp_lines.append(f"{p1}–{p2}: {kind} (~{sep:.1f}°)")
        else:
            asp_lines.append(f"{labels_tr.get(p1, p1)}–{labels_tr.get(p2, p2)}: {asp_tr.get(kind, kind)} (~{sep:.1f}°)")

    rh = _house_placidus(ruler_lon, cusps) if cusps is not None else _house_whole_sign(ruler_lon, asc)
    if cusps is not None:
        c7_lon = float(cusps[6]) % 360
        sig7_idx = _sign_idx(c7_lon)
    else:
        sig7_idx = (asc_idx + 6) % 12
        c7_lon = float(sig7_idx * 30)
    seventh_ruler = _SIGN_RULER_EN[sig7_idx]
    moon_h = _house_placidus(lons["Moon"], cusps) if cusps is not None else _house_whole_sign(lons["Moon"], asc)

    if lang == "en":
        ruler_line = (
            f"Ascendant ruler (traditional): {ruler_name} in {sign_name(_sign_idx(ruler_lon), lang)} "
            f"~{ruler_lon:.1f}°, house {rh}."
        )
        sig_line = (
            f"Simplified significators (relationship / ‘other person’ questions): "
            f"1st house / Asc theme ≈ querent; 7th house cusp ≈ {sign_name(sig7_idx, lang)} (~{c7_lon:.1f}°), "
            f"its traditional ruler = {seventh_ruler} (check that planet’s sign/house/aspects below). "
            f"Moon is often read for the situation—here Moon is in house {moon_h}."
        )
    else:
        ruler_line = (
            f"Yükselen yöneticisi (klasik): {labels_tr.get(ruler_name, ruler_name)} → "
            f"{sign_name(_sign_idx(ruler_lon), lang)} ~{ruler_lon:.1f}°, {rh}. ev."
        )
        sig_line = (
            f"Basitleştirilmiş sigifikatörler (ilişki / ‘karşı taraf’ soruları): "
            f"1. ev / yükselen teması ≈ soruyu soran; 7. ev başı ≈ {sign_name(sig7_idx, lang)} (~{c7_lon:.1f}°), "
            f"klasik yönetici = {labels_tr.get(seventh_ruler, seventh_ruler)} — aşağıda o gezegenin burç/ev/açılarına bak. "
            f"Ay sıkça durum/temayı gösterir; burada Ay {moon_h}. evde."
        )

    lines: list[str] = []
    if lang == "en":
        lines.append("=== Horary chart data (interpret THIS, not generic Sun-sign text) ===")
        lines.append(f"Engine / houses: {src}. Question time = when this Telegram message was sent (UTC).")
        lines.append(
            f"Location: lat {lat_deg:.4f}, lon {lon_deg:.4f}"
            + (" (saved /konum)." if used_custom_location else " (default Istanbul if /konum not set).")
        )
        lines.append(f"UTC: {q.isoformat()}")
        lines.append(f"Asc ~{asc:.1f}° ({sign_name(asc_idx, lang)}), MC ~{mc:.1f}° ({sign_name(_sign_idx(mc), lang)}).")
        lines.append(ruler_line)
        lines.append(sig_line)
        lines.append("Planet longitudes & houses:")
        lines.extend(house_lines)
        if asp_lines:
            lines.append("Major aspects (orb ~7°):")
            lines.extend(asp_lines)
        lines.append(
            "INTERPRETATION RULES: Tie sentences to Asc ruler, Moon, 7th-house line, aspects—no generic blurbs. "
            "CRITICAL: This block is the QUESTION-MOMENT chart only. If COMPUTED_ASTRO_DATA / natal data also appears, "
            "never assign natal Moon/Sun/houses to this moment; cite ONLY this block for ‘now / chart of the question’ placements. "
            "FORBIDDEN: repeating the same placement paragraph you already wrote in your last reply (copy-paste loop); "
            "at most one short callback. Max 1–2 clarifying questions per thread turn; once the user answers, give a concise "
            "symbolic synthesis / ‘lean’—do not chain endless finer questions (which market, which pair, which strategy). "
            "Money/crypto/FX: no buy/sell, profit dates, or trading calls—symbolic themes only; not financial advice. "
            "No mind-reading certainties. Conditional phrasing. No legal/medical verdicts."
        )
    else:
        lines.append("=== Horary harita verisi (yorumu BUNA dayandır; hazır burç kalıbı kullanma) ===")
        lines.append(f"Hesap / evler: {src}. Soru anı = bu Telegram mesajının gönderildiği zaman (UTC).")
        lines.append(
            f"Konum: enlem {lat_deg:.4f}, boylam {lon_deg:.4f}"
            + (" (/konum kayıtlı)." if used_custom_location else " (/konum yoksa varsayılan İstanbul).")
        )
        lines.append(f"UTC: {q.isoformat()}")
        lines.append(
            f"Yükselen ~{asc:.1f}° ({sign_name(asc_idx, lang)}), MC ~{mc:.1f}° ({sign_name(_sign_idx(mc), lang)})."
        )
        lines.append(ruler_line)
        lines.append(sig_line)
        lines.append("Gezegenler ve evler:")
        lines.extend(house_lines)
        if asp_lines:
            lines.append("Öne çıkan majör açılar (~7° orb):")
            lines.extend(asp_lines)
        lines.append(
            "YORUM KURALLARI: Yükselen yöneticisi, Ay, 7. ev hattı ve açıları birlikte oku; her iddiayı veriye bağla. "
            "KRİTİK: Bu blok yalnızca SORU ANI haritasıdır. Sistemde COMPUTED_ASTRO_DATA / doğum verisi de varsa, "
            "natal Ay/Güneş/evleri soru anıyla ASLA karıştırma; ‘şimdi / soru haritası’ için yalnızca bu bloktaki konumları kullan. "
            "YASAK: bir önceki mesajındaki aynı gezegen-ev paragraflarını baştan aynen tekrarlamak (kopyala-yapıştır döngüsü); "
            "en fazla tek cümleyle hatırlat. Netleştirici soru bu turda en fazla 1–2; kullanıcı cevap verdiyse sembolik özet ve "
            "sorunun eğilimi ile ilerle—sonsuz alt soru (hangi parite, hangi strateji) ile bitirme. "
            "Para/kripto/FX: kesin kazanç zamanı veya al-sat yok; sembolik tema; yatırım tavsiyesi değilsin. "
            "Kesin zihin okuma yok; koşullu anlat. Hukuki/tıbbi kesin hüküm yok."
        )

    return "\n".join(lines)


def user_has_saved_coordinates(user_data: dict[str, Any]) -> bool:
    raw = user_data.get("profile") or {}
    return raw.get("lat") is not None and raw.get("lon") is not None
