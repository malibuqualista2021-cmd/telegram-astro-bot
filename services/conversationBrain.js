/**
 * Ana sohbet beyni: her tur Groq ile action + doğal reply.
 * Kişisel harita / horary sayıları burada uydurulmaz; yalnızca karar ve kullanıcıya metin.
 * Groq/API çökünce decideFallback (messageClassifier yalnızca burada).
 */

const Groq = require('groq-sdk');
const logger = require('./logger');
const messageClassifier = require('./messageClassifier');

const VALID_ACTIONS = new Set([
  'reply',
  'ask_birth_date',
  'ask_birth_place',
  'ask_birth_time',
  'ask_horary_location',
  'generate_chart_reading',
  'generate_horary_reading',
  'summarize_previous',
  'reset_profile',
  'update_profile',
]);

const VALID_CHART_TOPIC_CODES = new Set([
  'general',
  'relationships',
  'work_money',
  'inner_family',
  'communication_learning',
]);

const BRAIN_SYSTEM = `Sen Türkçe konuşan bir Telegram astroloji asistanının TEK karar beynisin.
Kullanıcı mesajını, sohbet geçmişini, oturum adımını ve özet verileri okuyup YALNIZCA tek satır JSON döndür (markdown yok, açıklama yok).

Şema:
- action: "reply" | "ask_birth_date" | "ask_birth_place" | "ask_birth_time" | "ask_horary_location" | "generate_chart_reading" | "generate_horary_reading" | "summarize_previous" | "reset_profile" | "update_profile"
- reply: Kullanıcıya gönderilecek doğal Türkçe metin (çoğu durumda dolu; 1–10 cümle olabilir). Robot dili, menü dayatması yok.
- topic: kısa konu etiketi (birkaç kelime)
- needs_data: boolean — bu turda ek veri (doğum/horary konumu vb.) şart mı?
- use_profile: boolean — kayıtlı doğum profili / harita bağlamı kullanılsın mı?
- use_last_context: boolean — son asistan cevabı / son mesajlar bu tur için önemli mi?
- chart_topic_code: null veya "general" | "relationships" | "work_money" | "inner_family" | "communication_learning" — yalnızca action generate_chart_reading ve geniş konu başlığı seçilebiliyorsa dolu olsun.

Kesin kurallar:
1) "Anlamadım", "şunu yazmalısın", "geçerli seçenek", "1 2 3", menü zorlaması, kırık robot cümlesi KULLANMA.
2) Kişisel harita yerleşimi (ev, yükselen derece, gezegen evi) UYDURMA. chart_summary yoksa veya has_chart_snapshot false ise generate_chart_reading SEÇME; ask_birth_date / ask_birth_place / ask_birth_time veya reply ile doğal şekilde bilgi iste.
3) chart_summary.chart_mode "partial" ise yükselen/ev kesinliği iddia etme.
4) Kesin kader, kesin evlilik/ayrılık/ölüm, tıbbi teşhis, hamilelik kesinliği, yatırım/hukuk sonucu, üçüncü kişi aldatma kesinliği → action "reply"; reply içinde güvenli, sıcak sınır koy (kesin hüküm yok).
5) Horary (soru anı): "olur mu", "alacak mıyım", "horary yap" vb. → ask_horary_location; doğum bilgisi isteme; reply kısa teyit olabilir.
6) Genel kavram ("7. ev ne demek") → action "reply" ve açıklamanın tamamını reply içinde ver (mümkünse dolu tut).
7) Özet: "kısaca", "özetle", "sonuç ne" ve anlamlı son asistan cevabı varsa → summarize_previous; reply kısa olabilir veya boş.
8) Hal hatır, astro dışı hafif sohbet → reply; sıcak ve doğal ol.
9) reset_profile / update_profile yalnızca kullanıcı açıkça profil silme veya doğum güncelleme istediğinde.
10) generate_horary_reading: yalnızca payload has_horary_chart_snapshot true ise; değilse ask_horary_location veya reply.
11) Yanıt TEK satır JSON.`;

function planetSign(chartData, name) {
  if (!chartData || !Array.isArray(chartData.planets)) return null;
  const p = chartData.planets.find((x) => x && String(x.name) === name);
  return p && p.sign ? String(p.sign) : null;
}

