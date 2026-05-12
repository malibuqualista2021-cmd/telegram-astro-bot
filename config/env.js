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
  const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

  const errors = [];
  if (!BOT_TOKEN) {
    errors.push(
      'BOT_TOKEN tanımlı değil. Telegram BotFather token\'ını .env veya ortam değişkeni olarak ekle.'
    );
  }
  if (!OPENAI_API_KEY) {
    errors.push(
      'OPENAI_API_KEY tanımlı değil. Yorum üretimi için OpenAI API anahtarını .env veya ortam değişkeni olarak ekle.'
    );
  }

  if (errors.length > 0) {
    console.error('');
    console.error('[env] Uygulama başlatılamıyor:');
    for (const e of errors) console.error('  -', e);
    console.error('');
    process.exit(1);
  }

  return {
    BOT_TOKEN,
    OPENAI_API_KEY,
    PORT,
    OPENAI_MODEL: (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
    GEOCODE_USER_AGENT: (process.env.GEOCODE_USER_AGENT || '').trim(),
  };
}

module.exports = { loadEnv };
