"""Varsayılan uygulama ayarları (ortam ile override edilebilir)."""

from __future__ import annotations

# Mesaj / OpenAI
OPENAI_MAX_TOKENS: int = 600
OPENAI_TEMPERATURE: float = 0.35
CONVERSATION_MAX_TURNS: int = 4  # kullanıcı+asistan çiftleri (OpenAI bağlamı)

# SSS: rapidfuzz partial_ratio eşiği (0–100)
FAQ_FUZZY_THRESHOLD: int = 82

# Sohbet başına dakikada en fazla kullanıcı mesajı (spam önleme)
RATE_LIMIT_PER_MINUTE: int = 35

# Log dosyası (logs/ altında döner)
LOG_MAX_BYTES: int = 1_048_576
LOG_BACKUP_COUNT: int = 3
