"""Finans astrolojisi — natal + transit özet (sembolik; yatırım tavsiyesi değil)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from astro_bot.i18n import Lang
from astro_bot.services.chart_service import (
    _aspect_label,
    _compute_swisseph_natal,
    _house_for_longitude,
    _natal_aspects,
    _planet_label,
    _sign_index,
    _transit_hits,
    house_system_display,
    house_system_to_bytes,
    sign_name,
)
from astro_bot.services.profile_service import UserProfile, observer_datetime

logger = logging.getLogger(__name__)

_TRAD_RULER_KEYS = (
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


def _trad_ruler_key(sign_idx: int) -> str:
    return _TRAD_RULER_KEYS[sign_idx % 12]


def _part_of_fortune_lon(asc: float, sun: float, moon: float, day_chart: bool) -> float:
    if day_chart:
        return (asc + moon - sun) % 360.0
    return (asc - moon + sun) % 360.0


FIN_ASPECT_KEYS = frozenset({"Venus", "Jupiter", "Saturn", "Pluto", "Sun", "Mars", "Moon"})
FIN_TRANSIT_KEYS = frozenset(
    {"Jupiter", "Saturn", "Pluto", "Uranus", "Neptune", "Venus", "Mars", "Sun"},
)


def _pick_finance_aspects(
    aspects: list[tuple[str, str, int, str, float]],
    limit: int = 12,
) -> list[tuple[str, str, int, str, float]]:
    maj_tags = frozenset({"conj", "sext", "sq", "tri", "opp"})
    out: list[tuple[str, str, int, str, float]] = []
    for a, b, ang, tag, orb in aspects:
        if tag not in maj_tags:
            continue
        if a in FIN_ASPECT_KEYS or b in FIN_ASPECT_KEYS:
            out.append((a, b, ang, tag, orb))
    return out[:limit]


def build_finance_astro_context(
    profile: UserProfile,
    lang: Lang,
    *,
    max_chars: int = 2400,
) -> str:
    dt_local = observer_datetime(profile)
    if not dt_local:
        return ""
    try:
        dt_utc = dt_local.astimezone(ZoneInfo("UTC"))
    except Exception:
        logger.exception("Finans astro: zaman dilimi")
        return ""

    lat_deg = float(profile.lat)
    lon_deg = float(profile.lon)
    has_time = profile.birth_time is not None
    hsys = house_system_to_bytes(profile.house_system)
    hs_disp = house_system_display(profile.house_system, lang)

    natal = _compute_swisseph_natal(dt_utc, lat_deg, lon_deg, with_houses=has_time, hsys=hsys)
    if not natal or not natal[0]:
        if lang == "en":
            return (
                "=== FINANCE_ASTRO_DATA (symbolic; not investment advice) ===\n"
                "Full finance slice needs Swiss Ephemeris (pyswisseph + ephemeris files). "
                "General money themes can still be discussed without numeric houses."
            )
        return (
            "=== FINANS_ASTRO_VERİSİ (sembolik; yatırım tavsiyesi değil) ===\n"
            "Sayısal ev ve Şans Noktası için Swiss Ephemeris (pyswisseph + efemeris) gerekir. "
            "Yine de genel para temaları sembolik anlatılabilir."
        )

    planets, cusps, asc_lon, mc_lon, src = natal
    lines: list[str] = []

    if lang == "en":
        lines.append(
            "=== FINANCE_ASTRO_DATA (symbolic; not investment/trading/tax/legal advice) ==="
        )
        lines.append(
            f"Source: {src}. House system: {hs_disp}. Birth UTC: {dt_utc.isoformat(timespec='seconds')}."
        )
    else:
        lines.append(
            "=== FINANS_ASTRO_VERİSİ (sembolik; yatırım/al-sat/vergi/hukuk tavsiyesi değil) ==="
        )
        lines.append(
            f"Kaynak: {src}. Ev sistemi: {hs_disp}. Doğum UTC: {dt_utc.isoformat(timespec='seconds')}."
        )

    if not has_time:
        if lang == "en":
            lines.append(
                "No birth time: houses, house rulers, and Part of Fortune omitted; "
                "Venus/Jupiter/Saturn signs use noon-local chart."
            )
        else:
            lines.append(
                "Doğum saati yok: evler, ev yöneticileri ve Şans Noktası yok; "
                "Venüs/Jüpiter/Satürn burçları öğlen yerel haritayla."
            )

    money_planets = ("Venus", "Jupiter", "Saturn")
    if lang == "en":
        lines.append("Money-relevant natal planets (sign °, house or —, R=retro):")
    else:
        lines.append("Para ile ilişkili natal gezegenler (burç °, ev veya —, R=retro):")

    for key in money_planets:
        p = next((x for x in planets if x.key == key), None)
        if not p:
            continue
        sn = sign_name(p.sign_idx, lang)
        hs = f"H{p.house}" if p.house else "—"
        retro = " R" if p.retro else ""
        plab = _planet_label(p.key, lang)
        lines.append(f"- {plab}: {sn} {p.lon:.2f}° {hs}{retro}")

    if has_time and cusps and asc_lon is not None:
        for hi, lbl_tr, lbl_en in (
            (2, "2. ev (kaynaklar, değer)", "H2 resources/values"),
            (8, "8. ev (ortak kaynaklar, dönüşüm)", "H8 shared resources/transform"),
            (11, "11. ev (kazanılanlar, ağlar)", "H11 gains/networks"),
        ):
            cdeg = cusps[hi - 1]
            ci = _sign_index(cdeg)
            rk = _trad_ruler_key(ci)
            rplanet = next((x for x in planets if x.key == rk), None)
            if lang == "en":
                lines.append(
                    f"- {lbl_en}: cusp {sign_name(ci, lang)} ~{cdeg:.2f}° — "
                    f"traditional ruler {_planet_label(rk, lang)}"
                )
            else:
                lines.append(
                    f"- {lbl_tr}: başlangıç {sign_name(ci, lang)} ~{cdeg:.2f}° — "
                    f"klasik yönetici {_planet_label(rk, lang)}"
                )
            if rplanet:
                rsn = sign_name(rplanet.sign_idx, lang)
                rhs = f"H{rplanet.house}" if rplanet.house else "—"
                if lang == "en":
                    lines.append(f"  → ruler placement: {rsn} {rplanet.lon:.2f}° {rhs}")
                else:
                    lines.append(f"  → yöneticinin yeri: {rsn} {rplanet.lon:.2f}° {rhs}")

        sun_p = next((x for x in planets if x.key == "Sun"), None)
        moon_p = next((x for x in planets if x.key == "Moon"), None)
        if sun_p and sun_p.house is not None:
            day_chart = 7 <= sun_p.house <= 12
        else:
            day_chart = True
        if moon_p and sun_p:
            pof = _part_of_fortune_lon(asc_lon, sun_p.lon, moon_p.lon, day_chart)
            pi = _sign_index(pof)
            ph = _house_for_longitude(pof, cusps)
            if lang == "en":
                lines.append(
                    f"Part of Fortune (traditional; {'day' if day_chart else 'night'} formula): "
                    f"{sign_name(pi, lang)} ~{pof:.2f}° H{ph}"
                )
            else:
                lines.append(
                    f"Şans Noktası (klasik; {'gündüz' if day_chart else 'gece'} formülü): "
                    f"{sign_name(pi, lang)} ~{pof:.2f}° E{ph}"
                )

    if has_time and mc_lon is not None:
        mi = _sign_index(mc_lon)
        if lang == "en":
            lines.append(
                f"MC (public/career axis link to resources): {sign_name(mi, lang)} ~{mc_lon:.2f}°"
            )
        else:
            lines.append(
                f"MC (kariyer/alınyazısı, kaynaklarla bağ): {sign_name(mi, lang)} ~{mc_lon:.2f}°"
            )

    aspects_all = _natal_aspects(planets, allow_minor=False)
    fin_asp = _pick_finance_aspects(aspects_all, 12)
    if fin_asp:
        if lang == "en":
            lines.append("Major natal aspects touching money planets (tightest orbs first):")
        else:
            lines.append("Para gezegenlerine dokunan majör natal açılar (önce en düşük orb):")
        for a, b, ang, tag, orb in fin_asp:
            al = _planet_label(a, lang)
            bl = _planet_label(b, lang)
            lab = _aspect_label(tag, lang)
            lines.append(f"- {al} {lab} ({ang}°) {bl} — orb {orb:.2f}°")

    if has_time:
        for hn in (2, 8, 11):
            ins = [p.key for p in planets if p.house == hn]
            if len(ins) >= 2:
                labs = ", ".join(_planet_label(k, lang) for k in ins)
                if lang == "en":
                    lines.append(f"Stellium emphasis: {len(ins)} bodies in H{hn} ({labs}).")
                else:
                    lines.append(f"Kalabalık vurgu: E{hn} içinde {len(ins)} gök cismi ({labs}).")

    now = datetime.now(timezone.utc)
    th = _transit_hits(planets, now, skip_moon=True) or []
    fin_th = [x for x in th if x[0] in FIN_TRANSIT_KEYS or x[1] in FIN_ASPECT_KEYS][:11]
    if fin_th:
        if lang == "en":
            lines.append(
                f"Transit→natal (finance-flavored; now UTC {now.isoformat(timespec='minutes')}):"
            )
        else:
            lines.append(
                f"Transit→natal (para teması; şu an UTC {now.isoformat(timespec='minutes')}):"
            )
        for ta, nb, ang, tag, orb in fin_th:
            lines.append(
                f"- transit {_planet_label(ta, lang)} {_aspect_label(tag, lang)} "
                f"natal {_planet_label(nb, lang)} ({ang}°) orb {orb:.2f}°"
            )

    rules = (
        "\nRULES: Ground money/resource specifics only on this block + COMPUTED_ASTRO_DATA. "
        "No buy/sell, yields, or dated profit claims."
        if lang == "en"
        else "\nKURALLAR: Para/kaynak somut iddiaları yalnızca bu blok + HESAPLANMIŞ_ASTRO_VERİSİ ile sınırlı. "
        "Al-sat, getiri veya tarihli kazanç vaadi yok."
    )
    return ("\n".join(lines) + rules)[:max_chars]
