/**
 * Ana sohbet beyni: her tur Groq ile karar + doğal direct_reply.
 * Kişisel harita / horary sayıları burada uydurulmaz; yalnızca yönlendirme ve kullanıcıya metin.
 * Groq/API çökünce decideFallback devreye girer (messageClassifier yalnızca burada).
 */

const Groq = require('groq-sdk');
const logger = require('./logger');
const messageClassifier = require('./messageClassifier');

const REPLY_MODES = [
  'direct_chat',
  'general_astro',
  'personal_chart',
  'ask_birth_data',
  'horary',
  'summarize_previous',
  'safety_redirect',
];

const VALID_TOPIC_CODES = new Set([
  'general',
  'relationships',
  'work_money',
  'inner_family',
  'communication_learning',
]);

const BRAIN_SYSTEM = `Sen Türkçe konuşan bir Telegram astroloji asistanının TEK karar ve yanıt planlama beynisin.
Kullanıcı mesajını, sohbet geçmişini, oturum adımını ve özet verileri okuyup YALNIZCA tek satır JSON döndür (markdown yok, açıklama yok).

Şema (alanlar):
- reply_mode: "direct_chat" | "general_astro" | "personal_chart" | "ask_birth_data" | "horary" | "summarize_previous" | "safety_redirect"
- intent: kısa etiket (örn. selam, horary_is, venus_7th_question, ozet_isteği)
- confidence: 0 ile 1 arası sayı
- needs_birth_data: boolean — doğum tarihi/yeri/saat toplamak gerekiyor mu?
- needs_chart_data: boolean — kişisel harita yorumu için hesaplanmış chartData şart mı?
- needs_horary_data: boolean — horary için soru+zaman+yer akışı şart mı?
- should_use_last_answer: boolean — son asistan cevabı bu tur için önemli mi (özet vb.)?
- topic: kısa Türkçe konu (birkaç kelime)
- topic_code: null veya "general" | "relationships" | "work_money" | "inner_family" | "communication_learning" (personal_chart + geniş konu özeti için)
- personal_style: null veya "freeform" | "structured" (freeform: "benim 7. evim"; structured: ilişkiler/kariyer başlığı)
- direct_reply: Kullanıcıya gösterilecek doğal Türkçe metin (1–8 cümle). Soğuk robot dili kullanma.
- account_action: null veya "reset_profile" | "update_birth" — kullanıcı açıkça profil silme veya doğum güncelleme istiyorsa

Kesin kurallar:
1) "Anlamadım", "şunu yazmalısın", "geçerli seçenek", menü dayatması, kırık Türkçe robot cümlesi KULLANMA.
2) Kişisel harita detayı (gezegen derecesi, ev, yükselen, açı) UYDURMA. chart_summary yoksa veya chart yoksa personal_chart seçme; ask_birth_data veya direct_chat ile nazikçe doğum bilgisi iste.
3) chart_summary.chart_mode "partial" ise yükselen/ev kesinliği iddia etme; saat sorulabilir.
4) Kesin kader, kesin evlilik/ayrılık/ölüm, tıbbi teşhis, hamilelik kesinliği, yatırım/hukuk sonucu, üçüncü kişi aldatma kesinliği → safety_redirect; direct_reply ile güvenli, sıcak sınır koy (kesin hüküm yok).
5) Horary: net evet/hayır/soru anı ("olur mu", "alacak mıyım", "horary yap") → horary; doğum bilgisi isteme; direct_reply ile kısa teyit + konum isteği olabilir.
6) Genel kavram ("7. ev ne demek") → general_astro; direct_reply kısa bir giriş cümlesi olabilir veya boş string (detay ayrı katmanda üretilir).
7) Özet: kullanıcı "kısaca", "anlamadım", "özetle", "sonuç ne" ve son asistan cevabı varsa → summarize_previous; direct_reply boş veya çok kısa olabilir.
8) Hal hatır, astro dışı hafif sohbet → direct_chat; direct_reply dolu olsun; istersen astrolojiye yumuşak köprü kur.
9) account_action yalnızca kullanıcı net silme/güncelleme talep ettiğinde dolu olsun.
10) Yanıt TEK satır JSON.`;

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

function normalizeReplyMode(mode) {
  const m = String(mode || '').trim();
  if (m === 'direct_answer') return 'direct_chat';
  if (REPLY_MODES.includes(m)) return m;
  return 'direct_chat';
}

