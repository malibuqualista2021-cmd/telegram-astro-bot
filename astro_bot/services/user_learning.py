"""Kullanıcının bot'a öğrettiği kısa notlar (kalıcı user_data + DB)."""

from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any

MAX_NOTES = 28
MAX_NOTE_CHARS = 420


def _notes(ud: dict[str, Any]) -> list[dict[str, str]]:
    raw = ud.get("learned_notes")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("text"), str):
            out.append({"text": item["text"].strip(), "ts": str(item.get("ts") or "")})
    return out


def add_learning_note(ud: dict[str, Any], text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    t = t[:MAX_NOTE_CHARS]
    notes = _notes(ud)
    notes.append({"text": t, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    ud["learned_notes"] = notes[-MAX_NOTES:]
    return True


def clear_learning_notes(ud: dict[str, Any]) -> None:
    ud["learned_notes"] = []


def format_learning_for_llm(ud: dict[str, Any], lang: str, max_chars: int = 2400) -> str:
    notes = _notes(ud)
    if not notes:
        return ""
    lines: list[str] = []
    if lang == "en":
        lines.append("=== USER_LEARNED_NOTES (user asked to remember; honor style/facts) ===")
        for i, n in enumerate(notes[-20:], start=1):
            lines.append(f"{i}. {n['text']}")
        lines.append(
            "Use these as preferences/corrections. Do not contradict without reason; if astro data conflicts, acknowledge both."
        )
    else:
        lines.append("=== KULLANICI_NOTLARI (kullanıcı hatırlat / tercih — üslup ve düzeltmeler) ===")
        for i, n in enumerate(notes[-20:], start=1):
            lines.append(f"{i}. {n['text']}")
        lines.append(
            "Bunları tercih ve düzeltme olarak uygula. Hesaplanan harita ile çelişirse her iki tarafı da nazikçe belirt."
        )
    return "\n".join(lines)[:max_chars]


def list_notes_for_user(ud: dict[str, Any], lang: str) -> str:
    notes = _notes(ud)
    if not notes:
        return "Henüz kayıtlı not yok. Örnek: /hatirla Daha kısa yaz" if lang != "en" else "No saved notes yet. Example: /remember keep it shorter"
    lines: list[str] = []
    if lang == "en":
        lines.append("<b>Your notes</b>")
    else:
        lines.append("<b>Kayıtlı notların</b>")
    for i, n in enumerate(notes, start=1):
        lines.append(f"{i}. {html.escape(n['text'])}")
    return "\n".join(lines)
