"""Eğitim amaçlı Güneş/Ay/Yükselen — ephem (yaklaşık)."""

from __future__ import annotations

import logging
import math
from zoneinfo import ZoneInfo

from astro_bot.i18n import Lang
from astro_bot.services.profile_service import UserProfile, observer_datetime

logger = logging.getLogger(__name__)

OBLIQUITY_DEG = 23.4392911


def _tropical_longitude(body: object, obs: object) -> float:
    import ephem

    body.compute(obs)
    eq = ephem.Equatorial(body.ra, body.dec, epoch=obs.date)
    el = ephem.Ecliptic(eq, epoch=obs.date)
    return math.degrees(float(el.lon)) % 360


def _sign_index(lon_deg: float) -> int:
    return int(lon_deg // 30) % 12


SIGN_NAMES_TR = (
    "Koç",
    "Boğa",
    "İkizler",
    "Yengeç",
    "Aslan",
    "Başak",
    "Terazi",
    "Akrep",
    "Yay",
    "Oğlak",
    "Kova",
    "Balık",
)
SIGN_NAMES_EN = (
    "Aries",
    "Taurus",
    "Gemini",
    "Cancer",
    "Leo",
    "Virgo",
    "Libra",
    "Scorpio",
    "Sagittarius",
    "Capricorn",
    "Aquarius",
    "Pisces",
)


def sign_name(idx: int, lang: Lang) -> str:
    names = SIGN_NAMES_EN if lang == "en" else SIGN_NAMES_TR
    return names[idx % 12]


def _ascendant_deg(ramc_deg: float, lat_deg: float, eps_deg: float = OBLIQUITY_DEG) -> float:
    """Tropical ascendant (yaygın formül)."""
    r = math.radians(ramc_deg)
    p = math.radians(lat_deg)
    e = math.radians(eps_deg)
    y = math.cos(r)
    x = -math.sin(e) * math.tan(p) + math.cos(e) * math.sin(r)
    asc = math.degrees(math.atan2(y, x)) % 360
    return asc


def format_chart_text(profile: UserProfile, lang: Lang) -> str:
    """Profilden eğitim amaçlı özet metin."""
    import ephem

    dt_local = observer_datetime(profile)
    if not dt_local:
        return ""

    try:
        dt_utc = dt_local.astimezone(ZoneInfo("UTC"))
    except Exception:
        logger.exception("Zaman dilimi dönüşümü")
        return ""

    obs = ephem.Observer()
    obs.lat = str(profile.lat)
    obs.lon = str(profile.lon)
    obs.pressure = 0
    obs.horizon = "0"
    obs.date = dt_utc.strftime("%Y/%m/%d %H:%M:%S")

    sun = ephem.Sun()
    moon = ephem.Moon()
    lon_sun = _tropical_longitude(sun, obs)
    lon_moon = _tropical_longitude(moon, obs)
    idx_sun = _sign_index(lon_sun)
    idx_moon = _sign_index(lon_moon)

    lst_rad = float(obs.sidereal_time())
    ramc_deg = math.degrees(lst_rad) % 360
    lat_deg = float(obs.lat) * 180.0 / math.pi
    lon_asc = _ascendant_deg(ramc_deg, lat_deg)
    idx_asc = _sign_index(lon_asc)

    if lang == "en":
        return (
            "<b>Educational summary (ephem, approximate)</b>\n"
            f"Sun (~tropical): {sign_name(idx_sun, lang)} (~{lon_sun:.1f}°)\n"
            f"Moon (~tropical): {sign_name(idx_moon, lang)} (~{lon_moon:.1f}°)\n"
            f"Ascendant (approx.): {sign_name(idx_asc, lang)} (~{lon_asc:.1f}°)\n\n"
            "<i>Not for professional use. Houses/systems vary.</i>"
        )
    return (
        "<b>Eğitim amaçlı özet (ephem, yaklaşık)</b>\n"
        f"Güneş (tropikal ~): {sign_name(idx_sun, lang)} (~{lon_sun:.1f}°)\n"
        f"Ay (tropikal ~): {sign_name(idx_moon, lang)} (~{lon_moon:.1f}°)\n"
        f"Yükselen (yaklaşık): {sign_name(idx_asc, lang)} (~{lon_asc:.1f}°)\n\n"
        "<i>Profesyonel harita yerine geçmez; ev sistemi vb. değişir.</i>"
    )
