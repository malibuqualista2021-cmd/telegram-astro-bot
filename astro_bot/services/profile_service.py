"""Kullanıcı doğum profili (user_data içinde)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

DEFAULT_LAT = 41.0082
DEFAULT_LON = 28.9784
DEFAULT_TZ = "Europe/Istanbul"


@dataclass
class UserProfile:
    birth_date: date | None = None
    birth_time: time | None = None
    lat: float = DEFAULT_LAT
    lon: float = DEFAULT_LON
    tz_name: str = DEFAULT_TZ
    house_system: str = "placidus"

    def to_llm_hint(self, lang: str) -> str:
        if not self.birth_date:
            return ""
        parts = [self.birth_date.isoformat()]
        if self.birth_time:
            parts.append(self.birth_time.strftime("%H:%M"))
        else:
            parts.append(
                "(saat yok → gezegenler için yerel öğlen; evler hesaplanmaz)"
                if lang != "en"
                else "(time unknown → noon local for planets; houses omitted)"
            )
        parts.append(f"{self.lat:.4f},{self.lon:.4f}")
        parts.append(self.tz_name)
        line = " | ".join(parts)
        if lang == "en":
            return (
                f"User birth metadata: {line}. Exact longitudes/houses/aspects appear only in COMPUTED_ASTRO_DATA if present; "
                "never invent specific degrees or house placements beyond that block."
            )
        return (
            f"Kullanıcı doğum meta verisi: {line}. Kesin derece/ev/açılar yalnızca varsa HESAPLANMIŞ_ASTRO_VERİSİ bloğunda; "
            "o blok dışında somut konum uydurma."
        )


def profile_from_user_data(ud: dict[str, Any]) -> UserProfile:
    raw = ud.get("profile") or {}
    bd = raw.get("birth_date")
    bt = raw.get("birth_time")
    lat = raw.get("lat", DEFAULT_LAT)
    lon = raw.get("lon", DEFAULT_LON)
    tz_name = raw.get("tz", DEFAULT_TZ)
    birth_date = None
    if isinstance(bd, str):
        try:
            birth_date = date.fromisoformat(bd)
        except ValueError:
            birth_date = None
    birth_time = None
    if isinstance(bt, str):
        try:
            h, m = bt.split(":")
            birth_time = time(int(h), int(m))
        except (ValueError, AttributeError):
            birth_time = None
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        lat_f, lon_f = DEFAULT_LAT, DEFAULT_LON
    if not isinstance(tz_name, str) or not tz_name.strip():
        tz_name = DEFAULT_TZ
    hs = raw.get("house_system", "placidus")
    if not isinstance(hs, str) or not hs.strip():
        hs = "placidus"
    return UserProfile(
        birth_date=birth_date,
        birth_time=birth_time,
        lat=lat_f,
        lon=lon_f,
        tz_name=tz_name.strip(),
        house_system=hs.strip().lower(),
    )


def save_profile(ud: dict[str, Any], **kwargs: Any) -> None:
    p = ud.get("profile") or {}
    p.update({k: v for k, v in kwargs.items() if v is not None})
    ud["profile"] = p


def partner_from_user_data(ud: dict[str, Any]) -> UserProfile:
    """İkinci harita (sinastri); partner anahtarı profile ile aynı yapıda."""
    raw = dict(ud.get("partner") or {})
    if not (raw.get("tz") and str(raw.get("tz")).strip()):
        up = ud.get("profile") or {}
        tz_fallback = up.get("tz") if isinstance(up.get("tz"), str) and str(up.get("tz")).strip() else None
        raw["tz"] = tz_fallback or DEFAULT_TZ
    fake = {"profile": raw}
    return profile_from_user_data(fake)


def save_partner(ud: dict[str, Any], **kwargs: Any) -> None:
    p = ud.get("partner") or {}
    p.update({k: v for k, v in kwargs.items() if v is not None})
    ud["partner"] = p


def clear_partner(ud: dict[str, Any]) -> None:
    ud.pop("partner", None)


def clear_all_user_chart_data(ud: dict[str, Any]) -> None:
    """Profil, partner, sohbet, notlar — dil korunur."""
    ud.pop("profile", None)
    ud.pop("partner", None)
    ud.pop("astro_style", None)
    ud.pop("chat_history", None)
    ud.pop("memory_summary", None)
    ud.pop("learned_notes", None)
    ud.pop("chat_mode", None)


def partner_to_llm_hint(partner: UserProfile, lang: str) -> str:
    if not partner.birth_date:
        return ""
    parts = [partner.birth_date.isoformat()]
    if partner.birth_time:
        parts.append(partner.birth_time.strftime("%H:%M"))
    else:
        parts.append(
            "(saat yok → öğlen varsayımı)"
            if lang != "en"
            else "(time unknown → noon assumption)"
        )
    parts.append(f"{partner.lat:.4f},{partner.lon:.4f}")
    parts.append(partner.tz_name)
    line = " | ".join(parts)
    if lang == "en":
        return (
            f"Partner/other chart metadata: {line}. Synastry aspects appear only in SYNASTRY_ASPECTS block when present; "
            "do not invent cross-chart positions."
        )
    return (
        f"Partner/öteki harita meta: {line}. Çapraz açılar yalnızca SYNASTRY_ASPECTS bloğunda; "
        "burada listelenmeyen sinastri iddiası uydurma."
    )


def parse_date_arg(s: str) -> date | None:
    s = s.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        try:
            return date.fromisoformat(s)
        except ValueError:
            return None
    m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})$", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    return None


def parse_time_arg(s: str) -> time | None:
    s = s.strip().replace(".", ":")
    m = re.match(r"^(\d{1,2}):(\d{2})$", s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if 0 <= h <= 23 and 0 <= mi <= 59:
        return time(h, mi)
    return None


def parse_tz_arg(s: str) -> str | None:
    s = s.strip()
    if not s:
        return None
    try:
        ZoneInfo(s)
        return s
    except Exception:
        return None


def parse_lat_lon(args: list[str]) -> tuple[float, float] | None:
    if len(args) < 2:
        joined = " ".join(args).replace(",", " ")
        parts = joined.split()
        if len(parts) >= 2:
            try:
                return float(parts[0]), float(parts[1])
            except ValueError:
                return None
        return None
    try:
        return float(args[0]), float(args[1])
    except ValueError:
        return None


def observer_datetime(profile: UserProfile) -> datetime | None:
    if not profile.birth_date:
        return None
    try:
        tz = ZoneInfo(profile.tz_name)
    except Exception:
        tz = ZoneInfo(DEFAULT_TZ)
    t = profile.birth_time or time(12, 0)
    return datetime.combine(profile.birth_date, t, tzinfo=tz)
