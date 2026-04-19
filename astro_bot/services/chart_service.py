"""Natal harita (Swiss Ephemeris), evler (Placidus), majör açılar, transit özeti."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from astro_bot.i18n import Lang
from astro_bot.services.profile_service import UserProfile, observer_datetime

logger = logging.getLogger(__name__)

OBLIQUITY_DEG = 23.4392911
HOUSE_SYSTEM = "Placidus (P)"

# --- Burç isimleri (mevcut API) ---


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


def _ascendant_deg(ramc_deg: float, lat_deg: float, eps_deg: float = OBLIQUITY_DEG) -> float:
    r = math.radians(ramc_deg)
    p = math.radians(lat_deg)
    e = math.radians(eps_deg)
    y = math.cos(r)
    x = -math.sin(e) * math.tan(p) + math.cos(e) * math.sin(r)
    return math.degrees(math.atan2(y, x)) % 360


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


# --- Swiss Ephemeris: tam natal ---


@dataclass
class PlanetPoint:
    key: str
    lon: float
    retro: bool
    sign_idx: int
    house: int | None


def _separation_deg(lon1: float, lon2: float) -> float:
    d = abs(lon1 - lon2) % 360.0
    return min(d, 360.0 - d)


def _orb_for_body(name: str) -> float:
    if name in ("Sun", "Moon"):
        return 9.0
    return 7.0


def _aspect_match(
    lon1: float,
    lon2: float,
    name1: str,
    name2: str,
) -> tuple[int, str, float] | None:
    """(açı, kısa_etiket, orb) veya None."""
    sep = _separation_deg(lon1, lon2)
    candidates: list[tuple[float, int, str]] = [
        (0.0, 0, "conj"),
        (60.0, 60, "sext"),
        (90.0, 90, "sq"),
        (120.0, 120, "tri"),
        (180.0, 180, "opp"),
    ]
    orb_limit = max(_orb_for_body(name1), _orb_for_body(name2))
    best: tuple[float, int, str] | None = None
    for target, angle, tag in candidates:
        delta = abs(sep - target)
        if delta <= orb_limit:
            if best is None or delta < best[0]:
                best = (delta, angle, tag)
    if best is None:
        return None
    delta, angle, tag = best
    return angle, tag, delta


def _house_for_longitude(lon: float, cusps: list[float]) -> int:
    """cusps: 12 eleman, ev 1–12 sırasıyla ekliptik boylam."""
    lon = lon % 360.0
    for h in range(12):
        start = cusps[h] % 360.0
        nxt = cusps[(h + 1) % 12] % 360.0
        if start < nxt:
            if start <= lon < nxt:
                return h + 1
        else:
            if lon >= start or lon < nxt:
                return h + 1
    return 1


def _swisseph_body_list():
    import swisseph as swe

    rows: list[tuple[int, str]] = [
        (swe.SUN, "Sun"),
        (swe.MOON, "Moon"),
        (swe.MERCURY, "Mercury"),
        (swe.VENUS, "Venus"),
        (swe.MARS, "Mars"),
        (swe.JUPITER, "Jupiter"),
        (swe.SATURN, "Saturn"),
        (swe.URANUS, "Uranus"),
        (swe.NEPTUNE, "Neptune"),
        (swe.PLUTO, "Pluto"),
        (swe.MEAN_NODE, "MeanNode"),
    ]
    if hasattr(swe, "CHIRON"):
        rows.append((int(swe.CHIRON), "Chiron"))
    return rows


def _compute_swisseph_natal(
    dt_utc: datetime,
    lat_deg: float,
    lon_deg: float,
    *,
    with_houses: bool,
) -> tuple[list[PlanetPoint], list[float] | None, float | None, float | None, str] | None:
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

        planets: list[PlanetPoint] = []
        for pid, key in _swisseph_body_list():
            try:
                xx, _rc = swe.calc_ut(jd, pid, flg)
                lon = float(xx[0]) % 360.0
                speed = float(xx[3])
                retro = speed < 0
                planets.append(
                    PlanetPoint(
                        key=key,
                        lon=lon,
                        retro=retro,
                        sign_idx=_sign_index(lon),
                        house=None,
                    )
                )
            except Exception:
                logger.warning("Swiss Ephemeris: %s atlandı", key, exc_info=False)

        cusps12: list[float] | None = None
        asc_lon = mc_lon = None
        if with_houses:
            cusps_arr, ascmc = swe.houses(jd, lat_deg, lon_deg, b"P")
            cusps12 = [float(cusps_arr[i]) % 360.0 for i in range(1, 13)]
            asc_lon = float(ascmc[0]) % 360.0
            mc_lon = float(ascmc[1]) % 360.0
            for p in planets:
                p.house = _house_for_longitude(p.lon, cusps12)

        return planets, cusps12, asc_lon, mc_lon, "Swiss Ephemeris"
    except Exception:
        logger.exception("Swiss Ephemeris natal hesap hatası")
        return None


def _natal_aspects(planets: list[PlanetPoint]) -> list[tuple[str, str, int, str, float]]:
    out: list[tuple[str, str, int, str, float]] = []
    for i in range(len(planets)):
        for j in range(i + 1, len(planets)):
            a = planets[i]
            b = planets[j]
            m = _aspect_match(a.lon, b.lon, a.key, b.key)
            if m:
                angle, tag, orb = m
                out.append((a.key, b.key, angle, tag, orb))
    out.sort(key=lambda x: x[4])
    return out


def _transit_hits(
    natal: list[PlanetPoint],
    dt_transit_utc: datetime,
    *,
    skip_moon: bool = True,
) -> list[tuple[str, str, int, str, float]] | None:
    try:
        import swisseph as swe
    except ImportError:
        return None
    try:
        swe.set_ephe_path("")
        y, m, d = dt_transit_utc.year, dt_transit_utc.month, dt_transit_utc.day
        ut = (
            dt_transit_utc.hour
            + dt_transit_utc.minute / 60.0
            + dt_transit_utc.second / 3600.0
            + dt_transit_utc.microsecond / 3.6e9
        )
        jd = swe.julday(y, m, d, ut, swe.GREG_CAL)
        flg = swe.FLG_SWIEPH | swe.FLG_SPEED
        natal_by_key = {p.key: p for p in natal}
        hits: list[tuple[str, str, int, str, float]] = []
        for pid, tkey in _swisseph_body_list():
            if skip_moon and tkey == "Moon":
                continue
            xx, _ = swe.calc_ut(jd, pid, flg)
            tlon = float(xx[0]) % 360.0
            for nk, np in natal_by_key.items():
                if nk == tkey:
                    continue
                m = _aspect_match(tlon, np.lon, tkey, nk)
                if m:
                    angle, tag, orb = m
                    hits.append((tkey, nk, angle, tag, orb))
        hits.sort(key=lambda x: x[4])
        return hits[:18]
    except Exception:
        logger.exception("Transit hesap hatası")
        return None


def _aspect_label(tag: str, lang: Lang) -> str:
    if lang == "en":
        return {"conj": "conj", "sext": "sextile", "sq": "square", "tri": "trine", "opp": "opposition"}.get(
            tag, tag
        )
    return {"conj": "kavuşum", "sext": "altılık", "sq": "kare", "tri": "üçgen", "opp": "karşıt"}.get(tag, tag)


def _planet_label(key: str, lang: Lang) -> str:
    tr = {
        "Sun": "Güneş",
        "Moon": "Ay",
        "Mercury": "Merkür",
        "Venus": "Venüs",
        "Mars": "Mars",
        "Jupiter": "Jüpiter",
        "Saturn": "Satürn",
        "Uranus": "Uranüs",
        "Neptune": "Neptün",
        "Pluto": "Plüton",
        "MeanNode": "Ay Düğümü (Ort.)",
        "Chiron": "Kiron",
    }
    if lang == "en":
        return key
    return tr.get(key, key)


def _synastry_cross_aspects(
    planets_a: list[PlanetPoint],
    planets_b: list[PlanetPoint],
) -> list[tuple[str, str, int, str, float]]:
    out: list[tuple[str, str, int, str, float]] = []
    for a in planets_a:
        for b in planets_b:
            m = _aspect_match(a.lon, b.lon, a.key, b.key)
            if m:
                angle, tag, orb = m
                out.append((a.key, b.key, angle, tag, orb))
    out.sort(key=lambda x: x[4])
    return out


def build_synastry_context(
    user_profile: UserProfile,
    partner_profile: UserProfile,
    lang: Lang,
    *,
    max_chars: int = 3200,
) -> str:
    """İki doğum verisi arası çapraz majör açılar (LLM)."""
    if not user_profile.birth_date or not partner_profile.birth_date:
        return ""
    dt_u = observer_datetime(user_profile)
    dt_p = observer_datetime(partner_profile)
    if not dt_u or not dt_p:
        return ""
    try:
        utc_u = dt_u.astimezone(ZoneInfo("UTC"))
        utc_p = dt_p.astimezone(ZoneInfo("UTC"))
    except Exception:
        logger.exception("Sinastri zaman dönüşümü")
        return ""

    nat_u = _compute_swisseph_natal(
        utc_u,
        float(user_profile.lat),
        float(user_profile.lon),
        with_houses=False,
    )
    nat_p = _compute_swisseph_natal(
        utc_p,
        float(partner_profile.lat),
        float(partner_profile.lon),
        with_houses=False,
    )
    if not nat_u or not nat_p or not nat_u[0] or not nat_p[0]:
        return ""

    cross = _synastry_cross_aspects(nat_u[0], nat_p[0])[:28]
    lines: list[str] = []
    if lang == "en":
        lines.append("=== SYNASTRY_ASPECTS (your planet → their planet; tropical; computed) ===")
        lines.append(f"Your birth UTC: {utc_u.isoformat(timespec='seconds')}")
        lines.append(f"Partner birth UTC: {utc_p.isoformat(timespec='seconds')}")
        lines.append("Cross-chart major aspects (tightest orbs first):")
    else:
        lines.append("=== SYNASTRY_ASPECTS (senin gezegenin → partner gezegenin; tropikal; hesaplı) ===")
        lines.append(f"Senin doğum UTC: {utc_u.isoformat(timespec='seconds')}")
        lines.append(f"Partner doğum UTC: {utc_p.isoformat(timespec='seconds')}")
        lines.append("Çapraz majör açılar (önce en düşük orb):")

    for ak, bk, ang, tag, orb in cross:
        al = _planet_label(ak, lang)
        bl = _planet_label(bk, lang)
        lab = _aspect_label(tag, lang)
        if lang == "en":
            lines.append(f"- Your {al} {lab} ({ang}°) their {bl} — orb {orb:.2f}°")
        else:
            lines.append(f"- Senin {al} {lab} ({ang}°) onların {bl} — orb {orb:.2f}°")

    if not cross:
        lines.append("- (none under current orbs)" if lang == "en" else "- (mevcut orb altında yok)")

    tail = (
        "\nRULES: Base synastry/compatibility specifics only on aspects listed here."
        if lang == "en"
        else "\nKURALLAR: Sinastri/uyum için somut iddiaları yalnızca buradaki açılara dayandır."
    )
    return ("\n".join(lines) + tail)[:max_chars]


def build_computed_chart_context(
    profile: UserProfile,
    lang: Lang,
    *,
    include_transits: bool = True,
    max_chars: int = 3800,
) -> str:
    """LLM'e giden hesaplanmış gerçekler bloğu (tropikal)."""
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
    has_time = profile.birth_time is not None

    natal = _compute_swisseph_natal(dt_utc, lat_deg, lon_deg, with_houses=has_time)
    if natal and not natal[0]:
        natal = None
    lines: list[str] = []

    if natal:
        planets, cusps, asc_lon, mc_lon, src = natal
        aspects = _natal_aspects(planets)
        if lang == "en":
            lines.append("=== COMPUTED_ASTRO_DATA (tropical; trust positions below) ===")
            lines.append(f"Source: {src}. House system: {HOUSE_SYSTEM}.")
            lines.append(f"Birth UTC: {dt_utc.isoformat(timespec='seconds')}.")
            if not has_time:
                lines.append(
                    "No birth time: houses/Asc not computed; planet signs use local noon placeholder time — Moon sign may differ from midnight chart."
                )
            else:
                lines.append("Birth time present: houses and Asc computed.")
        else:
            lines.append("=== HESAPLANMIŞ_ASTRO_VERİSİ (tropikal; aşağıdaki konumlara güven) ===")
            lines.append(f"Kaynak: {src}. Ev sistemi: {HOUSE_SYSTEM}.")
            lines.append(f"Doğum UTC: {dt_utc.isoformat(timespec='seconds')}.")
            if not has_time:
                lines.append(
                    "Doğum saati yok: yükselen/evler hesaplanmadı; gezegen burçları yerel öğlen varsayımıyla — Ay burcu gece/gündüz farkına göre değişebilir."
                )
            else:
                lines.append("Doğum saati var: yükselen ve evler hesaplandı.")

        if has_time and asc_lon is not None:
            ai = _sign_index(asc_lon)
            lines.append(
                f"ASC: {sign_name(ai, lang)} ~{asc_lon:.2f}°"
                if lang == "en"
                else f"Yükselen: {sign_name(ai, lang)} ~{asc_lon:.2f}°"
            )
        if has_time and mc_lon is not None:
            mi = _sign_index(mc_lon)
            lines.append(
                f"MC: {sign_name(mi, lang)} ~{mc_lon:.2f}°"
                if lang == "en"
                else f"MC: {sign_name(mi, lang)} ~{mc_lon:.2f}°"
            )

        lines.append("Planets (sign °, house or —, R=retrograde):")
        for p in planets:
            sn = sign_name(p.sign_idx, lang)
            hs = f"H{p.house}" if p.house else "—"
            retro = " R" if p.retro else ""
            plab = _planet_label(p.key, lang)
            lines.append(f"- {plab}: {sn} {p.lon:.2f}° {hs}{retro}")

        if has_time and cusps:
            lines.append("House cusps (1–12):")
            for hi, c in enumerate(cusps, start=1):
                ci = _sign_index(c)
                lines.append(f"- H{hi}: {sign_name(ci, lang)} ~{c:.2f}°")

        lines.append("Major natal aspects (orb°):")
        if not aspects:
            lines.append("- (none under current orbs)" if lang == "en" else "- (mevcut orb altında yok)")
        else:
            for a, b, ang, tag, orb in aspects[:24]:
                al = _planet_label(a, lang)
                bl = _planet_label(b, lang)
                lab = _aspect_label(tag, lang)
                lines.append(f"- {al} {lab} ({ang}°) {bl} — orb {orb:.2f}°")

        if include_transits:
            now = datetime.now(timezone.utc)
            th = _transit_hits(planets, now, skip_moon=True)
            if th:
                lines.append(
                    f"Transit→natal highlights (now UTC {now.isoformat(timespec='minutes')}, orbs):"
                    if lang == "en"
                    else f"Transit→natal öne çıkanlar (şu an UTC {now.isoformat(timespec='minutes')}, orb):"
                )
                for ta, nb, ang, tag, orb in th[:14]:
                    lines.append(
                        f"- transit {_planet_label(ta, lang)} {_aspect_label(tag, lang)} natal {_planet_label(nb, lang)} ({ang}°) orb {orb:.2f}°"
                    )
    else:
        lon_sun, lon_moon, lon_asc = _positions_ephem(dt_utc, lat_deg, lon_deg)
        if lang == "en":
            lines.append("=== COMPUTED_ASTRO_DATA (fallback ephem; Sun/Moon/Asc only) ===")
            lines.append("Install pyswisseph + ephemeris files for full planets/houses/aspects.")
        else:
            lines.append("=== HESAPLANMIŞ_ASTRO_VERİSİ (yedek ephem; sadece Güneş/Ay/Yükselen) ===")
            lines.append("Tam gezegen/ev/açı için pyswisseph ve efemeris dosyaları gerekir.")
        lines.append(
            f"Sun {sign_name(_sign_index(lon_sun), lang)} ~{lon_sun:.2f}° / Moon {sign_name(_sign_index(lon_moon), lang)} ~{lon_moon:.2f}° / Asc ~{sign_name(_sign_index(lon_asc), lang)} {lon_asc:.2f}°"
        )

    rules = (
        "\nRULES: Use ONLY the placements and aspects listed above for specific claims. "
        "If the user asks for something not computed here, say it is not in the computed data and stay general."
        if lang == "en"
        else "\nKURALLAR: Somut iddialar için YALNIZCA yukarıdaki konum ve açıları kullan. "
        "Kullanıcı burada hesaplanmayan bir şey sorarsa hesap verisinde olmadığını söyle ve genel çerçevede kal."
    )
    text = "\n".join(lines) + rules
    return text[:max_chars]


