/**
 * Groq tabanlı konuşma beyni: oturum bağlamı + son yanıt ile açık uçlu niyet.
 * Kişisel harita / horary verisi uydurulmaz; reply_mode yalnızca yönlendirme içindir.
 */

const Groq = require('groq-sdk');
const logger = require('./logger');
const messageClassifier = require('./messageClassifier');

const REPLY_MODES = [
  'direct_answer',
  'general_astro',
  'personal_chart',
  'horary',
  'ask_birth_data',
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

const BRAIN_SYSTEM = `Sen Türkçe konuşan bir Telegram astroloji asistanının "conversation brain" katmanısın.
Görevin: kullanıcı mesajını, oturum özeti ve son bot yanıtını okuyup SADECE tek bir JSON nesnesi döndürmek (markdown yok, açıklama yok).

Şema (zorunlu alanlar):
- intent: kısa iç etiket (örn. greeting, horary_prop, venus_house_7, summarize_request)
- reply_mode: şu sabitlerden biri: ${REPLY_MODES.join(', ')}
- needs_chart_data: boolean — kişisel doğum haritası yorumu için hesaplanmış chartData şart mı?
- needs_horary_data: boolean — horary (soru anı) için soru+zaman+yer verisi şart mı?
- should_use_last_context: boolean — son kullanıcı mesajı / son bot cevabı bu tur için kritik mi?
- topic: kısa Türkçe konu etiketi (birkaç kelime)
- topic_code: null veya "general" | "relationships" | "work_money" | "inner_family" | "communication_learning" (yalnızca personal_chart ve geniş konu başlığı seçilecekse)
- personal_style: null veya "freeform" | "structured" — personal_chart için: freeform = "benim 7. evim", "Venüsüm nerede" gibi spesifik; structured = ilişkiler/kariyer gibi geniş başlık özeti
- user_facing_reply_hint: null veya string — botun kullanıcıya tek mesajla sorabileceği doğal kısa cümle (doğum yeri isteği, netleştirme vb.)

Kurallar:
1) Kesin kader, kesin evlilik/ayrılık/ölüm, tıbbi teşhis, hamilelik kesinliği, yatırım/hukuk sonucu, üçüncü kişinin aldatması gibi taleplerde reply_mode: "safety_redirect" kullan; needs_chart_data false.
2) Horary: soru anı haritası — "olur mu", "alacak mıyım", "döner mi", "bulur muyum", "anlaşma olur mu", "horary yap" vb. Doğum bilgisi İSTEME. reply_mode: "horary". needs_horary_data true.
3) Genel tanım: "7. ev nedir", "Venüs kare Satürn ne demek" → reply_mode: "general_astro". needs_chart_data false.
4) Kişisel harita: "haritama bak", "benim 7. evim", "ilişkim ne olur" (kişisel) → reply_mode: "personal_chart", needs_chart_data true. chart özeti yoksa ask_birth_data düşün.
5) Kullanıcı önceki uzun yanıtı kısaltmak istiyorsa ("kısaca", "anlamadım", "özetle", "sonuç ne", "daha basit") ve oturumda yakın zamanda bir bot yanıtı olduğu varsayılıyorsa → summarize_previous, should_use_last_context true. chart uydurma yok.
6) Selam, hal hatır, kısa sohbet, astro dışı zararsız mesaj → direct_answer; needs_chart_data false. İsteğe bağlı olarak astrolojiye nazikçe bağlanabilir (hint metninde).
7) Günlük transit / anlık gökyüzü isteği: reply_mode "direct_answer", hint ile bu sürümde günlük transit olmadığını kısaca belirt (hesaplama yok).
8) chart_summary içinde chart_mode "partial" ise yükselen/ev yorumu talep etme; kullanıcıya hint ile saat sorulabilir.
9) Belirsiz tek kelime ("ilişki") → personal_chart veya general_astro veya ask_birth_data; en olasıyı seç, user_facing_reply_hint ile tek nazik soru ekle.
10) Yanıtın tek satır JSON olmalı.`;

function looksLikeSummarizeRequest(rawText) {
  const s = String(rawText || '').trim();
  if (s.length > 200) return false;
  return /kısaca|kisaca|özetle|özet|anlamadım|anlamiyorum|tekrar\s*anlat|basitleştir|sadeleştir|daha\s*kısa|daha\s*anlaşılır|sonuç\s*ne|neydi|ne\s*demek\s*istiyorsun|tek\s*cümle|tekrar\s*et|basit\s*anlat/i.test(
    s
  );
}

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

function normalizeBrain(obj, rawUserText, ctx) {
  const text = String(rawUserText || '').trim();
  let reply_mode = String(obj.reply_mode || '').trim();
  if (!REPLY_MODES.includes(reply_mode)) reply_mode = 'direct_answer';

  let topic_code = obj.topic_code;
  if (topic_code != null && !VALID_TOPIC_CODES.has(String(topic_code))) topic_code = null;

  let personal_style = obj.personal_style;
  if (personal_style !== 'freeform' && personal_style !== 'structured') personal_style = null;

  const needs_chart_data = Boolean(obj.needs_chart_data);
  const needs_horary_data = Boolean(obj.needs_horary_data);
  const should_use_last_context = Boolean(obj.should_use_last_context);

  const hint =
    obj.user_facing_reply_hint == null
      ? ''
      : String(obj.user_facing_reply_hint).trim().slice(0, 500);
  const topic = String(obj.topic || '').trim().slice(0, 120);
  const intent = String(obj.intent || '').trim().slice(0, 80) || 'unspecified';

  if (reply_mode === 'summarize_previous' && !ctx.hasLastAssistant) {
    reply_mode = 'direct_answer';
  }

  if (reply_mode === 'personal_chart' && !topic_code) {
    topic_code = 'general';
  }

  return {
    intent,
    reply_mode,
    needs_chart_data,
    needs_horary_data,
    should_use_last_context,
    topic,
    topic_code,
    personal_style,
    user_facing_reply_hint: hint,
    intentSource: obj._intentSource || 'groq_brain',
  };
}

function profileHasChart(profile) {
  return Boolean(profile && profile.lastChartData);
}

function sessionHasChart(session) {
  return Boolean(session && session.lastChartData);
}

function classificationToBrain(cls, userText, session, profile) {
  const cat = cls.category;
  const base = {
    intent: cat,
    needs_chart_data: false,
    needs_horary_data: false,
    should_use_last_context: false,
    topic: String(cls.topicLabel || '').trim().slice(0, 120),
    topic_code: cls.topicCode || null,
    personal_style: cls.personalKind || null,
    user_facing_reply_hint: '',
    intentSource: 'classifier_fallback',
  };

  if (cat === 'horary_question') {
    return {
      ...base,
      reply_mode: 'horary',
      needs_horary_data: true,
      intent: 'horary',
    };
  }
  if (cat === 'risky_question') {
    return {
      ...base,
      reply_mode: 'safety_redirect',
      intent: 'risky',
    };
  }
  if (cat === 'general_astro_knowledge') {
    return {
      ...base,
      reply_mode: 'general_astro',
      intent: 'general_astro',
      topic_code: null,
      personal_style: null,
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
    };
  }
  if (cat === 'unclear_message') {
    const t = String(userText || '').trim();
    if (t.length <= 24 && /^(selam|merhaba|hey|hi|slm|günaydın|iyi\s*akşamlar|naber)/i.test(t)) {
      return {
        ...base,
        reply_mode: 'direct_answer',
        intent: 'greeting',
        topic_code: null,
        personal_style: null,
        user_facing_reply_hint:
          'Kullanıcıya kısa merhaba de; astroloji konusunda nasıl yardımcı olabileceğini bir cümleyle sor.',
      };
    }
    return {
      ...base,
      reply_mode: 'direct_answer',
      intent: 'unclear',
      topic_code: null,
      personal_style: null,
      user_facing_reply_hint:
        'Kullanıcıya nazikçe neye baktırmak istediğini (harita, kavram, soru anı) bir cümleyle sor.',
    };
  }
  return {
    ...base,
    reply_mode: 'direct_answer',
    intent: 'fallback',
    topic_code: null,
    personal_style: null,
  };
}

function decideFallback(userText, session, profile) {
  const t = String(userText || '').trim();
  if (looksLikeSummarizeRequest(t) && session && session.lastAssistantAnswer) {
    return {
      intent: 'summarize_previous',
      reply_mode: 'summarize_previous',
      needs_chart_data: false,
      needs_horary_data: false,
      should_use_last_context: true,
      topic: 'özet',
      topic_code: null,
      personal_style: null,
      user_facing_reply_hint: '',
      intentSource: 'keyword_summarize',
    };
  }
  const fb = messageClassifier.classifyMessageFallback(userText);
  return classificationToBrain(fb, userText, session, profile);
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
      last_user_message: session.lastUserMessage ? String(session.lastUserMessage).slice(0, 600) : null,
      last_intent: session.lastIntent,
      last_reply_mode: session.lastReplyMode,
      last_assistant_answer_excerpt: lastAns
        ? `${lastAns.slice(0, 2800)}${lastAns.length > 2800 ? '\n…(devamı kesildi)' : ''}`
        : null,
    },
    null,
    0
  );
}

async function decide(userText, session, profile, apiKey, model, options = {}) {
  const text = String(userText || '').trim();
  const key = String(apiKey || '').trim();
  const m = String(model || 'llama-3.3-70b-versatile').trim();

  const ctxFlags = {
    hasLastAssistant: Boolean(session && session.lastAssistantAnswer && String(session.lastAssistantAnswer).length > 40),
  };

  if (looksLikeSummarizeRequest(text) && ctxFlags.hasLastAssistant) {
    const quick = {
      intent: 'summarize_previous',
      reply_mode: 'summarize_previous',
      needs_chart_data: false,
      needs_horary_data: false,
      should_use_last_context: true,
      topic: 'özet',
      topic_code: null,
      personal_style: null,
      user_facing_reply_hint: '',
      intentSource: 'keyword_summarize',
    };
    return quick;
  }

  if (!key) {
    return decideFallback(text, session, profile);
  }

  const client = new Groq({ apiKey: key });
  try {
    const completion = await client.chat.completions.create({
      model: m,
      temperature: 0.15,
      max_tokens: 450,
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
