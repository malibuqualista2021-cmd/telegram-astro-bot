/**
 * Doğal dil → niyet (kurallı, hızlı).
 * Groq kullanmaz; index.js bu çıktıya göre akışı yönlendirir.
 */

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

/**
 * @returns {{
 *   category: string,
 *   reason: string,
 *   topicCode?: string,
 *   personalKind?: 'structured' | 'freeform',
 * }}
 */
function classifyMessage(rawText) {
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

module.exports = { classifyMessage };
