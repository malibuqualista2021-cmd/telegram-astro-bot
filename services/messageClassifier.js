/**
 * Serbest metin sınıflandırması (kurallı, hızlı).
 * general_astro_knowledge | personal_chart_question | unsupported_transit_or_future | risky_question | normal_flow
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

const PERSONAL_BODY_RE =
  /\b(benim|bende|bana|benden|ben\s|haritam|haritamda|doğum\s*haritam|natal|burcumda|bana\s*özel|benim\s*için|kaçıncı\s*ev|kaçın[cç]ı\s*ev)\b/i;

const PERSONAL_HOUSE_RE = /\bbenim\b.{0,24}\d{1,2}\s*\.?\s*evim\b/i;

const VAR_MI_RE =
  /\b(var\s*m(?:\u0131|i)|varm(?:\u0131|i)|yok\s*m(?:\u00fc|u)|yokmu)(?=\s|$|[?.!,])/i;

const PERSONAL_QUESTION_RE =
  /\b(nasıl|ne\s*olur|ne\s*zaman|göster|söyle|yorum|bak|görün|gösterir|olur\s*mu|nedir)\b|anlatıyor|anlatır|anlatacak|ne\s*anlat|olacak\s*m(?:\u0131|i)(?=\s|$|[?.!,])/i;

const LIFE_AREA_PERSONAL_RE = /ilişki|kariyer|para|evlilik|aşk|iş\s|işim|hayatım|evim|burcum/i;

const ASTRO_TOPIC_RE =
  /\b(gezegen|burç|burcu|burcum|\d{1,2}\s*\.?\s*ev|evler|yükselen|asc|mc|retro|kavuşum|karşıt|üçgen|kare|sekstil|dizilim|natal|harita|astroloj|element|öncü|oncu|sabit|değişken|degisken|doğum\s*haritası|kova|balık|balik|koç|boğa|boga|ikizler|yengeç|aslan|başak|basak|terazi|akrep|yay|oğlak|oglak|güneş|gunes|ay\b|merkür|merkur|venüs|venus|mars|jüpiter|jupiter|satürn|saturn|uranüs|uranus|neptün|neptun|plüton|pluton)\b/i;

/**
 * @returns {{ category: 'general_astro_knowledge'|'personal_chart_question'|'unsupported_transit_or_future'|'risky_question'|'normal_flow', reason: string }}
 */
function classifyMessage(rawText) {
  const t = tnorm(rawText);
  if (!t) return { category: 'normal_flow', reason: 'empty' };

  if (RISKY_RE.test(rawText)) {
    return { category: 'risky_question', reason: 'risky' };
  }
  if (UNSUPPORTED_RE.test(rawText)) {
    return { category: 'unsupported_transit_or_future', reason: 'transit_or_daily' };
  }
  if (BIRTH_TIME_INFO_RE.test(rawText)) {
    return { category: 'general_astro_knowledge', reason: 'birth_time_faq' };
  }

  const hasPersonalBody = PERSONAL_BODY_RE.test(rawText);
  const hasPersonalHouse = PERSONAL_HOUSE_RE.test(rawText);
  const hasQuestionShape = PERSONAL_QUESTION_RE.test(rawText);
  const hasLifeArea = LIFE_AREA_PERSONAL_RE.test(rawText);

  if (
    /\b(haritam|haritamda|doğum\s*haritam|natal)\b/i.test(rawText) ||
    hasPersonalHouse ||
    (hasPersonalBody &&
      /\b(bende|benim)\b/i.test(rawText) &&
      VAR_MI_RE.test(rawText)) ||
    (hasPersonalBody && (hasQuestionShape || hasLifeArea))
  ) {
    return { category: 'personal_chart_question', reason: 'personal_chart' };
  }

  if (ASTRO_TOPIC_RE.test(rawText) || /\b(ne\s*demek|demektir|anlam|açıkl)\b/i.test(rawText)) {
    return { category: 'general_astro_knowledge', reason: 'astro_topic' };
  }

  return { category: 'normal_flow', reason: 'not_astro_chat' };
}

module.exports = { classifyMessage };