function normalizeBrain(obj, rawUserText, ctx) {
  const text = String(rawUserText || '').trim();
  let reply_mode = normalizeReplyMode(obj.reply_mode);

  let topic_code = obj.topic_code;
  if (topic_code != null && !VALID_TOPIC_CODES.has(String(topic_code))) topic_code = null;

  let personal_style = obj.personal_style;
  if (personal_style !== 'freeform' && personal_style !== 'structured') personal_style = null;

  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.65;
  confidence = Math.min(1, Math.max(0, confidence));

  const needs_birth_data = Boolean(obj.needs_birth_data);
  const needs_chart_data = Boolean(obj.needs_chart_data);
  const needs_horary_data = Boolean(obj.needs_horary_data);
  const should_use_last_answer =
    obj.should_use_last_answer === true ||
    obj.should_use_last_answer === 'true' ||
    obj.should_use_last_context === true;

  let direct_reply = String(obj.direct_reply ?? obj.user_facing_reply_hint ?? '').trim().slice(0, 4000);

  let account_action = obj.account_action;
  if (account_action !== 'reset_profile' && account_action !== 'update_birth') account_action = null;

  const topic = String(obj.topic || '').trim().slice(0, 120);
  const intent = String(obj.intent || '').trim().slice(0, 80) || 'unspecified';

  if (reply_mode === 'summarize_previous' && !ctx.hasLastAssistant) {
    reply_mode = 'direct_chat';
    if (!direct_reply) {
      direct_reply =
        'Az önce uzun bir yanıt göremedim; neye odaklanmamı veya nasıl yardım etmemi istersin, bir cümleyle yazabilir misin?';
    }
  }

  if (reply_mode === 'personal_chart' && !topic_code) {
    topic_code = 'general';
  }

  return {
    intent,
    reply_mode,
    confidence,
    needs_birth_data,
    needs_chart_data,
    needs_horary_data,
    should_use_last_answer,
    topic,
    topic_code,
    personal_style,
    direct_reply,
    account_action,
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

function classificationToBrain(cls, userText) {
  const cat = cls.category;
  const base = {
    intent: cat,
    confidence: 0.55,
    needs_birth_data: false,
    needs_chart_data: false,
    needs_horary_data: false,
    should_use_last_answer: false,
    topic: String(cls.topicLabel || '').trim().slice(0, 120),
    topic_code: cls.topicCode || null,
    personal_style: cls.personalKind || null,
    direct_reply: '',
    account_action: null,
    intentSource: 'classifier_fallback',
  };

  if (cat === 'reset_profile') {
    return {
      ...base,
      reply_mode: 'direct_chat',
      intent: 'reset_profile',
      account_action: 'reset_profile',
      confidence: 0.95,
      direct_reply:
        'Kayıtlı doğum profilini silmek üzeresin. Onaylamak için /reset komutunu kullanman daha güvenli; istersen önce sorabilirsin.',
    };
  }
  if (cat === 'update_birth_data') {
    return {
      ...base,
      reply_mode: 'direct_chat',
      intent: 'update_birth',
      account_action: 'update_birth',
      confidence: 0.95,
      direct_reply:
        'Doğum bilgilerini yenilemek için /update_birth yazabilirsin; oradan tarih ve yeri adım adım alırım.',
    };
  }
  if (cat === 'horary_question') {
    return {
      ...base,
      reply_mode: 'horary',
      needs_horary_data: true,
      intent: 'horary',
      confidence: 0.85,
      direct_reply: '',
    };
  }
  if (cat === 'risky_question') {
    return {
      ...base,
      reply_mode: 'safety_redirect',
      intent: 'risky',
      confidence: 0.9,
      direct_reply:
        'Bu konuda kesin hüküm veya kader dili kullanmıyorum. Genel bir astroloji konusunda veya haritan üzerinden güvenli bir çerçevede konuşabiliriz.',
    };
  }
  if (cat === 'unsupported_transit') {
    return {
      ...base,
      reply_mode: 'direct_chat',
      intent: 'transit',
      confidence: 0.85,
      direct_reply:
        'Günlük transit ve anlık gökyüzü hesabı bu sürümde yok; doğum haritan veya genel kavramlarda yardımcı olabilirim.',
    };
  }
  if (cat === 'general_astro_knowledge' && cls.reason === 'birth_time_faq') {
    return {
      ...base,
      reply_mode: 'general_astro',
      intent: 'birth_time_faq',
      confidence: 0.95,
      direct_reply: '',
    };
  }
  if (cat === 'general_astro_knowledge') {
    return {
      ...base,
      reply_mode: 'general_astro',
      intent: 'general_astro',
      topic_code: null,
      personal_style: null,
      confidence: 0.75,
      direct_reply: '',
    };
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
      reply_mode: 'personal_chart',
      needs_chart_data: true,
      topic_code: base.topic_code || 'general',
      intent: 'personal_chart',
      confidence: 0.75,
      direct_reply: '',
    };
  }
  if (cat === 'unclear_message') {
    const t = String(userText || '').trim();
    if (t.length <= 28 && /^(selam|merhaba|hey|hi|slm|naber|nasılsın|nasilsin|günaydın|iyi\s*akşamlar)/i.test(t)) {
      return {
        ...base,
        reply_mode: 'direct_chat',
        intent: 'greeting',
        topic_code: null,
        personal_style: null,
        confidence: 0.8,
        direct_reply:
          'Selam, buradayım. İstersen haritandan, bir astro kavramından ya da soru anı (horary) tarafından devam edebiliriz; neye bakalım?',
      };
    }
    return {
      ...base,
      reply_mode: 'direct_chat',
      intent: 'open_chat',
      topic_code: null,
      personal_style: null,
      confidence: 0.5,
      direct_reply:
        'Buradayım. Harita, genel bir astroloji sorusu veya kısa bir sohbet; hangisi bugün sana iyi gelir?',
    };
  }
  return {
    ...base,
    reply_mode: 'direct_chat',
    intent: 'fallback',
    topic_code: null,
    personal_style: null,
    confidence: 0.45,
    direct_reply:
      'Buradayım; doğum haritası, kavram veya soru anı haritası için yazabilirsin. Nasıl devam edelim?',
  };
}

function decideFallback(userText, session, profile) {
  const t = String(userText || '').trim();
  if (looksLikeSummarizeRequest(t) && session && session.lastAssistantAnswer) {
    return {
      intent: 'summarize_previous',
      reply_mode: 'summarize_previous',
      confidence: 0.9,
      needs_birth_data: false,
      needs_chart_data: false,
      needs_horary_data: false,
      should_use_last_answer: true,
      topic: 'özet',
      topic_code: null,
      personal_style: null,
      direct_reply: '',
      account_action: null,
      intentSource: 'keyword_summarize',
    };
  }
  const fb = messageClassifier.classifyMessageFallback(userText);
  return classificationToBrain(fb, userText);
}

function buildUserPayload(userText, session, profile, options = {}) {
  const awaitingTopic = options.awaitingTopic === true;
  const profileComplete = options.profileComplete === true;
  const chartSummary =
    briefChartSummary(session.lastChartData) ||
    (profileHasChart(profile) ? briefChartSummary(profile.lastChartData) : null);
  const horarySummary = briefHorarySummary(session.lastHoraryChartData);
  const lastAns = session.lastAssistantAnswer
    ? String(session.lastAssistantAnswer).slice(0, 3500)
    : '';
  const history = Array.isArray(session.conversationHistory) ? session.conversationHistory.slice(-16) : [];

  return JSON.stringify(
    {
      user_message: userText,
      session_step: session.step || null,
      awaiting_topic_choice: awaitingTopic,
      profile_complete: profileComplete,
      has_saved_birth_profile: Boolean(
        profile && profile.birthDate && profile.birthPlace && profile.birthPlace.label
      ),
      has_chart_snapshot: sessionHasChart(session) || profileHasChart(profile),
      chart_summary: chartSummary,
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

  const ctxFlags = {
    hasLastAssistant: Boolean(
      session && session.lastAssistantAnswer && String(session.lastAssistantAnswer).length > 40
    ),
  };

  if (!key) {
    return decideFallback(text, session, profile);
  }

  const client = new Groq({ apiKey: key });
  try {
    const completion = await client.chat.completions.create({
      model: m,
      temperature: 0.35,
      max_tokens: 1100,
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
      return { ...decideFallback(text, session, profile), intentSource: 'groq_invalid_json' };
    }
    parsed._intentSource = 'groq_brain';
    return normalizeBrain(parsed, text, ctxFlags);
  } catch (e) {
    logger.error('[brain] Groq hatası', { message: e.message });
    return { ...decideFallback(text, session, profile), intentSource: 'groq_error', groqErrorMessage: e.message };
  }
}

module.exports = {
  decide,
  decideFallback,
  looksLikeSummarizeRequest,
  briefChartSummary,
  REPLY_MODES,
};
