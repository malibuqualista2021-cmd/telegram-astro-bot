"""Eğitim amaçlı Güneş/Ay/Yükselen — mümkünse Swiss Ephemeris, yoksa ephem."""

from __future__ import annotations

import logging
import math
from zoneinfo import ZoneInfo

from astro_bot.i18n import Lang
from astro_bot.services.profile_service import UserProfile, observer_datetime

logger = logging.getLogger(__name__)

OBLIQUITY_DEG = 23.4392911


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


def _tropical_longitude_ephem(body: object, obs: object) -> float:
    import ephem

    body.compute(obs)
    eq = ephem.Equatorial(body.ra, body.dec, epoch=obs.date)
    el = ephem.Ecliptic(eq, epoch=obs.date)
    return math.degrees(float(el.lon)) % 360


def _positions_swisseph(
    dt_utc,
    lat_deg: float,
    lon_deg: float,
) -> tuple[float, float, float] | None:
    """(sun_lon, moon_lon, asc_lon) tropikal veya None."""
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
        sun_xx, _ = swe.calc_ut(jd, swe.SUN, flg)
        moon_xx, _ = swe.calc_ut(jd, swe.MOON, flg)
        sun_lon = float(sun_xx[0]) % 360
        moon_lon = float(moon_xx[0]) % 360
        cusps, ascmc = swe.houses(jd, lat_deg, lon_deg, b"P")
        asc_lon = float(ascmc[0]) % 360
        return sun_lon, moon_lon, asc_lon
    except Exception:
        logger.exception("Swiss Ephemeris hesap hatası, ephem kullanılacak")
        return None


def _positions_ephem(dt_utc, lat_deg: float, lon_deg: float) -> tuple[float, float, float]:
    import ephem

    obs = ephem.Observer()
    obs.lat = str(lat_deg)
    obs.lon = str(lon_deg)
    obs.pressure = 0
    obs.horizon = "0"
    obs.date = dt_utc.strftime("%Y/%m/%d %H:%M:%S")

    sun = ephem.Sun()
    moon = ephem.Moon()
    lon_sun = _tropical_longitude_ephem(sun, obs)
    lon_moon = _tropical_longitude_ephem(moon, obs)

    lst_rad = float(obs.sidereal_time())
    ramc_deg = math.degrees(lst_rad) % 360
    lat_rad = float(obs.lat) * 180.0 / math.pi
    lon_asc = _ascendant_deg(ramc_deg, lat_rad)
    return lon_sun, lon_moon, lon_asc


def _ascendant_deg(ramc_deg: float, lat_deg: float, eps_deg: float = OBLIQUITY_DEG) -> float:
    r = math.radians(ramc_deg)
    p = math.radians(lat_deg)
    e = math.radians(eps_deg)
    y = math.cos(r)
    x = -math.sin(e) * math.tan(p) + math.cos(e) * math.sin(r)
    return math.degrees(math.atan2(y, x)) % 360


def format_chart_text(profile: UserProfile, lang: Lang) -> str:
    dt_local = observer_datetime(profile)
    if not dt_local:
        return ""

    try:
        dt_utc = dt_local.astimezone(ZoneInfo("UTC"))
    except Exception:
        logger.exception("Zaman dilimi dönüşümü")
        return ""

    lat_deg = float(profile.lat)
    lon_deg = float(profile.lon)

    src = "Swiss Ephemeris"
    pos = _positions_swisseph(dt_utc, lat_deg, lon_deg)
    if pos is None:
        src = "ephem"
        pos = _positions_ephem(dt_utc, lat_deg, lon_deg)

    lon_sun, lon_moon, lon_asc = pos
    idx_sun = _sign_index(lon_sun)
    idx_moon = _sign_index(lon_moon)
    idx_asc = _sign_index(lon_asc)

    if lang == "en":
        return (
            f"<b>Educational summary ({src}, tropical)</b>\n"
            f"Sun: {sign_name(idx_sun, lang)} (~{lon_sun:.1f}°)\n"
            f"Moon: {sign_name(idx_moon, lang)} (~{lon_moon:.1f}°)\n"
            f"Ascendant (approx.): {sign_name(idx_asc, lang)} (~{lon_asc:.1f}°)\n\n"
            "<i>Not a professional chart; house system and context matter.</i>"
        )
    return (
        f"<b>Eğitim amaçlı özet ({src}, tropikal)</b>\n"
        f"Güneş: {sign_name(idx_sun, lang)} (~{lon_sun:.1f}°)\n"
        f"Ay: {sign_name(idx_moon, lang)} (~{lon_moon:.1f}°)\n"
        f"Yükselen (yaklaşık): {sign_name(idx_asc, lang)} (~{lon_asc:.1f}°)\n\n"
        "<i>Profesyonel harita yerine geçmez; yorum bağlama bağlıdır.</i>"
    )
