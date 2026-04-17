"""Yerel SSS / bilgi tabanı — kategori, tetikleyici ve bulanık eşleşme."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from rapidfuzz import fuzz

logger = logging.getLogger(__name__)


def _normalize(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r"\s+", " ", t)
    for a, b in (
        ("ı", "i"),
        ("ğ", "g"),
        ("ü", "u"),
        ("ş", "s"),
        ("ö", "o"),
        ("ç", "c"),
        ("İ", "i"),
    ):
        t = t.replace(a, b)
    return t


@dataclass(frozen=True)
class FaqEntry:
    entry_id: str
    category: str
    title: str
    triggers: tuple[str, ...]
    answer: str


class FaqService:
    """faq.json: alt dizi eşleşmesi + rapidfuzz ile güçlü eşleşme."""

    def __init__(self, faq_path: Path, fuzzy_threshold: int) -> None:
        self._faq_path = faq_path
        self._fuzzy_threshold = max(50, min(100, fuzzy_threshold))
        self._entries: list[FaqEntry] = []
        self._by_id: dict[str, FaqEntry] = {}
        self._category_labels: dict[str, str] = {}
        self._load()

    def _parse_payload(self, raw: str) -> list[dict[str, Any]]:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            meta = data.get("meta") or {}
            cats = meta.get("categories")
            if isinstance(cats, dict):
                for k, v in cats.items():
                    if isinstance(k, str) and isinstance(v, str):
                        self._category_labels[k] = v
            entries = data.get("entries")
            if isinstance(entries, list):
                return entries
        return []

    def _load(self) -> None:
        if not self._faq_path.is_file():
            logger.warning("SSS dosyası bulunamadı: %s", self._faq_path)
            return
        raw = self._faq_path.read_text(encoding="utf-8")
        items = self._parse_payload(raw)
        for item in items:
            eid = str(item.get("id", "")).strip()
            answer = str(item.get("answer", "")).strip()
            if not eid or not answer:
                continue
            cat = str(item.get("category", "genel")).strip() or "genel"
            title = str(item.get("title", "")).strip() or eid.replace("_", " ").title()
            triggers_raw = item.get("triggers", [])
            triggers: list[str] = []
            for t in triggers_raw:
                ts = str(t).strip()
                if ts:
                    triggers.append(ts)
            if not triggers:
                triggers.append(title)
            entry = FaqEntry(
                entry_id=eid,
                category=cat,
                title=title,
                triggers=tuple(triggers),
                answer=answer,
            )
            self._entries.append(entry)
            self._by_id[eid] = entry
        logger.info("SSS yüklendi: %d kayıt", len(self._entries))

    def get_by_id(self, entry_id: str) -> FaqEntry | None:
        return self._by_id.get(entry_id.strip())

    def category_keys_ordered(self) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for e in self._entries:
            if e.category not in seen:
                seen.add(e.category)
                ordered.append(e.category)
        return ordered

    def category_label(self, key: str) -> str:
        if key in self._category_labels:
            return self._category_labels[key]
        return key.replace("_", " ").title()

    def entries_in_category(self, category: str) -> list[FaqEntry]:
        return [e for e in self._entries if e.category == category]

    def find_answer(self, user_text: str) -> str | None:
        entry = self.find_entry(user_text)
        return entry.answer if entry else None

    def find_entry(self, user_text: str) -> FaqEntry | None:
        if not user_text.strip() or not self._entries:
            return None
        norm_user = _normalize(user_text)

        best: tuple[float, FaqEntry] | None = None

        for entry in self._entries:
            for trig in entry.triggers:
                nt = _normalize(trig)
                if not nt:
                    continue
                if nt in norm_user:
                    score = 100.0 + len(nt)
                    if best is None or score > best[0]:
                        best = (score, entry)

        if best:
            logger.debug("SSS alt dizi eşleşmesi: id=%s", best[1].entry_id)
            return best[1]

        best_fuzzy: tuple[float, FaqEntry] | None = None
        for entry in self._entries:
            best_trig = 0.0
            for trig in entry.triggers:
                nt = _normalize(trig)
                if not nt:
                    continue
                r = float(fuzz.partial_ratio(nt, norm_user))
                if r > best_trig:
                    best_trig = r
            title_sc = float(fuzz.partial_ratio(_normalize(entry.title), norm_user))
            combined = max(best_trig, title_sc * 0.95)
            if combined >= float(self._fuzzy_threshold):
                if best_fuzzy is None or combined > best_fuzzy[0]:
                    best_fuzzy = (combined, entry)

        if best_fuzzy:
            logger.debug(
                "SSS bulanık eşleşme: id=%s score=%.1f",
                best_fuzzy[1].entry_id,
                best_fuzzy[0],
            )
            return best_fuzzy[1]
        return None