def format_chart_text(profile: UserProfile, lang: Lang) -> str:
    """Telegram /harita — kullanıcıya okunaklı özet."""
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
    has_time = profile.birth_time is not None

    natal = _compute_swisseph_natal(dt_utc, lat_deg, lon_deg, with_houses=has_time)
    if natal and not natal[0]:
        natal = None
    if natal:
        planets, _cusps, asc_lon, _mc, src = natal
        aspects = _natal_aspects(planets)[:10]
        parts: list[str] = []
        if lang == "en":
            parts.append(f"<b>Chart summary ({src}, tropical)</b>")
            if not has_time:
                parts.append("<i>No birth time: houses omitted; Moon sign may vary.</i>")
        else:
            parts.append(f"<b>Harita özeti ({src}, tropikal)</b>")
            if not has_time:
                parts.append("<i>Doğum saati yok: evler yok; Ay burcu gün içinde değişebilir.</i>")

        if has_time and asc_lon is not None:
            ai = _sign_index(asc_lon)
            parts.append(
                f"Asc: <b>{sign_name(ai, lang)}</b> (~{asc_lon:.1f}°)"
                if lang == "en"
                else f"Yükselen: <b>{sign_name(ai, lang)}</b> (~{asc_lon:.1f}°)"
            )

        for p in planets:
            sn = sign_name(p.sign_idx, lang)
            hs = f", H{p.house}" if p.house else ""
            retro = " ℞" if p.retro else ""
            plab = _planet_label(p.key, lang)
            parts.append(f"{plab}: <b>{sn}</b> (~{p.lon:.1f}°){hs}{retro}")

        if aspects:
            parts.append("" if lang == "en" else "")
            parts.append("<b>Aspects (sample)</b>" if lang == "en" else "<b>Açılar (örnek)</b>")
            for a, b, ang, tag, orb in aspects:
                al = _planet_label(a, lang)
                bl = _planet_label(b, lang)
                lab = _aspect_label(tag, lang)
                parts.append(f"• {al} {lab} {bl} (orb {orb:.1f}°)")

        parts.append(
            "<i>Educational; not a certified chart printout.</i>"
            if lang == "en"
            else "<i>Eğitim amaçlı; resmi harita çıktısı değildir.</i>"
        )
        return "\n".join(parts)

    lon_sun, lon_moon, lon_asc = _positions_ephem(dt_utc, lat_deg, lon_deg)
    idx_sun = _sign_index(lon_sun)
    idx_moon = _sign_index(lon_moon)
    idx_asc = _sign_index(lon_asc)
    if lang == "en":
        return (
            f"<b>Educational summary (ephem fallback, tropical)</b>\n"
            f"Sun: {sign_name(idx_sun, lang)} (~{lon_sun:.1f}°)\n"
            f"Moon: {sign_name(idx_moon, lang)} (~{lon_moon:.1f}°)\n"
            f"Ascendant (approx.): {sign_name(idx_asc, lang)} (~{lon_asc:.1f}°)\n\n"
            "<i>Install Swiss Ephemeris for full chart. Not a professional chart.</i>"
        )
    return (
        f"<b>Eğitim amaçlı özet (ephem yedek, tropikal)</b>\n"
        f"Güneş: {sign_name(idx_sun, lang)} (~{lon_sun:.1f}°)\n"
        f"Ay: {sign_name(idx_moon, lang)} (~{lon_moon:.1f}°)\n"
        f"Yükselen (yaklaşık): {sign_name(idx_asc, lang)} (~{lon_asc:.1f}°)\n\n"
        "<i>Tam harita için Swiss Ephemeris kullanın. Profesyonel harita yerine geçmez.</i>"
    )
