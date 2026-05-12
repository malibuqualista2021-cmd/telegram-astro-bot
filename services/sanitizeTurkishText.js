/**
 * AI çıktısını Telegram için Türkçe Latin + güvenli noktalama ile sınırlar.
 * Kiril, Yunanca, Arapça vb. scriptleri kaldırır (Latin harfine benzeyen Kiril dahil).
 */

const logger = require('./logger');

const STRIP_SCRIPTS = [
  'Cyrillic',
  'Greek',
  'Arabic',
  'Hebrew',
  'Syriac',
  'Thai',
  'Hangul',
  'Hiragana',
  'Katakana',
  'Han',
  'Devanagari',
  'Bengali',
  'Tamil',
  'Armenian',
  'Georgian',
  'Ethiopic',
];

/**
 * @param {string} text
 * @returns {string}
 */
function sanitizeTurkishText(text) {
  if (text == null || text === '') return '';

  let s = String(text).normalize('NFKC');

  s = s.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');

  for (const sc of STRIP_SCRIPTS) {
    try {
      s = s.replace(new RegExp(`\\p{Script=${sc}}`, 'gu'), '');
    } catch {
      /* Unicode property yoksa atla */
    }
  }

  s = s.replace(/[\uE000-\uF8FF]/g, '');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  s = s.replace(/[ \t\u00A0]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

/**
 * @param {string} original
 * @param {string} sanitized
 * @returns {boolean} true = çok bozuldu, kullanıcıya hata göster
 */
function isSanitizeDegraded(original, sanitized) {
  const o = String(original || '').trim();
  const c = String(sanitized || '').trim();
  if (!o) return false;
  if (!c) return true;
  if (o.length >= 200 && c.length < 40) return true;
  if (o.length >= 80 && c.length / o.length < 0.15) return true;
  return false;
}

/**
 * Groq / model metnini temizler; aşırı bozulursa SANITIZE_DEGRADED fırlatır.
 * @param {string} raw
 * @param {string} logContext
 * @returns {string}
 */
function sanitizeAiOutputOrThrow(raw, logContext) {
  const orig = String(raw || '').trim();
  const cleaned = sanitizeTurkishText(orig);
  if (isSanitizeDegraded(orig, cleaned)) {
    logger.error('[sanitize] AI çıktısı temizleme sonrası çok kısaldı veya boş', {
      context: logContext,
      origLen: orig.length,
      cleanedLen: cleaned.length,
    });
    const err = new Error('SANITIZE_DEGRADED');
    err.code = 'SANITIZE_DEGRADED';
    throw err;
  }
  return cleaned;
}

module.exports = {
  sanitizeTurkishText,
  isSanitizeDegraded,
  sanitizeAiOutputOrThrow,
};
