"""Bilgi klasöründen (.md/.txt) hızlı anahtar kelime + bulanık eşleşme ile bağlam çıkarımı (embedding yok)."""

from __future__ import annotations

import logging
import re
from pathlib import Path

from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

_CHUNK_TARGET = 520
_MAX_CHUNKS_LOAD = 120
_MAX_OUT_CHARS = 3200


def _normalize(s: str) -> str:
    t = s.lower().strip()
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


def _split_chunks(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    parts = re.split(r"\n{2,}|(?=^#{1,3}\s)", text, flags=re.MULTILINE)
    chunks: list[str] = []
    buf = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(buf) + len(p) + 1 <= _CHUNK_TARGET:
            buf = (buf + "\n\n" + p).strip()
        else:
            if buf:
                chunks.append(buf)
            buf = p
    if buf:
        chunks.append(buf)
    out: list[str] = []
    for c in chunks:
        if len(c) > _CHUNK_TARGET * 2:
            for i in range(0, len(c), _CHUNK_TARGET):
                out.append(c[i : i + _CHUNK_TARGET])
        else:
            out.append(c)
    return out[:_MAX_CHUNKS_LOAD]


class KnowledgeRagService:
    def __init__(self, knowledge_dir: Path, *, min_score: int = 62) -> None:
        self._dir = knowledge_dir
        self._min_score = max(45, min(92, min_score))
        self._chunks: list[tuple[str, str]] = []  # (source_name, text)
        self._load()

    def _load(self) -> None:
        if not self._dir.is_dir():
            logger.warning("Bilgi klasörü yok: %s", self._dir)
            return
        for path in sorted(self._dir.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in (".md", ".txt"):
                continue
            if path.name.lower() == "faq.json":
                continue
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError:
                continue
            rel = path.relative_to(self._dir).as_posix()
            for ch in _split_chunks(raw):
                if len(ch.strip()) < 40:
                    continue
                self._chunks.append((rel, ch.strip()))
        logger.info("Knowledge RAG: %s parça yüklendi", len(self._chunks))

    def retrieve(self, query: str, lang: str, *, top_k: int = 4) -> str:
        if not query.strip() or not self._chunks:
            return ""
        qn = _normalize(query)
        if len(qn) < 4:
            return ""
        scored: list[tuple[int, str, str]] = []
        for src, chunk in self._chunks:
            cn = _normalize(chunk)
            s1 = fuzz.partial_ratio(qn, cn)
            s2 = fuzz.token_set_ratio(qn, cn)
            score = max(s1, s2)
            if score >= self._min_score:
                scored.append((score, src, chunk))
        scored.sort(key=lambda x: -x[0])
        picked = scored[: max(1, top_k)]
        if not picked:
            return ""
        lines: list[str] = []
        if lang == "en":
            lines.append("=== KNOWLEDGE_SNIPPETS (local files; cite as general reference, not personal chart) ===")
        else:
            lines.append("=== BİLGİ_KÜTÜPHANESİ (yerel dosyalar; kişisel harita değil, genel kaynak) ===")
        for score, src, chunk in picked:
            lines.append(f"[{src} | match~{score}]")
            lines.append(chunk[:900])
            lines.append("")
        text = "\n".join(lines).strip()
        return text[:_MAX_OUT_CHARS]