function briefChartSummary(chartData) {
  if (!chartData || typeof chartData !== 'object') return null;
  return {
    chart_mode: chartData.chart_mode || null,
    data_availability: chartData.data_availability || null,
    sun_sign: planetSign(chartData, 'Sun'),
    moon_sign: planetSign(chartData, 'Moon'),
    has_asc: Boolean(chartData.angles && chartData.angles.ASC != null),
  };
}

function briefHorarySummary(h) {
  if (!h || typeof h !== 'object') return null;
  return {
    chart_type: h.chart_type || 'horary',
    question: (h.question || '').slice(0, 200),
    received_at_utc: h.received_at_utc || null,
    place_label: h.location && h.location.place_label ? h.location.place_label : null,
  };
}

function profileHasChart(profile) {
  return Boolean(profile && profile.lastChartData);
}

function sessionHasChart(session) {
  return Boolean(session && session.lastChartData);
}

function hasChartSnapshot(session, profile) {
  return sessionHasChart(session) || profileHasChart(profile);
}

function parseBrainJson(content) {
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

/** Eski şema (reply_mode) → yeni action alanları */
function liftLegacyFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.action && VALID_ACTIONS.has(String(obj.action))) return obj;
  const rm = String(obj.reply_mode || '').trim();
  const dr = String(obj.direct_reply ?? obj.reply ?? '').trim();
  const topic_code = obj.topic_code;
  if (rm === 'safety_redirect') return { ...obj, action: 'reply', reply: dr };
  if (rm === 'summarize_previous') return { ...obj, action: 'summarize_previous', reply: dr };
  if (rm === 'horary') return { ...obj, action: 'ask_horary_location', reply: dr };
  if (rm === 'ask_birth_data')
    return {
      ...obj,
      action: 'ask_birth_date',
      reply: dr,
      chart_topic_code: VALID_CHART_TOPIC_CODES.has(String(topic_code)) ? topic_code : null,
    };
  if (rm === 'personal_chart')
    return {
      ...obj,
      action: 'generate_chart_reading',
      reply: dr,
      chart_topic_code: VALID_CHART_TOPIC_CODES.has(String(topic_code)) ? topic_code : null,
    };
  if (rm === 'general_astro') return { ...obj, action: 'reply', reply: dr };
  if (rm === 'direct_chat' || rm === 'direct_answer') return { ...obj, action: 'reply', reply: dr };
  return obj;
}

function normalizeBrain(obj, rawUserText, session, profile) {
  const lifted = liftLegacyFields(obj || {});
  let action = String(lifted.action || 'reply').trim();
  if (!VALID_ACTIONS.has(action)) action = 'reply';

  let chart_topic_code = lifted.chart_topic_code;
  if (chart_topic_code != null && !VALID_CHART_TOPIC_CODES.has(String(chart_topic_code))) chart_topic_code = null;

  let needs_data = Boolean(lifted.needs_data);
  const use_profile = Boolean(lifted.use_profile);
  const use_last_context =
    lifted.use_last_context === true ||
    lifted.use_last_context === 'true' ||
    lifted.should_use_last_answer === true ||
    lifted.should_use_last_context === true;

  let reply = String(lifted.reply ?? lifted.direct_reply ?? '').trim().slice(0, 4000);
  const topic = String(lifted.topic || '').trim().slice(0, 120);
  const intent = String(lifted.intent || '').trim().slice(0, 80) || 'unspecified';

  const hasChart = hasChartSnapshot(session, profile);
  const hasHorarySnap = Boolean(session && session.lastHoraryChartData);

  if (action === 'generate_chart_reading' && !hasChart) {
    action = 'ask_birth_date';
    needs_data = true;
    if (!reply) {
      reply =
        'Kişisel haritandan bahsettiğinde önce doğum tarihine ihtiyacım oluyor; istersen birlikte adım adım girelim.';
    }
  }

  if (action === 'generate_horary_reading' && !hasHorarySnap) {
    action = 'ask_horary_location';
    needs_data = true;
    if (!reply) {
      reply = 'Horary için önce sorduğun şeyi ve bulunduğun yeri netleştirelim; böylece haritayı doğru kurarım.';
    }
  }

  if (action === 'summarize_previous') {
    const last = session && session.lastAssistantAnswer ? String(session.lastAssistantAnswer) : '';
    if (!last || last.trim().length < 40) {
      action = 'reply';
      if (!reply) {
        reply =
          'Az önce uzun bir yanıt göremedim; bugün neye odaklanmamı istersin, bir cümleyle yazabilir misin?';
      }
    }
  }

  if (action === 'ask_birth_place' && session && !session.birthYmd) {
    action = 'ask_birth_date';
    needs_data = true;
  }

  if (action === 'ask_birth_time' && session && (session.latitude == null || !session.birthYmd)) {
    action = session && session.birthYmd ? 'ask_birth_place' : 'ask_birth_date';
    needs_data = true;
  }

  return {
    action,
    reply,
    topic,
    needs_data,
    use_profile,
    use_last_context,
    chart_topic_code,
    intent,
    intentSource: obj._intentSource || 'groq_brain',
  };
}

