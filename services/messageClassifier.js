/**
 * Doğal dil → niyet: önce Groq AI, kritik güvenlik/doğum-FAQ için kısa kural katmanı,
 * ardından tamamen keyword tabanlı yedek (Groq hata / geçersiz JSON).
 */

const Groq = require('groq-sdk');
const logger = require('./logger');

const VALID_INTENTS = [
  'general_astro_knowledge',
  'personal_chart_reading',
  'personal_topic_relationship',
  'personal_topic_career_money',
  'personal_topic_inner_world',
  'personal_topic_communication',
  'update_birth_data',
  'reset_profile',
  'unsupported_transit',
  'unsupported_horary',
  'risky_question',
  'unclear_message',
];

const VALID_SAFE_RESPONSE = new Set([
  'general_info',
  'personal_chart',
  'ask_birth_data',
  'unsupported',
  'safety_redirect',
]);

const INTENT_SYSTEM = `Sen bir Türkçe Telegram astroloji botunun niyet sınıflandırıcısısın.
Kullanıcı mesajını oku ve SADECE geçerli bir JSON nesnesi döndür (markdown yok, açıklama yok).

Şema (alanlar):
- intent: şu sabitlerden biri olmalı: ${VALID_INTENTS.join(', ')}
- confidence: 0 ile 1 arası sayı (en iyi tahminin ne kadar net olduğu)
- topic: kısa konu etiketi (birkaç kelime)
- needs_birth_data: true veya false
- safe_response_type: "general_info" | "personal_chart" | "ask_birth_data" | "unsupported" | "safety_redirect"
- personal_kind: "freeform" | "structured" | null
- ambiguity: null veya "personal_vs_general"

Kurallar:
- Mümkünse unclear_message kullanma; emin değilsen en güvenli ve olası niyeti seç.
- "ambiguity": "personal_vs_general" SADECE mesaj o kadar kısa/belirsiz ki hem genel tanım hem kişisel harita olabilirse (ör. tek kelime gezegen veya burç, "benim/haritam" yok).
- general_astro_knowledge: kavram tanımı, "X nedir", ev/gezegen genel anlamı, astro terim; kullanıcı kendi haritasından bahsetmiyorsa.
- personal_chart_reading: doğum haritasına bak, haritamı yorumla, genel kişisel okuma.
- personal_topic_relationship / career_money / inner_world / communication: ilişki, kariyer/para, iç dünya-aile, iletişim-öğrenme gibi YAŞAM ALANLARI (haritada ilgili ev başlıklarıyla özet).
- update_birth_data: doğum bilgisini yeniden girmek, haritayı güncellemek, tekrar girmek.
- reset_profile: profili sil, hafızayı temizle, verileri sıfırla.
- unsupported_transit: günlük gökyüzü, bugünkü transit, anlık gezegen konumu, günlük horoskop.
- unsupported_horary: horary, saatlik soru haritası.
- risky_question: kesin kader, kesin evlilik/ölüm, tıbbi/teşhis, yatırım tavsiyesi, kesin finans sonucu vb.
- needs_birth_data: kişisel harita veya konu yorumu için doğum verisi gerekir mi (genel bilgi için false).
- personal_kind: "benim Venüsüm", "7. evim" gibi spesifik yerleşim → freeform; geniş konu başlığı → structured; kişisel değilse null.
- safe_response_type: intent ile tutarlı olsun (risky → safety_redirect; transit/horary → unsupported; genel bilgi → general_info; kişisel harita → personal_chart veya ask_birth_data).

Yanıtın tek satır JSON olmalı.`;

