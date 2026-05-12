/**
 * Kullanıcı mesajını A/B/C/D sınıflarına ayırır (kurallı, hızlı).
 * A: genel kavram | B: kişisel harita | C: transit/günlük gökyüzü (MVP dışı) | D: riskli
 */

function tnorm(text) {
  return String(text || '').trim().toLowerCase();
}

const RISKY_RE =
  /kesin\s*(evlen|boşan|öl|ayrıl|aldat|hamile)|ne\s*zaman\s*öl|kesin\s*teşhis|tıbbi\s*teşhis|hisse\s*senedi|bitcoin\s*al|yatırım\s*tavsiye|para\s*kaybed|kesin\s*kader|aldatır\s*mı|aldatır\s*mi/i;

const UNSUPPORTED_RE =
  /transit|bugün\s*gökyüzü|gökyüzü\s*bugün|günlük\s*horoskop|günlük\s*yorum|ay\s*döngüsü|yeni\s*ay|dolunay|horary|ephemeris|şu\s*an\s*gezegen|gezegen\s*konumları\s*şimdi|yarının\s*gökyüzü|bugünkü\s*gökyüzü/i;

const BIRTH_TIME_INFO_RE =
  /(saat|doğum\s*saati).{0,45}bilmiyorum|bilmiyorum.{0,45}(saat|doğum\s*saati)/i;

const PERSONAL_HINT_RE =
  /\b(benim|bana|benden|ben\s|haritam|haritamda|doğum\s*haritam|natal|burcumda|burcum|bana\s*özel|benim\s*için|kaçıncı\s*ev|kaçın[cç]ı\s*ev)\b/i;

const PERSONAL_QUESTION_RE =
  /\b(nasıl|ne\s*olur|ne\s*zaman|var\s*mı|yok\s*mu|göster|söyle|yorum|bak|anlat|görün|gösterir|olacak\s*mı|olur\s*mu)\b/i;

/**
 * @returns {{ category: 'A'|'B'|'C'|'D', reason: string }}
 */
function classifyMessage(rawText) {
  const t = tnorm(rawText);
  if (!t) return { category: 'A', reason: 'empty' };

  if (RISKY_RE.test(rawText)) {
    return { category: 'D', reason: 'risky' };
  }
  if (UNSUPPORTED_RE.test(rawText)) {
    return { category: 'C', reason: 'transit_or_daily' };
  }
  if (BIRTH_TIME_INFO_RE.test(rawText)) {
    return { category: 'A', reason: 'birth_time_faq' };
  }

  const hasPersonal = PERSONAL_HINT_RE.test(rawText);
  const hasQuestion = PERSONAL_QUESTION_RE.test(rawText);

  if (
    hasPersonal &&
    (hasQuestion || /ilişki|kariyer|para|evlilik|aşk|iş\s|işim/i.test(rawText))
  ) {
    return { category: 'B', reason: 'personal_chart' };
  }
  if (hasPersonal && /(haritam|doğum\s*haritam|natal)/i.test(rawText)) {
    return { category: 'B', reason: 'personal_chart_marker' };
  }

  return { category: 'A', reason: 'general_concept' };
}

module.exports = { classifyMessage };