function looksLikeSummarizeRequest(rawText) {
  const s = String(rawText || '').trim();
  if (s.length > 200) return false;
  return /kısaca|kisaca|özetle|özet|anlamadım|anlamiyorum|tekrar\s*anlat|basitleştir|sadeleştir|daha\s*kısa|daha\s*anlaşılır|sonuç\s*ne|neydi|ne\s*demek\s*istiyorsun|tek\s*cümle|tekrar\s*et|basit\s*anlat/i.test(
    s
  );
}

function classificationToDecision(cls, userText) {
  const cat = cls.category;
  const base = {
    topic: String(cls.topicLabel || '').trim().slice(0, 120),
    needs_data: false,
    use_profile: false,
    use_last_context: false,
    chart_topic_code: cls.topicCode && VALID_CHART_TOPIC_CODES.has(cls.topicCode) ? cls.topicCode : null,
    intent: cat,
    intentSource: 'classifier_fallback',
  };

  if (cat === 'reset_profile') {
    return {
      ...base,
      action: 'reset_profile',
      reply:
        'Kayıtlı profili silmek kalıcıdır; bunu /reset ile yapmanı öneririm. İptal etmek istersen yazmaya devam edebilirsin.',
    };
  }
  if (cat === 'update_birth_data') {
    return {
      ...base,
      action: 'update_profile',
      reply: 'Doğum bilgilerini yenilemek için /update_birth ile başlayabilirsin; oradan tarih ve yeri birlikte gireriz.',
    };
  }
  if (cat === 'horary_question') {
    return { ...base, action: 'ask_horary_location', reply: '', needs_data: true };
  }
  if (cat === 'risky_question') {
    return {
      ...base,
      action: 'reply',
      reply:
        'Bu konuda kesin hüküm veya kader dili kullanmıyorum. İstersen genel bir astroloji konusunda veya haritan üzerinden daha güvenli bir çerçevede konuşabiliriz.',
    };
  }
  if (cat === 'unsupported_transit') {
    return {
      ...base,
      action: 'reply',
      reply:
        'Günlük transit ve anlık gökyüzü bu sürümde yok; doğum haritan veya genel kavramlarda yardımcı olabilirim.',
    };
  }
  if (cat === 'general_astro_knowledge' && cls.reason === 'birth_time_faq') {
    return { ...base, action: 'reply', reply: '', intent: 'birth_time_faq' };
  }
  if (cat === 'general_astro_knowledge') {
    return { ...base, action: 'reply', reply: '', intent: 'general_astro' };
  }
  if (
    cat === 'personal_chart_reading' ||
    cat === 'personal_topic_relationship' ||
    cat === 'personal_topic_career_money' ||
    cat === 'personal_topic_inner_world' ||
    cat === 'personal_topic_communication'
  ) {
    return {
      ...base,
      action: 'generate_chart_reading',
      reply: '',
      needs_data: true,
      chart_topic_code: base.chart_topic_code || 'general',
      intent: 'personal_chart',
    };
  }
  if (cat === 'unclear_message') {
    const t = String(userText || '').trim();
    if (t.length <= 28 && /^(selam|merhaba|hey|hi|slm|naber|nasılsın|nasilsin|günaydın|iyi\s*akşamlar)/i.test(t)) {
      return {
        ...base,
        action: 'reply',
        reply:
          'Selam, buradayım. İstersen haritandan, bir astro kavramından ya da soru anı haritasından devam edebiliriz.',
        intent: 'greeting',
      };
    }
    return {
      ...base,
      action: 'reply',
      reply: 'Buradayım; harita, genel bir astro sorusu veya sohbet — neye bakalım?',
      intent: 'open_chat',
    };
  }
  return {
    ...base,
    action: 'reply',
    reply: 'Buradayım; astroloji veya harita tarafında nasıl yardımcı olayım?',
    intent: 'fallback',
  };
}