function tnorm(text) {
  return String(text || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

const RISKY_RE =
  /kesin\s*(evlen|boşan|öl|ayrıl|aldat|hamile)|ne\s*zaman\s*öl|kesin\s*teşhis|tıbbi\s*teşhis|hisse\s*senedi|bitcoin\s*al|yatırım\s*tavsiye|para\s*kaybed|kesin\s*kader|aldatır\s*mı|aldatır\s*mi/i;

const RESET_PROFILE_RE =
  /\b(profilimi\s*sil|profilimi\s*sıfırla|verilerimi\s*sil|kayıtlarımı\s*sil|kayitlarimi\s*sil|hafızanı\s*temizle|hafizani\s*temizle|kayıtlı\s*verilerimi\s*sil|her\s*şeyi\s*sıfırla|herseyi\s*sifirla)\b/i;

const UPDATE_BIRTH_RE =
  /\b(yeniden|tekrar|baştan|bastan)\s*(doğum|dogum|harita).{0,18}(gir|yaz|ekle|girmek|gireceğim|girecegim)|(doğum|dogum|harita).{0,12}(yeniden|tekrar|güncelle|guncelle|değiştir|degistir)|haritam(ı|i)?\s*(yeniden|tekrar|baştan|bastan)|doğum\s*bilg(ilerimi|imi)\s*(güncelle|guncelle|değiştir|degistir|yenile)|güncelle\s*doğum|guncelle\s*dogum/i;

const HORARY_RE = /\bhorary\b|horary\s*yap|saatlik\s*soru|horary\s*çek|horary\s*ceek/i;

const TRANSIT_RE =
  /transit|bugün\s*gökyüzü|gökyüzü\s*bugün|günlük\s*horoskop|günlük\s*yorum|ay\s*döngüsü|yeni\s*ay|dolunay|ephemeris|şu\s*an\s*gezegen|gezegen\s*konumları\s*şimdi|yarının\s*gökyüzü|bugünkü\s*gökyüzü|günlük\s*transit/i;

const BIRTH_TIME_INFO_RE =
  /(saat|doğum\s*saati|dogum\s*saati).{0,45}bilmiyorum|bilmiyorum.{0,45}(saat|doğum\s*saati|dogum\s*saati)/i;

const PERSONAL_BODY_RE =
  /\b(benim|bende|bana|benden|ben\s|haritam|haritamda|haritama|dogum\s*haritam|natal|burcumda|bana\s*ozel|benim\s*icin|kacinci\s*ev)\b/i;

const PERSONAL_HOUSE_RE = /\bbenim\b.{0,24}\d{1,2}\s*\.?\s*evim\b/i;

const VAR_MI_RE =
  /\b(var\s*m(?:\u0131|i)|varm(?:\u0131|i)|yok\s*m(?:\u00fc|u)|yokmu)(?=\s|$|[?.!,])/i;

const PERSONAL_QUESTION_RE =
  /\b(nasil|ne\s*olur|ne\s*zaman|goster|soyle|yorum|bak|gorun|gosterir|olur\s*mu|nedir|ne\s*var|hangi|kim|neyi)\b|anlatiyor|anlatir|anlatacak|ne\s*anlat|cikiyor|cikar|on\s*e\s*cik|olacak\s*m(?:\u0131|i)(?=\s|$|[?.!,])/i;

const LIFE_AREA_PERSONAL_RE =
  /\biliski\w*|kariyer\w*|para\w*|evlilik\w*|ask\w*|\bis\s|\bis\w{2,}|isim\w*|hayatim|evim|burcum\w*/i;

const ASTRO_TOPIC_RE =
  /\b(gezegen|burc|burcu|burcum|\d{1,2}\s*\.?\s*ev|evler|yukselen|asc|mc|retro|kavusum|karsit|ucgen|kare|sekstil|dizilim|natal|harita|astroloj|element|oncu|sabit|degisken|dogum\s*haritasi|kova|balik|koc|boga|ikizler|yengec|aslan|basak|terazi|akrep|yay|oglak|gunes|ay\b|merkur|venus|mars|jupiter|saturn|uranus|neptun|pluton)\b/i;

const HARITA_READING_RE =
  /\b(dogum\s*)?haritam(a|i|da)?\s*(bak|yorum|anlat|incele|goster|oku|ac)|haritama\s*bak|natal\s*harit|haritami\s*yorumla|dogum\s*haritami\s*yorumla|kisisel\s*harita\s*yorum|haritam(a|i|da)?\b.{0,24}(ne\s*anlat|nasil|ne\s*der|yorum|bak)\b|\b(dogum\s*)?haritam\b/i;

const PLANET_POSSESSIVE_RE =
  /\b(venusum|gunesim|ayim|merkurum|marsim|jupiterim|saturnum|uranusum|neptunum|plutonum)\b/i;

const TOPIC_REL_RE =
  /\b(iliski\w*|ask\w*|flort\w*|evlilik\w*|partner\w*|esim\w*|sevgili\w*|romantik\w*|birliktelik\w*|7\.\s*ev\s*(nasil|hakkinda|hakkimda))\b/i;

const TOPIC_CAREER_RE =
  /\b(kariyer\w*|\bis\s|isim\w*|maas\w*|para\w*|finans\w*|ekonomi\w*|meslek\w*|kazan\w*|is\s*hayati|is hayati|para\s*kazan|degerler\w*|10\.\s*ev)\b/i;

const TOPIC_INNER_RE =
  /\b(ic\s*dunya\w*|duygularim\w*|duygusal\w*|aile\w*|anne\w*|baba\w*|cocuk\w*|yuva\w*|icsel\w*|ruh\w*|guven\s*ihtiyaci\w*|4\.\s*ev)\b/i;

const TOPIC_COMM_RE =
  /\b(iletisim\w*|ogrenme\w*|okul\w*|yazmak\w*|konusma\w*|ifade\w*|kardes\w*|komsu\w*|zihin\w*|3\.\s*ev)\b/i;

const UNCLEAR_GREETING_RE = /^(hi|hey|selam|merhaba|sa|slm|gunaydin|iyi\s*aksamlar|eee|ee|naber|napıyorsun|napıyorsun)\b/i;

const GUARD_CATEGORIES = new Set([
  'risky_question',
  'reset_profile',
  'update_birth_data',
  'unsupported_horary',
  'unsupported_transit',
]);

/**
 * Keyword tabanlı sınıflandırma (yedek / guard katmanı).
 * @returns {{
 *   category: string,
 *   reason: string,
 *   topicCode?: string,
 *   personalKind?: 'structured' | 'freeform',
 * }}
 */
function classifyMessageFallback(rawText) {
  const t = tnorm(rawText);
  if (!t) return { category: 'unclear_message', reason: 'empty' };

  if (RISKY_RE.test(rawText)) {
    return { category: 'risky_question', reason: 'risky' };
  }
  if (RESET_PROFILE_RE.test(rawText)) {
    return { category: 'reset_profile', reason: 'user_reset_text' };
  }
  if (UPDATE_BIRTH_RE.test(rawText)) {
    return { category: 'update_birth_data', reason: 'user_update_birth_text' };
  }
  if (HORARY_RE.test(rawText)) {
    return { category: 'unsupported_horary', reason: 'horary' };
  }
  if (TRANSIT_RE.test(rawText)) {
    return { category: 'unsupported_transit', reason: 'transit_or_daily' };
  }
  if (BIRTH_TIME_INFO_RE.test(rawText)) {
    return { category: 'general_astro_knowledge', reason: 'birth_time_faq' };
  }

  const hasPersonalBody = PERSONAL_BODY_RE.test(t);
  const hasPersonalHouse = PERSONAL_HOUSE_RE.test(t);
  const hasQuestionShape = PERSONAL_QUESTION_RE.test(t);
  const hasLifeArea = LIFE_AREA_PERSONAL_RE.test(t);
  const hasHaritaReading = HARITA_READING_RE.test(t);

  const chartDetailPersonal =
    hasPersonalHouse ||
    PLANET_POSSESSIVE_RE.test(t) ||
    (hasPersonalBody &&
      /\b(bende|benim)\b/i.test(t) &&
      VAR_MI_RE.test(rawText)) ||
    (hasPersonalBody &&
      hasQuestionShape &&
      (PLANET_POSSESSIVE_RE.test(t) ||
        /\b(venus|gunes|ay|merkur|mars|jupiter|saturn|uranus|neptun|pluton)\w*\b/i.test(t)));

  if (chartDetailPersonal) {
    return { category: 'personal_chart_reading', reason: 'chart_detail', personalKind: 'freeform' };
  }

  const asksPersonalTopic =
    hasHaritaReading ||
    hasPersonalBody ||
    hasLifeArea ||
    TOPIC_REL_RE.test(t) ||
    TOPIC_CAREER_RE.test(t) ||
    TOPIC_INNER_RE.test(t) ||
    TOPIC_COMM_RE.test(t);

  if (asksPersonalTopic) {
    if (TOPIC_REL_RE.test(t) && (hasQuestionShape || hasLifeArea || hasPersonalBody || hasHaritaReading)) {
      return {
        category: 'personal_topic_relationship',
        reason: 'topic_relationship',
        topicCode: 'relationships',
        personalKind: 'structured',
      };
    }
    if (TOPIC_CAREER_RE.test(t) && (hasQuestionShape || hasLifeArea || hasPersonalBody || hasHaritaReading)) {
      return {
        category: 'personal_topic_career_money',
        reason: 'topic_career',
        topicCode: 'work_money',
        personalKind: 'structured',
      };
    }
    if (TOPIC_INNER_RE.test(t) && (hasQuestionShape || hasLifeArea || hasPersonalBody || hasHaritaReading)) {
      return {
        category: 'personal_topic_inner_world',
        reason: 'topic_inner',
        topicCode: 'inner_family',
        personalKind: 'structured',
      };
    }
    if (TOPIC_COMM_RE.test(t) && (hasQuestionShape || hasLifeArea || hasPersonalBody || hasHaritaReading)) {
      return {
        category: 'personal_topic_communication',
        reason: 'topic_comm',
        topicCode: 'communication_learning',
        personalKind: 'structured',
      };
    }
    if (hasHaritaReading || (hasPersonalBody && (hasQuestionShape || hasLifeArea))) {
      return {
        category: 'personal_chart_reading',
        reason: 'general_chart_reading',
        topicCode: 'general',
        personalKind: 'structured',
      };
    }
  }

  if (ASTRO_TOPIC_RE.test(t) || /\b(ne\s*demek|demektir|anlam|acikl|nedir)\b/i.test(t)) {
    return { category: 'general_astro_knowledge', reason: 'astro_topic' };
  }

  if (t.length <= 2 || UNCLEAR_GREETING_RE.test(t)) {
    return { category: 'unclear_message', reason: 'too_short_or_greeting' };
  }

  return { category: 'unclear_message', reason: 'no_match' };
}

/** Senkron yedek: test ve harici çağrılar için */
function classifyMessage(rawText) {
  return classifyMessageFallback(rawText);
}

function intentToTopicCode(intent) {
  switch (intent) {
    case 'personal_topic_relationship':
      return 'relationships';
    case 'personal_topic_career_money':
      return 'work_money';
    case 'personal_topic_inner_world':
      return 'inner_family';
    case 'personal_topic_communication':
      return 'communication_learning';
    case 'personal_chart_reading':
      return 'general';
    default:
      return 'general';
  }
}

function parseGroqJsonContent(content) {
  const raw = String(content || '').trim();
  if (!raw) return null;
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(raw);
  if (parsed) return parsed;
  const fence = raw.match(/\{[\s\S]*\}/);
  if (fence) {
    parsed = tryParse(fence[0]);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeGroqPayload(obj, rawUserText) {
  if (!obj || typeof obj !== 'object') return null;
  let intent = String(obj.intent || '').trim();
  if (!VALID_INTENTS.includes(intent)) intent = 'unclear_message';

  let conf = Number(obj.confidence);
  if (!Number.isFinite(conf)) conf = 0.6;
  conf = Math.min(1, Math.max(0, conf));

  const topic = String(obj.topic || '').trim().slice(0, 120);
  let needsBirth =
    obj.needs_birth_data === true ||
    obj.needs_birth_data === 'true' ||
    obj.needs_birth_data === 1;

  let safeType = String(obj.safe_response_type || '').trim();
  if (!VALID_SAFE_RESPONSE.has(safeType)) {
    safeType =
      intent === 'risky_question'
        ? 'safety_redirect'
        : intent === 'unsupported_transit' || intent === 'unsupported_horary'
          ? 'unsupported'
          : intent.startsWith('personal')
            ? 'personal_chart'
            : 'general_info';
  }

  let personalKind = obj.personal_kind;
  if (personalKind !== 'freeform' && personalKind !== 'structured') personalKind = null;

  const ambiguity = obj.ambiguity === 'personal_vs_general' ? 'personal_vs_general' : null;

  if (
    intent === 'personal_chart_reading' ||
    intent === 'personal_topic_relationship' ||
    intent === 'personal_topic_career_money' ||
    intent === 'personal_topic_inner_world' ||
    intent === 'personal_topic_communication'
  ) {
    if (!personalKind) {
      personalKind = intent === 'personal_chart_reading' ? 'structured' : 'structured';
    }
  }

  const topicCode = intentToTopicCode(intent);

  return {
    intent,
    confidence: conf,
    topic,
    needsBirthData: needsBirth,
    safeResponseType: safeType,
    personalKind,
    ambiguity,
    topicCode,
    rawUserText,
  };
}

function groqPayloadToClassification(payload, intentSource) {
  const {
    intent,
    confidence,
    topic,
    needsBirthData,
    safeResponseType,
    personalKind,
    ambiguity,
    topicCode,
  } = payload;

  const base = {
    category: intent,
    reason: 'groq_ai',
    confidence,
    topicLabel: topic,
    needsBirthData,
    safeResponseType,
    intentSource,
    ambiguousPersonalVsGeneral: ambiguity === 'personal_vs_general',
  };

  const personalTopics = new Set([
    'personal_topic_relationship',
    'personal_topic_career_money',
    'personal_topic_inner_world',
    'personal_topic_communication',
  ]);

  if (personalTopics.has(intent)) {
    return {
      ...base,
      topicCode,
      personalKind: personalKind || 'structured',
    };
  }
  if (intent === 'personal_chart_reading') {
    return {
      ...base,
      topicCode,
      personalKind: personalKind || 'structured',
    };
  }
  return base;
}

async function classifyWithGroqRaw(userText, apiKey, model) {
  const client = new Groq({ apiKey });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.05,
    max_tokens: 220,
    messages: [
      { role: 'system', content: INTENT_SYSTEM },
      { role: 'user', content: String(userText || '').trim() },
    ],
  });
  const content = completion.choices?.[0]?.message?.content;
  return parseGroqJsonContent(content);
}

/**
 * Ana giriş: guard (keyword) → Groq → belirsizlikte yedek birleştirme.
 * @returns {Promise<{
 *   category: string,
 *   reason: string,
 *   topicCode?: string,
 *   personalKind?: 'structured' | 'freeform',
 *   confidence?: number|null,
 *   topicLabel?: string,
 *   needsBirthData?: boolean,
 *   safeResponseType?: string,
 *   intentSource: string,
 *   ambiguousPersonalVsGeneral?: boolean,
 *   groqErrorMessage?: string
 * }>}
 */
async function classifyMessageAsync(rawText, options = {}) {
  const text = String(rawText || '').trim();
  const fb = classifyMessageFallback(text);

  if (GUARD_CATEGORIES.has(fb.category)) {
    return { ...fb, intentSource: 'keyword_guard', confidence: 1, topicLabel: '' };
  }
  if (fb.reason === 'birth_time_faq') {
    return {
      ...fb,
      intentSource: 'keyword_birth_time_faq',
      confidence: 1,
      topicLabel: 'birth_time_unknown',
      needsBirthData: false,
      safeResponseType: 'general_info',
    };
  }

  const apiKey = (options.apiKey || '').trim();
  const model = (options.model || 'llama-3.3-70b-versatile').trim();

  if (!apiKey) {
    return { ...fb, intentSource: 'no_api_key_fallback', confidence: null };
  }

  try {
    const parsed = await classifyWithGroqRaw(text, apiKey, model);
    const norm = normalizeGroqPayload(parsed, text);
    if (!norm) {
      logger.error('[intent] Groq geçersiz veya boş JSON', { preview: String(parsed).slice(0, 200) });
      return { ...fb, intentSource: 'groq_invalid_json', confidence: null, groqErrorMessage: 'invalid_json' };
    }

    let cls = groqPayloadToClassification(norm, 'groq');

    if (cls.ambiguousPersonalVsGeneral) {
      cls = { ...cls, reason: 'groq_ambiguous_personal_vs_general', intentSource: 'groq' };
    }

    if (
      cls.category === 'unclear_message' &&
      !cls.ambiguousPersonalVsGeneral &&
      fb.category !== 'unclear_message'
    ) {
      cls = {
        ...fb,
        intentSource: 'fallback_after_groq_unclear',
        confidence: norm.confidence,
        topicLabel: norm.topic,
        ambiguousPersonalVsGeneral: false,
      };
    }

    return cls;
  } catch (e) {
    logger.error('[intent] Groq niyet sınıflandırması başarısız', {
      message: e.message,
      stack: e.stack,
      name: e.name,
    });
    return {
      ...fb,
      intentSource: 'groq_error',
      confidence: null,
      groqErrorMessage: e.message || String(e),
    };
  }
}

module.exports = {
  classifyMessage,
  classifyMessageFallback,
  classifyMessageAsync,
};
