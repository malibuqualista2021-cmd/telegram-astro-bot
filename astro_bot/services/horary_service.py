"""Horary (soru anı) — eğitim amaçlı; soru geldiği Telegram mesajının UTC zamanı + konum."""

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


def _horary_swisseph(
    dt_utc: datetime,
    lat_deg: float,
    lon_deg: float,
) -> tuple[dict[str, float], float, float, str] | None:
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
        _cusps, ascmc = swe.houses(jd, lat_deg, lon_deg, b"P")
        asc = float(ascmc[0]) % 360
        mc = float(ascmc[1]) % 360
        return lons, asc, mc, "Swiss Ephemeris"
    except Exception:
        logger.exception("Horary Swiss hesap hatası")
        return None


def _horary_ephem_fallback(
    dt_utc: datetime,
    lat_deg: float,
    lon_deg: float,
) -> tuple[dict[str, float], float, float, str]:
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
    return lons, lon_asc, mc_approx, "ephem (yaklaşık)"


def format_horary_context(
    question_utc: datetime,
    lat_deg: float,
    lon_deg: float,
    lang: Lang,
    *,
    used_custom_location: bool,
) -> str:
    """LLM sistemine eklenecek düz metin: soru anı haritası özeti + uyarılar."""
    try:
        q = question_utc.astimezone(timezone.utc)
    except Exception:
        logger.exception("Horary UTC dönüşümü")
        q = question_utc.replace(tzinfo=timezone.utc) if question_utc.tzinfo is None else question_utc

    pack = _horary_swisseph(q, lat_deg, lon_deg)
    if pack is None:
        lons, asc, mc, src = _horary_ephem_fallback(q, lat_deg, lon_deg)
    else:
        lons, asc, mc, src = pack

    order = ("Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn")
    lines: list[str] = []
    if lang == "en":
        lines.append("=== Horary snapshot (educational, not a verdict) ===")
        lines.append(f"Engine: {src}. Chart for the moment this message was sent (UTC).")
        lines.append(
            f"Location: lat {lat_deg:.4f}, lon {lon_deg:.4f}"
            + (" (from your saved /konum)." if used_custom_location else " (default Istanbul until you set /konum).")
        )
        lines.append(f"Time (UTC): {q.isoformat()}")
        for key in order:
            lon = lons[key]
            lines.append(f"{key}: {sign_name(_sign_idx(lon), lang)} (~{lon:.1f}°)")
        lines.append(f"Ascendant: {sign_name(_sign_idx(asc), lang)} (~{asc:.1f}°)")
        lines.append(f"MC (approx.): {sign_name(_sign_idx(mc), lang)} (~{mc:.1f}°)")
        lines.append(
            "Use this as symbolic classical-horary-style context only. "
            "Do not give a definitive yes/no on legal, medical, financial, or safety matters. "
            "No fortune-telling certainties; describe tensions/themes briefly. "
            "Full horary rules (receptions, aspects, Moon void, etc.) are not automated here—mention if relevant."
        )
    else:
        lines.append("=== Horary anlık görünüm (eğitim amaçlı, hüküm değil) ===")
        labels_tr = {
            "Sun": "Güneş",
            "Moon": "Ay",
            "Mercury": "Merkür",
            "Venus": "Venüs",
            "Mars": "Mars",
            "Jupiter": "Jüpiter",
            "Saturn": "Satürn",
        }
        lines.append(f"Hesap: {src}. Harita, bu Telegram mesajının gönderildiği ana (UTC) göre.")
        lines.append(
            f"Konum: enlem {lat_deg:.4f}, boylam {lon_deg:.4f}"
            + (" (/konum ile kayıtlı)." if used_custom_location else " (/konum yoksa varsayılan İstanbul).")
        )
        lines.append(f"Zaman (UTC): {q.isoformat()}")
        for key in order:
            lon = lons[key]
            lines.append(f"{labels_tr[key]}: {sign_name(_sign_idx(lon), lang)} (~{lon:.1f}°)")
        lines.append(f"Yükselen: {sign_name(_sign_idx(asc), lang)} (~{asc:.1f}°)")
        lines.append(f"MC (yaklaşık): {sign_name(_sign_idx(mc), lang)} (~{mc:.1f}°)")
        lines.append(
            "Bunu yalnızca geleneksel horary dilinde sembolik bağlam olarak kullan. "
            "Hukuki/tıbbi/finansal/güvenlik konularında kesin evet/hayır verme; kehanet iddiası yok. "
            "Tam horary kuralları (resepsiyon, açılar, Ay boşluğu vb.) otomatik değil; gerekirse kısaca belirt."
        )

    return "\n".join(lines)


def user_has_saved_coordinates(user_data: dict[str, Any]) -> bool:
    raw = user_data.get("profile") or {}
    return raw.get("lat") is not None and raw.get("lon") is not None