function decideFallback(userText, session, profile) {
  const t = String(userText || '').trim();
  if (looksLikeSummarizeRequest(t) && session && session.lastAssistantAnswer) {
    return {
      action: 'summarize_previous',
      reply: '',
      topic: 'özet',
      needs_data: false,
      use_profile: false,
      use_last_context: true,
      chart_topic_code: null,
      intent: 'summarize_previous',
      intentSource: 'keyword_summarize',
    };
  }
  const fb = messageClassifier.classifyMessageFallback(userText);
  return classificationToDecision(fb, userText);
}

function birthCollectionStep(session) {
  const step = session && session.step;
  if (step === 'await_date') return 'await_date';
  if (step === 'await_place') return 'await_place';
  if (step === 'await_time') return 'await_time';
  if (step === 'await_topic') return 'await_topic';
  if (step === 'await_concept') return 'await_concept';
  return null;
}

function horaryAwaiting(session) {
  const step = session && session.step;
  if (step === 'await_horary_question') return 'question';
  if (step === 'await_horary_place') return 'place';
  return null;
}

function buildUserPayload(userText, session, profile, options = {}) {
  const chartSummary =
    briefChartSummary(session.lastChartData) ||
    (profileHasChart(profile) ? briefChartSummary(profile.lastChartData) : null);
  const horarySummary = briefHorarySummary(session.lastHoraryChartData);
  const lastAns = session.lastAssistantAnswer ? String(session.lastAssistantAnswer).slice(0, 3500) : '';
  const history = Array.isArray(session.conversationHistory) ? session.conversationHistory.slice(-16) : [];

  return JSON.stringify(
    {
      user_message: userText,
      session_step: session.step || null,
      birth_collection_step: birthCollectionStep(session),
      horary_awaiting: horaryAwaiting(session),
      awaiting_topic_choice: options.awaitingTopic === true,
      awaiting_topic_preset: options.awaitingTopicPreset === true,
      profile_complete: options.profileComplete === true,
      has_saved_birth_profile: Boolean(
        profile && profile.birthDate && profile.birthPlace && profile.birthPlace.label
      ),
      has_chart_snapshot: hasChartSnapshot(session, profile),
      chart_summary: chartSummary,
      has_horary_chart_snapshot: Boolean(session.lastHoraryChartData),
      horary_summary: horarySummary,
      conversation_history: history,
      last_assistant_answer_excerpt: lastAns
        ? `${lastAns.slice(0, 2600)}${lastAns.length > 2600 ? '\n…(kısaltıldı)' : ''}`
        : null,
    },
    null,
    0
  );
}

/**
 * Her tur Groq (API yoksa veya hata/JSON bozuksa fallback).
 */
async function decide(userText, session, profile, apiKey, model, options = {}) {
  const text = String(userText || '').trim();
  const key = String(apiKey || '').trim();
  const m = String(model || 'llama-3.3-70b-versatile').trim();

  if (!key) {
    return decideFallback(text, session, profile);
  }

  const client = new Groq({ apiKey: key });
  try {
    const completion = await client.chat.completions.create({
      model: m,
      temperature: 0.35,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: BRAIN_SYSTEM },
        {
          role: 'user',
          content: buildUserPayload(text, session, profile, options),
        },
      ],
    });
    const content = completion.choices?.[0]?.message?.content;
    const parsed = parseBrainJson(content);
    if (!parsed) {
      logger.warn('[brain] Geçersiz JSON, fallback');
      const fb = decideFallback(text, session, profile);
      return { ...fb, intentSource: 'groq_invalid_json' };
    }
    parsed._intentSource = 'groq_brain';
    return normalizeBrain(parsed, text, session, profile);
  } catch (e) {
    logger.error('[brain] Groq hatası', { message: e.message });
    const fb = decideFallback(text, session, profile);
    return { ...fb, intentSource: 'groq_error', groqErrorMessage: e.message };
  }
}

module.exports = {
  decide,
  decideFallback,
  looksLikeSummarizeRequest,
  briefChartSummary,
  VALID_ACTIONS,
  VALID_CHART_TOPIC_CODES,
};
