require('dotenv').config();

/**
 * Production ortam doğrulaması.
 * PORT yoksa veya geçersizse 3000 kullanılır.
 */
function loadEnv() {
  const rawPort = process.env.PORT;
  const parsed = rawPort === undefined || rawPort === '' ? NaN : Number(rawPort);
  const PORT = Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;

  const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
  const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();

  const errors = [];
  if (!BOT_TOKEN) {
    errors.push(
      'BOT_TOKEN tanımlı değil. Telegram BotFather token\'ını .env veya ortam değişkeni olarak ekle.'
    );
  }
  if (!GROQ_API_KEY) {
    errors.push(
      'GROQ_API_KEY tanımlı değil. Yorum üretimi için Groq API anahtarını .env veya ortam değişkeni olarak ekle.'
    );
  }

  if (errors.length > 0) {
    console.error('');
    console.error('[env] Uygulama başlatılamıyor:');
    for (const e of errors) console.error('  -', e);
    console.error('');
    process.exit(1);
  }

  const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

  return {
    BOT_TOKEN,
    GROQ_API_KEY,
    PORT,
    GROQ_MODEL: (process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL).trim(),
    GEOCODE_USER_AGENT: (process.env.GEOCODE_USER_AGENT || '').trim(),
  };
}

module.exports = { loadEnv };
