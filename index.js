const { loadEnv } = require('./config/env');
const env = loadEnv();

const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const logger = require('./services/logger');
const sessionStore = require('./services/sessionStore');
const userProfileStore = require('./services/userProfileStore');
const chartCalculator = require('./services/chartCalculator');
const interpretationService = require('./services/interpretationService');
const { sanitizeAiOutputOrThrow } = require('./services/sanitizeTurkishText');
const astroKnowledgeService = require('./services/astroKnowledgeService');
const horaryService = require('./services/horaryService');
const horaryRules = require('./services/horaryRules');
const conversationBrain = require('./services/conversationBrain');

const USER_SOFT_ERROR =
  'Şu an yorum hazırlanırken küçük bir sorun oluştu. Lütfen biraz sonra tekrar dene.';

const MSG_SANITIZE_FAIL =
  'Yanıt hazırlanırken metin formatında küçük bir sorun oluştu. Lütfen tekrar dener misin?';

const MSG_UNSUPPORTED =
  'Transitler, günlük gökyüzü ve anlık gezegen konumları bu sürümde yok. Doğum haritan veya genel astroloji kavramlarında yardımcı olabilirim.';

const MSG_HORARY_RESTRICTED =
  'Bu konuda kesin hüküm vermem doğru olmaz. Horary’yi daha güvenli şekilde durumun dinamiğini, iletişimi veya karar sürecini anlamak için kullanabiliriz.';

const MSG_HORARY_NEED_QUESTION =
  'Horary için net bir soru yazman gerekiyor. Örneğin: “Bu ilişki olur mu?” veya “İşimde terfi alacak mıyım?” — doğum bilgisi istemiyorum.';

const MSG_HORARY_ASK_PLACE =
  'Bu soru için horary haritası çıkarabilmem adına bulunduğun şehri ve ülkeyi yazar mısın? Örn: Bursa, Türkiye';

const MSG_RISKY_BOUNDARY =
  'Bu tarz konularda kesin hüküm veya kader dili kullanmıyorum. Astroloji burada farkındalık ve simgesel düşünce içindir; sağlık, hukuk ve finans için uzmanlara danışmalısın. İstersen genel bir kavramı sorabilir veya doğum bilgilerinle haritandan devam edebilirsin.';

const MSG_BIRTH_TIME_FAQ =
  'Saati bilmiyorsan sorun değil: haritayı kısmi modda hesaplarım (yükselen ve ev yerleşimleri olmadan). Tarih ve yer net olsa bile Güneş, Ay ve gezegen burçlarına göre kişisel bir özet çıkarabilirim. Saat sorduğumda “bilmiyorum” yazman yeterli.';

const MSG_SAVED_PROFILE_HINT =
  'Harita bilgilerin kayıtlı. Bu soruya kayıtlı doğum bilgilerine göre yanıt veriyorum.';

const MSG_INTENT_GROQ_FALLBACK =
  'Niyetini çözerken kısa bir bağlantı sorunu oldu; mesajına yine de yanıt vermeye çalışıyorum.';


const GEOCODE_UA =
  env.GEOCODE_USER_AGENT || 'TelegramAstroMVP/1.0 (https://github.com/)';

const HELP_SNIPPET = [
  'Örnekler:',
  '— “Doğum haritama bak” veya “İlişki hayatım nasıl?”',
  '— “Kariyerimde ne öne çıkıyor?”',
  '— “7. ev nedir?” veya “Venüs kare Satürn nedir?”',
  '— Horary (soru anı): “Bu ilişki olur mu?” + konum',
  '',
  'Komutlar: /help (tümü), /profile, /update_birth, /reset',
].join('\n');

const START_INTRO = [
  'Merhaba, ben kişisel astroloji asistanın.',
  'Bana doğum haritanı yorumlatabilir, haritan üzerinden ilişki veya kariyer gibi konular sorabilir ya da astrolojik kavramları öğrenebilirsin.',
  '',
  'Ne öğrenmek veya keşfetmek istersin?',
  '',
  HELP_SNIPPET,
].join('\n');

const app = express();

app.get('/', (req, res) => {
  res.type('text/plain').send('Astrology bot is running');
});

app.get('/health', (req, res) => {
  res.type('text/plain').send('Astrology bot is running');
});

const bot = new Telegraf(env.BOT_TOKEN);

bot.catch((err, ctx) => {
  logger.error('Telegram bot hatası (bot.catch)', err);
  if (ctx && typeof ctx.reply === 'function') {
    ctx.reply(USER_SOFT_ERROR).catch((e) => {
      logger.error('Kullanıcıya hata mesajı gönderilemedi', e);
    });
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
});

/** İsteğe bağlı: sadece /help ile gösterilir; ana akışta zorunlu değil. */
const topicKeyboard = Markup.keyboard([
  ['Genel özet'],
  ['İlişkiler'],
  ['İş / para / değerler'],
  ['İç dünya / duygular / aile'],
  ['İletişim / öğrenme / ifade'],
])
  .oneTime()
  .resize();

function cloneJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function stripInterpretationFromChart(chartData) {
  const c = cloneJson(chartData);
  if (c && typeof c === 'object') delete c.interpretation_request;
  return c;
}

function mergeConversationHistory(cur, userText, assistantText) {
  const hist = Array.isArray(cur.conversationHistory) ? [...cur.conversationHistory] : [];
  const u = String(userText || '').trim().slice(0, 3000);
  const a = String(assistantText || '').trim().slice(0, 12000);
  if (u) hist.push({ role: 'user', text: u });
  if (a) hist.push({ role: 'assistant', text: a });
  while (hist.length > 20) hist.splice(0, hist.length - 20);
  return hist;
}

function afterConversationReply(uid, userText, assistantText, meta = {}) {
  const cur = sessionStore.get(uid);
  const hist = mergeConversationHistory(cur, userText, assistantText);
  const patch = {
    lastUserMessage: String(userText || '').slice(0, 4000),
    lastAssistantAnswer: String(assistantText || '').slice(0, 12000),
    lastIntent: meta.intent != null ? String(meta.intent).slice(0, 120) : cur.lastIntent,
    lastReplyMode: meta.replyMode != null ? String(meta.replyMode).slice(0, 80) : cur.lastReplyMode,
    conversationHistory: hist,
  };
  if (meta.lastChartData !== undefined) patch.lastChartData = meta.lastChartData;
  if (meta.lastHoraryChartData !== undefined) patch.lastHoraryChartData = meta.lastHoraryChartData;
  sessionStore.set(uid, { ...cur, ...patch });
}

function buildBrainContextSummary(uid, s, prof) {
  const lines = [];
  lines.push(
    userProfileStore.isProfileComplete(prof)
      ? 'Kayıtlı doğum profili tam.'
      : 'Kayıtlı doğum profili yok veya eksik.'
  );
  if (s.lastReplyMode) lines.push(`Son yanıt modu: ${s.lastReplyMode}.`);
  if (s.lastIntent) lines.push(`Son niyet etiketi: ${s.lastIntent}.`);
  return lines.join(' ');
}

function persistProfileFromSession(uid, s, chartData) {
  if (!s.birthYmd || s.latitude == null || s.longitude == null) return;
  userProfileStore.updateProfile(uid, {
    birthDate: { ...s.birthYmd },
    birthDateText: s.birthDateText || '',
    birthPlace: {
      label: s.placeLabel || '',
      latitude: s.latitude,
      longitude: s.longitude,
      searchText: (s.placeText || s.placeLabel || '').trim(),
    },
    birthTime:
      s.hasKnownBirthTime && s.birthHour != null
        ? { hour: s.birthHour, minute: s.birthMinute }
        : null,
    birthTimeKnown: Boolean(s.hasKnownBirthTime),
    chartMode: chartData.chart_mode === 'full' ? 'full' : 'partial',
    lastChartData: stripInterpretationFromChart(chartData),
  });
}

function sessionFieldsFromProfile(prof) {
  const hasT = prof.birthTimeKnown && prof.birthTime;
  return {
    birthYmd: { ...prof.birthDate },
    birthDateText: prof.birthDateText || '',
    placeText: prof.birthPlace.searchText || prof.birthPlace.label,
    placeLabel: prof.birthPlace.label,
    latitude: prof.birthPlace.latitude,
    longitude: prof.birthPlace.longitude,
    birthHour: hasT ? prof.birthTime.hour : 12,
    birthMinute: hasT ? prof.birthTime.minute : 0,
    hasKnownBirthTime: prof.birthTimeKnown,
    birthTimeText: hasT
      ? `${String(prof.birthTime.hour).padStart(2, '0')}:${String(prof.birthTime.minute).padStart(2, '0')}`
      : 'bilmiyorum',
  };
}

function chartFromUserProfile(prof) {
  return chartCalculator.calculateChart({
    year: prof.birthDate.year,
    month: prof.birthDate.month,
    day: prof.birthDate.day,
    hour: prof.birthTimeKnown && prof.birthTime ? prof.birthTime.hour : 12,
    minute: prof.birthTimeKnown && prof.birthTime ? prof.birthTime.minute : 0,
    latitude: prof.birthPlace.latitude,
    longitude: prof.birthPlace.longitude,
    hasKnownBirthTime: prof.birthTimeKnown,
    placeLabel: prof.birthPlace.label,
  });
}

/**
 * Oturumda harita yoksa profilden yükle veya doğum alanlarından yeniden hesapla.
 * @returns {{ chart: object|null, usedSavedProfile: boolean }}
 */
function resolveChartForUser(uid, session) {
  if (session.lastChartData) {
    return { chart: stripInterpretationFromChart(cloneJson(session.lastChartData)), usedSavedProfile: false };
  }
  const prof = userProfileStore.getProfile(uid);
  if (prof && prof.lastChartData) {
    return { chart: stripInterpretationFromChart(cloneJson(prof.lastChartData)), usedSavedProfile: true };
  }
  if (userProfileStore.isProfileComplete(prof)) {
    let chart;
    try {
      chart = chartFromUserProfile(prof);
    } catch {
      return { chart: null, usedSavedProfile: false };
    }
    if (!chart.planets || chart.planets.length < 10) {
      return { chart: null, usedSavedProfile: false };
    }
    userProfileStore.updateProfile(uid, {
      lastChartData: stripInterpretationFromChart(chart),
      chartMode: chart.chart_mode === 'full' ? 'full' : 'partial',
    });
    return { chart: stripInterpretationFromChart(chart), usedSavedProfile: true };
  }
  return { chart: null, usedSavedProfile: false };
}

function isSanitizeDegradedError(e) {
  return Boolean(e && (e.code === 'SANITIZE_DEGRADED' || e.message === 'SANITIZE_DEGRADED'));
}

function chunkTelegram(text, maxLen = 4000) {
  const t = String(text || '');
  if (t.length <= maxLen) return [t];
  const parts = [];
  let rest = t;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < Math.floor(maxLen * 0.4)) cut = maxLen;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function geocodePlace(query) {
  const q = (query || '').trim();
  if (q.length < 2) {
    return { ok: false, error: 'Yeri biraz daha net yazar mısın? (örn: İzmir, Türkiye)' };
  }
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  const res = await fetch(url, { headers: { 'User-Agent': GEOCODE_UA } });
  if (!res.ok) {
    return { ok: false, error: 'Konum servisi şu an cevap vermedi. Biraz sonra tekrar dene.' };
  }
  const arr = await res.json();
  const first = arr[0];
  if (!first) {
    return {
      ok: false,
      error: 'Yeri bulamadım. Şehir ve ülke ile tekrar yazar mısın? (örn: Ankara, Turkey)',
    };
  }
  return {
    ok: true,
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    label: first.display_name || q,
  };
}

/** Menü 1–4 eşlemesi; eşleşmezse { ok: false } */
function parseMainIntent(text) {
  const raw = (text || '').trim();
  const m = raw.match(/^([1-4])\b/);
  if (m) return { ok: true, n: Number(m[1]) };

  const low = raw.toLowerCase();
  if (/doğum haritamı yorumla|haritamı yorumla|kişisel harita yorum/.test(low)) {
    return { ok: true, n: 1 };
  }
  if (/haritam üzerinden|bir konu soracağım|konuyu seçip harita/.test(low)) {
    return { ok: true, n: 2 };
  }
  if (/kavramı öğren|astrolojik bir kavram|terim.*merak/.test(low)) {
    return { ok: true, n: 3 };
  }

  return { ok: false };
}

function parseTopicCode(text) {
  const raw = (text || '').trim();
  const digit = raw.match(/^([1-5])\b/);
  if (digit) {
    const map = {
      1: 'general',
      2: 'relationships',
      3: 'work_money',
      4: 'inner_family',
      5: 'communication_learning',
    };
    return { ok: true, code: map[digit[1]] };
  }
  const low = raw.toLocaleLowerCase('tr-TR');
  if (low.includes('genel')) return { ok: true, code: 'general' };
  if (low.includes('ilişki')) return { ok: true, code: 'relationships' };
  if (low.includes('para') || low.includes('değer') || /\biş\b/.test(low) || low.includes('kariyer'))
    return { ok: true, code: 'work_money' };
  if (low.includes('iç dünya') || low.includes('duygu') || low.includes('aile'))
    return { ok: true, code: 'inner_family' };
  if (low.includes('iletişim') || low.includes('öğrenme') || low.includes('ifade'))
    return { ok: true, code: 'communication_learning' };
  return {
    ok: false,
    error:
      'Tam eşleşmedi. Örneğin “genel özet”, “ilişkiler”, “iş ve para”, “iç dünya” veya “iletişim” yazabilirsin; istersen rakamla 1–5 de olur. Başka bir soru soracaksan doğrudan yazman da yeterli.',
  };
}

async function handleTopicPresetMessage(ctx, uid, s, text) {
  const tp = parseTopicCode(text);
  if (!tp.ok) {
    await ctx.reply(tp.error, Markup.removeKeyboard());
    return;
  }
  const prof = userProfileStore.getProfile(uid);
  if (userProfileStore.isProfileComplete(prof)) {
    const hydrated = {
      ...sessionStore.get(uid),
      ...sessionFieldsFromProfile(prof),
      topicCodePreset: tp.code,
      pendingFreeformPersonal: null,
    };
    logger.info(`Ön seçilen konu topic=${tp.code} kayıtlı profil user_id=${uid}`);
    await ctx.reply(
      ['Kayıtlı doğum bilgilerinle haritayı hazırlıyorum…', 'Biraz bekle.'].join('\n'),
      Markup.removeKeyboard()
    );
    await deliverChartReading(ctx, uid, hydrated, tp.code, text);
    return;
  }
  sessionStore.set(uid, {
    ...s,
    step: 'await_date',
    topicCodePreset: tp.code,
    pendingFreeformPersonal: null,
  });
  logger.info(`Ön seçilen konu topic=${tp.code} user_id=${uid}`);
  await ctx.reply(
    'Anlaşıldı. Şimdi doğum tarihini yazar mısın? (örn: 1998-07-07 veya 7.7.1998)',
    Markup.removeKeyboard()
  );
}

async function deliverChartReading(ctx, uid, s, topicCode, userMessageForContext = '') {
  await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

  let chartData;
  try {
    logger.info(`Harita hesaplama başladı user_id=${uid}`);
    chartData = chartCalculator.calculateChart({
      year: s.birthYmd.year,
      month: s.birthYmd.month,
      day: s.birthYmd.day,
      hour: s.birthHour,
      minute: s.birthMinute,
      latitude: s.latitude,
      longitude: s.longitude,
      hasKnownBirthTime: s.hasKnownBirthTime,
      placeLabel: s.placeLabel,
    });
    logger.info(`Harita hesaplama bitti user_id=${uid}`);
  } catch (e) {
    logger.error(`Harita hesaplama hatası user_id=${uid}`, e);
    await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
    sessionStore.reset(uid);
    return;
  }

  if (!chartData.planets || chartData.planets.length < 10) {
    logger.warn(`Harita verisi eksik user_id=${uid}`);
    await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
    sessionStore.reset(uid);
    return;
  }

  chartData.interpretation_request = {
    topic_code: topicCode,
    locale: 'tr',
  };

  let interpretation;
  try {
    interpretation = await interpretationService.generateInterpretation(
      chartData,
      env.GROQ_API_KEY,
      env.GROQ_MODEL
    );
  } catch (e) {
    if (isSanitizeDegradedError(e)) {
      logger.warn(`Groq harita yorumu sanitize user_id=${uid}`);
      await ctx.reply(MSG_SANITIZE_FAIL, Markup.removeKeyboard());
      return;
    }
    logger.error(`Groq harita yorumu user_id=${uid}`, e);
    await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
    sessionStore.reset(uid);
    return;
  }

  const parts = chunkTelegram(interpretation);
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) await ctx.reply(parts[i], Markup.removeKeyboard());
    else await ctx.reply(parts[i]);
  }

  persistProfileFromSession(uid, s, chartData);
  sessionStore.prepareForNextChat(uid, chartData);
  afterConversationReply(uid, userMessageForContext, interpretation, {
    intent: `natal_${topicCode}`,
    replyMode: 'personal_chart',
  });
  await ctx.reply('Başka bir sorun olursa yazabilirsin.', Markup.removeKeyboard());
}

async function deliverChartReadingFreeform(ctx, uid, s) {
  await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

  let chartData;
  try {
    logger.info(`Harita hesaplama başladı (serbest soru) user_id=${uid}`);
    chartData = chartCalculator.calculateChart({
      year: s.birthYmd.year,
      month: s.birthYmd.month,
      day: s.birthYmd.day,
      hour: s.birthHour,
      minute: s.birthMinute,
      latitude: s.latitude,
      longitude: s.longitude,
      hasKnownBirthTime: s.hasKnownBirthTime,
      placeLabel: s.placeLabel,
    });
    logger.info(`Harita hesaplama bitti (serbest soru) user_id=${uid}`);
  } catch (e) {
    logger.error(`Harita hesaplama hatası (serbest) user_id=${uid}`, e);
    await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
    sessionStore.reset(uid);
    return;
  }

  if (!chartData.planets || chartData.planets.length < 10) {
    logger.warn(`Harita verisi eksik (serbest) user_id=${uid}`);
    await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
    sessionStore.reset(uid);
    return;
  }

  const q = s.pendingFreeformPersonal || '';
  let interpretation;
  try {
    interpretation = await interpretationService.answerPersonalQuestion(
      chartData,
      q,
      env.GROQ_API_KEY,
      env.GROQ_MODEL
    );
  } catch (e) {
    if (isSanitizeDegradedError(e)) {
      logger.warn(`Groq kişisel soru (serbest) sanitize user_id=${uid}`);
      await ctx.reply(MSG_SANITIZE_FAIL, Markup.removeKeyboard());
      return;
    }
    logger.error(`Groq kişisel soru user_id=${uid}`, e);
    await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
    sessionStore.reset(uid);
    return;
  }

  const parts = chunkTelegram(interpretation);
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) await ctx.reply(parts[i], Markup.removeKeyboard());
    else await ctx.reply(parts[i]);
  }

  persistProfileFromSession(uid, s, chartData);
  sessionStore.prepareForNextChat(uid, chartData);
  const ctxMsg = (s.pendingFreeformPersonal || '').trim() || 'Serbest soru';
  afterConversationReply(uid, ctxMsg, interpretation, {
    intent: 'natal_freeform',
    replyMode: 'personal_chart',
  });
  await ctx.reply('Başka bir sorun olursa yazabilirsin.', Markup.removeKeyboard());
}

async function routeHoraryQuestion(ctx, uid, text, kb, opener) {
  const o = String(opener || '').trim();
  if (o.length > 3) {
    try {
      await ctx.reply(sanitizeAiOutputOrThrow(o, 'horary_opener'), kb);
    } catch {
      /* opener opsiyonel */
    }
  }
  if (horaryRules.isHoraryRestricted(text)) {
    await ctx.reply(MSG_HORARY_RESTRICTED, kb);
    afterConversationReply(uid, text, MSG_HORARY_RESTRICTED, {
      intent: 'horary_restricted',
      replyMode: 'safety_redirect',
    });
    return;
  }
  const receivedUnix = ctx.message?.date || Math.floor(Date.now() / 1000);
  if (horaryRules.isHoraryKeywordOnlyMessage(text)) {
    sessionStore.set(uid, {
      ...sessionStore.get(uid),
      step: 'await_horary_question',
      horaryQuestionText: null,
      horaryReceivedUnix: null,
    });
    logger.info(`Horary: soru bekleniyor user_id=${uid}`);
    await ctx.reply(MSG_HORARY_NEED_QUESTION, kb);
    return;
  }
  sessionStore.set(uid, {
    ...sessionStore.get(uid),
    step: 'await_horary_place',
    horaryQuestionText: text.trim(),
    horaryReceivedUnix: receivedUnix,
  });
  logger.info(`Horary: konum bekleniyor user_id=${uid}`);
  await ctx.reply(MSG_HORARY_ASK_PLACE, kb);
}

async function tryCollectorBrainReply(ctx, uid, s, text, kb) {
  const prof = userProfileStore.getProfile(uid);
  let brain;
  try {
    brain = await conversationBrain.decide(text, s, prof, env.GROQ_API_KEY, env.GROQ_MODEL, {
      profileComplete: userProfileStore.isProfileComplete(prof),
    });
  } catch (e) {
    logger.error(`collectorBrain user_id=${uid}`, e);
    brain = conversationBrain.decideFallback(text, s, prof);
  }
  const dr = brain.direct_reply && brain.direct_reply.trim();
  if (dr && dr.length > 4) {
    try {
      const out = sanitizeAiOutputOrThrow(dr, 'collector_brain');
      await ctx.reply(out, kb);
      afterConversationReply(uid, text, out, { intent: brain.intent, replyMode: 'direct_chat' });
      return;
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        await ctx.reply(MSG_SANITIZE_FAIL, kb);
        return;
      }
    }
  }
  try {
    const out = await interpretationService.generateDirectChatReply(text, env.GROQ_API_KEY, env.GROQ_MODEL, {
      hint: `Oturum adımı: ${s.step}. Nazikçe tek soru veya kısa örnek ver; "anlamadım" deme.`,
      contextSummary: `Adım: ${s.step}.`,
    });
    for (const part of chunkTelegram(out)) {
      await ctx.reply(part, kb);
    }
    afterConversationReply(uid, text, out, { intent: 'collector', replyMode: 'direct_chat' });
  } catch {
    const hint =
      s.step === 'await_date'
        ? 'Doğum tarihini örneğin 1998-07-07 veya 7.7.1998 gibi yazabilirsin.'
        : s.step === 'await_place'
          ? 'Doğduğun yeri şehir ve ülke ile (örn. Bursa, Türkiye) yazabilir misin?'
          : 'Saati 09:15 gibi yazabilir veya bilinmiyorsa sadece "bilmiyorum" yazman yeterli.';
    await ctx.reply(['Bu adımda kısa bir bilgi rica edeceğim.', hint].join('\n'), kb);
  }
}

async function runIntentClassificationFlow(ctx, uid, s, text, options = {}) {
  const kb = Markup.removeKeyboard();
  const prof = userProfileStore.getProfile(uid);
  const profileComplete = userProfileStore.isProfileComplete(prof);

  let brain;
  try {
    brain = await conversationBrain.decide(text, s, prof, env.GROQ_API_KEY, env.GROQ_MODEL, {
      awaitingTopic: false,
      profileComplete,
    });
  } catch (e) {
    logger.error(`conversationBrain user_id=${uid}`, e);
    brain = conversationBrain.decideFallback(text, s, prof);
  }

  logger.info(
    `Brain user_id=${uid} reply_mode=${brain.reply_mode} intent=${brain.intent} source=${brain.intentSource}`
  );

  if (brain.intentSource === 'groq_error') {
    await ctx.reply(MSG_INTENT_GROQ_FALLBACK, kb);
  }

  if (brain.account_action === 'reset_profile') {
    userProfileStore.deleteProfile(uid);
    sessionStore.reset(uid);
    sessionStore.set(uid, { step: 'await_intent', conversationHistory: [] });
    let ack = 'Kayıtlı doğum profilin silindi. İstersen doğum bilgisiyle yeniden başlayabilirsin.';
    if (brain.direct_reply && brain.direct_reply.trim().length > 8) {
      try {
        ack = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'reset_ack');
      } catch {
        /* keep default ack */
      }
    }
    await ctx.reply(ack, kb);
    afterConversationReply(uid, text, ack, { intent: 'reset', replyMode: 'direct_chat' });
    await ctx.reply(START_INTRO, kb);
    return;
  }

  if (brain.account_action === 'update_birth') {
    sessionStore.set(uid, {
      ...sessionStore.defaultSession(),
      step: 'await_date',
      intent: 'update_birth',
      pendingTopicCode: null,
    });
    let ack = 'Tamam. Yeni doğum tarihini yazar mısın? (örn: 1998-07-07 veya 7.7.1998)';
    if (brain.direct_reply && brain.direct_reply.trim().length > 10) {
      try {
        ack = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'update_birth_ack');
      } catch {
        /* default */
      }
    }
    await ctx.reply(ack, kb);
    afterConversationReply(uid, text, ack, { intent: 'update_birth', replyMode: 'direct_chat' });
    return;
  }

  const standardTopicCodes = new Set([
    'general',
    'relationships',
    'work_money',
    'inner_family',
    'communication_learning',
  ]);

  if (brain.reply_mode === 'safety_redirect') {
    let out = MSG_RISKY_BOUNDARY;
    if (brain.direct_reply && brain.direct_reply.trim().length > 35) {
      try {
        out = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'safety_brain');
      } catch {
        out = MSG_RISKY_BOUNDARY;
      }
    }
    await ctx.reply(out, kb);
    afterConversationReply(uid, text, out, { intent: brain.intent || 'safety', replyMode: 'safety_redirect' });
    return;
  }

  if (brain.reply_mode === 'summarize_previous') {
    const last = sessionStore.get(uid).lastAssistantAnswer;
    if (!last || String(last).trim().length < 40) {
      let soft =
        'Az önce uzun bir yanıt göremedim; neye odaklanmamı istersin, bir cümleyle yazabilir misin?';
      if (brain.direct_reply && brain.direct_reply.trim().length > 10) {
        try {
          soft = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'summarize_soft');
        } catch {
          /* default soft */
        }
      }
      await ctx.reply(soft, kb);
      afterConversationReply(uid, text, soft, { intent: 'summarize', replyMode: 'direct_chat' });
      return;
    }
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    try {
      const sum = await interpretationService.summarizePreviousAnswer(
        last,
        text,
        env.GROQ_API_KEY,
        env.GROQ_MODEL
      );
      for (const part of chunkTelegram(sum)) {
        await ctx.reply(part, kb);
      }
      afterConversationReply(uid, text, sum, { intent: 'summarize_previous', replyMode: 'summarize_previous' });
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        await ctx.reply(MSG_SANITIZE_FAIL, kb);
        return;
      }
      logger.error(`Özetleme Groq user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR, kb);
    }
    return;
  }

  if (brain.reply_mode === 'direct_chat') {
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    if (brain.direct_reply && brain.direct_reply.trim().length > 3) {
      try {
        const out = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'brain_direct_chat');
        for (const part of chunkTelegram(out)) {
          await ctx.reply(part, kb);
        }
        afterConversationReply(uid, text, out, { intent: brain.intent || 'chat', replyMode: 'direct_chat' });
        return;
      } catch (e) {
        if (isSanitizeDegradedError(e)) {
          await ctx.reply(MSG_SANITIZE_FAIL, kb);
          return;
        }
      }
    }
    try {
      const ctxSum = buildBrainContextSummary(uid, s, prof);
      const out = await interpretationService.generateDirectChatReply(text, env.GROQ_API_KEY, env.GROQ_MODEL, {
        hint: brain.direct_reply?.trim() || '',
        contextSummary: ctxSum,
      });
      for (const part of chunkTelegram(out)) {
        await ctx.reply(part, kb);
      }
      afterConversationReply(uid, text, out, { intent: brain.intent || 'chat', replyMode: 'direct_chat' });
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        await ctx.reply(MSG_SANITIZE_FAIL, kb);
        return;
      }
      logger.error(`Doğal sohbet Groq user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR, kb);
    }
    return;
  }

  if (brain.reply_mode === 'horary') {
    await routeHoraryQuestion(ctx, uid, text, kb, brain.direct_reply);
    return;
  }

  if (brain.reply_mode === 'general_astro') {
    if (brain.intent === 'birth_time_faq') {
      await ctx.reply(MSG_BIRTH_TIME_FAQ, kb);
      afterConversationReply(uid, text, MSG_BIRTH_TIME_FAQ, {
        intent: 'birth_time_faq',
        replyMode: 'general_astro',
      });
      return;
    }
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    try {
      const body = await astroKnowledgeService.answerGeneralConcept(text, env.GROQ_API_KEY, env.GROQ_MODEL);
      const rawCombo =
        (brain.direct_reply && brain.direct_reply.trim().length > 5
          ? `${brain.direct_reply.trim()}\n\n`
          : '') + body;
      const combo = sanitizeAiOutputOrThrow(rawCombo, 'general_astro_combo');
      for (const part of chunkTelegram(combo)) {
        await ctx.reply(part, kb);
      }
      afterConversationReply(uid, text, combo, {
        intent: brain.intent || 'general_astro',
        replyMode: 'general_astro',
      });
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        logger.warn(`Genel sohbet sanitize user_id=${uid}`);
        await ctx.reply(MSG_SANITIZE_FAIL, kb);
        return;
      }
      logger.error(`Genel sohbet Groq user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR, kb);
    }
    return;
  }

  if (brain.reply_mode === 'ask_birth_data') {
    const tpc = brain.topic_code && standardTopicCodes.has(brain.topic_code) ? brain.topic_code : null;
    let hintMsg =
      'Kişisel haritana bakabilmem için doğum tarihini paylaşır mısın? (örn: 1998-07-07 veya 7.7.1998)';
    if (brain.direct_reply && brain.direct_reply.trim().length > 8) {
      try {
        hintMsg = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'ask_birth');
      } catch {
        /* default */
      }
    }
    sessionStore.set(uid, {
      ...sessionStore.defaultSession(),
      step: 'await_date',
      intent: tpc ? 'chart_natural' : 'chart',
      pendingTopicCode: tpc,
      pendingFreeformPersonal: null,
      topicCodePreset: null,
    });
    await ctx.reply(hintMsg, kb);
    afterConversationReply(uid, text, hintMsg, { intent: brain.intent || 'ask_birth', replyMode: 'ask_birth_data' });
    return;
  }

  if (brain.reply_mode === 'personal_chart') {
    const topicCode =
      brain.topic_code && standardTopicCodes.has(brain.topic_code) ? brain.topic_code : 'general';
    const freeform = brain.personal_style === 'freeform';

    if (freeform) {
      const resolved = resolveChartForUser(uid, s);
      if (resolved.chart) {
        if (resolved.usedSavedProfile) {
          await ctx.reply(MSG_SAVED_PROFILE_HINT, kb);
        }
        sessionStore.set(uid, { ...sessionStore.get(uid), lastChartData: resolved.chart });
        const ack = brain.direct_reply?.trim();
        if (ack && ack.length > 3) {
          try {
            await ctx.reply(sanitizeAiOutputOrThrow(ack, 'personal_ack'), kb);
          } catch {
            /* yok */
          }
        }
        await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
        try {
          const ans = await interpretationService.answerPersonalQuestion(
            resolved.chart,
            text,
            env.GROQ_API_KEY,
            env.GROQ_MODEL
          );
          for (const part of chunkTelegram(ans)) {
            await ctx.reply(part, kb);
          }
          afterConversationReply(uid, text, ans, {
            intent: brain.intent || 'personal_freeform',
            replyMode: 'personal_chart',
          });
        } catch (e) {
          if (isSanitizeDegradedError(e)) {
            logger.warn(`Kişisel yorum sanitize user_id=${uid}`);
            await ctx.reply(MSG_SANITIZE_FAIL, kb);
            return;
          }
          logger.error(`Kişisel yorum hatası user_id=${uid}`, e);
          await ctx.reply(USER_SOFT_ERROR, kb);
        }
        return;
      }
      sessionStore.set(uid, {
        ...sessionStore.get(uid),
        step: 'await_date',
        intent: 'freeform_personal',
        pendingFreeformPersonal: text,
        pendingTopicCode: null,
        topicCodePreset: null,
        lastChartData: null,
        birthYmd: null,
        birthDateText: null,
        placeText: null,
        placeLabel: null,
        latitude: null,
        longitude: null,
        birthTimeText: null,
        birthHour: null,
        birthMinute: null,
        hasKnownBirthTime: null,
      });
      logger.info(`Kişisel (serbest) -> doğum toplama user_id=${uid}`);
      let askFree =
        'Bunu kişisel haritanda görmek için önce doğum tarihini paylaşır mısın? (örn: 1998-07-07 veya 7.7.1998)';
      if (brain.direct_reply && brain.direct_reply.trim().length > 12) {
        try {
          askFree = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'ask_freeform');
        } catch {
          /* default */
        }
      }
      await ctx.reply(askFree, kb);
      afterConversationReply(uid, text, askFree, { intent: 'ask_birth', replyMode: 'ask_birth_data' });
      return;
    }

    const prof2 = userProfileStore.getProfile(uid);
    if (userProfileStore.isProfileComplete(prof2)) {
      const merged = {
        ...sessionStore.defaultSession(),
        ...sessionFieldsFromProfile(prof2),
        lastChartData: prof2.lastChartData ? cloneJson(prof2.lastChartData) : null,
        step: 'await_intent',
      };
      logger.info(`Doğal dil -> konu yorumu topic=${topicCode} profil var user_id=${uid}`);
      const ack = brain.direct_reply?.trim();
      if (ack && ack.length > 3) {
        try {
          await ctx.reply(sanitizeAiOutputOrThrow(ack, 'topic_prep'), kb);
        } catch {
          await ctx.reply('Kayıtlı bilgilerinle haritana bakıyorum…', kb);
        }
      } else {
        await ctx.reply('Kayıtlı bilgilerinle haritana bakıyorum…', kb);
      }
      await deliverChartReading(ctx, uid, merged, topicCode, text);
      return;
    }

    sessionStore.set(uid, {
      ...sessionStore.defaultSession(),
      step: 'await_date',
      intent: 'chart_natural',
      pendingTopicCode: topicCode,
      pendingFreeformPersonal: null,
      topicCodePreset: null,
    });
    logger.info(`Doğal dil -> konu yorumu topic=${topicCode} doğum bekleniyor user_id=${uid}`);
    let askStr =
      'Bunu haritandan yorumlayabilmem için doğum tarihini paylaşır mısın? (örn: 1998-07-07 veya 7.7.1998)';
    if (brain.direct_reply && brain.direct_reply.trim().length > 12) {
      try {
        askStr = sanitizeAiOutputOrThrow(brain.direct_reply.trim(), 'ask_structured');
      } catch {
        /* default */
      }
    }
    await ctx.reply(askStr, kb);
    afterConversationReply(uid, text, askStr, { intent: 'ask_birth', replyMode: 'ask_birth_data' });
    return;
  }

  let warm = 'Buradayım; harita, astro kavramı veya soru anı için yazdığında devam edelim.';
  if (brain.direct_reply && brain.direct_reply.trim().length > 5) {
    warm = brain.direct_reply.trim();
  }
  try {
    const out = sanitizeAiOutputOrThrow(warm, 'fallback_warm');
    await ctx.reply(out, kb);
    afterConversationReply(uid, text, out, { intent: 'fallback', replyMode: 'direct_chat' });
  } catch {
    await ctx.reply(warm, kb);
    afterConversationReply(uid, text, warm, { intent: 'fallback', replyMode: 'direct_chat' });
  }
}



bot.start(async (ctx) => {
  const uid = ctx.from.id;
  logger.info(`Kullanıcı /start yazdı user_id=${uid}`);
  sessionStore.reset(uid);
  const prof = userProfileStore.getProfile(uid);
  const init = { step: 'await_intent' };
  if (prof && prof.lastChartData) {
    init.lastChartData = cloneJson(prof.lastChartData);
  }
  sessionStore.set(uid, init);
  await ctx.reply(START_INTRO, Markup.removeKeyboard());
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Komutlar:',
      '/start — sohbet oturumunu sıfırlar (kayıtlı doğum profilin kalır).',
      '/help — bu mesaj',
      '/profile — kayıtlı doğum bilgilerini gösterir.',
      '/update_birth — doğum bilgilerini yeniden girersin.',
      '/reset — kayıtlı doğum profilini siler.',
      '',
      'Doğrudan Türkçe yazarak da ilerleyebilirsin; net bir astroloji veya harita sorusu sorabilirsin.',
      'Kişisel yorum için doğum bilgisi gerekir; bir kez kaydettikten sonra tekrar sormamaya çalışırım.',
      '',
      HELP_SNIPPET,
      '',
      'Konu seçimini yazmak istemezsen (isteğe bağlı) aşağıdaki kutuyu da kullanabilirsin:',
    ].join('\n'),
    topicKeyboard
  );
});

bot.command('profile', async (ctx) => {
  const uid = ctx.from.id;
  const p = userProfileStore.getProfile(uid);
  if (!userProfileStore.isProfileComplete(p)) {
    await ctx.reply(
      'Henüz kayıtlı doğum profilin yok. Doğum haritan veya ilişki/kariyer gibi kişisel bir konu sorduğunda tarih ve yeri adım adım sorarım; istersen /update_birth ile de başlayabilirsin.',
      Markup.removeKeyboard()
    );
    return;
  }
  const dateStr = `${p.birthDate.day}.${p.birthDate.month}.${p.birthDate.year}`;
  const timeStr =
    p.birthTimeKnown && p.birthTime
      ? `${String(p.birthTime.hour).padStart(2, '0')}:${String(p.birthTime.minute).padStart(2, '0')}`
      : 'Bilinmiyor (kısmi harita)';
  await ctx.reply(
    [
      'Kayıtlı doğum profilin:',
      `Tarih: ${dateStr}`,
      `Yer: ${p.birthPlace.label}`,
      `Saat: ${timeStr}`,
      `Mod: ${p.chartMode === 'full' ? 'Tam harita' : 'Kısmi harita'}`,
      '',
      'Güncellemek için: /update_birth',
      'Silmek için: /reset',
    ].join('\n')
  );
});

bot.command('reset', async (ctx) => {
  const uid = ctx.from.id;
  userProfileStore.deleteProfile(uid);
  sessionStore.reset(uid);
  sessionStore.set(uid, { step: 'await_intent' });
  logger.info(`Kullanıcı /reset profil silindi user_id=${uid}`);
  await ctx.reply(
    ['Kayıtlı doğum profilin silindi.', '', START_INTRO].join('\n'),
    Markup.removeKeyboard()
  );
});

bot.command('update_birth', async (ctx) => {
  const uid = ctx.from.id;
  sessionStore.set(uid, {
    ...sessionStore.defaultSession(),
    step: 'await_date',
    intent: 'update_birth',
  });
  logger.info(`Kullanıcı /update_birth user_id=${uid}`);
  await ctx.reply(
    'Doğum bilgilerini yenilemek için doğum tarihini yaz. (örn: 1998-07-07 veya 7.7.1998)',
    Markup.removeKeyboard()
  );
});

bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const s = sessionStore.get(uid);
  const step = s.step || 'idle';

  if (step === 'idle') {
    await ctx.reply('Başlamak için /start yazabilirsin.');
    return;
  }

  if (step === 'await_intent') {
    await runIntentClassificationFlow(ctx, uid, s, text);
    return;
  }

  if (step === 'await_horary_question') {
    const qn = text.trim();
    if (qn.length < 4) {
      await ctx.reply('Soru biraz kısa kaldı; tam cümleyle yazar mısın?', Markup.removeKeyboard());
      return;
    }
    if (horaryRules.isHoraryRestricted(qn)) {
      await ctx.reply(MSG_HORARY_RESTRICTED, Markup.removeKeyboard());
      sessionStore.set(uid, {
        ...sessionStore.get(uid),
        step: 'await_intent',
        horaryQuestionText: null,
        horaryReceivedUnix: null,
      });
      return;
    }
    const rx = ctx.message?.date || Math.floor(Date.now() / 1000);
    sessionStore.set(uid, {
      ...sessionStore.get(uid),
      step: 'await_horary_place',
      horaryQuestionText: qn,
      horaryReceivedUnix: rx,
    });
    await ctx.reply(MSG_HORARY_ASK_PLACE, Markup.removeKeyboard());
    return;
  }

  if (step === 'await_horary_place') {
    const cur = sessionStore.get(uid);
    const qtext = (cur.horaryQuestionText || '').trim();
    const recv = cur.horaryReceivedUnix;
    if (!qtext || recv == null) {
      sessionStore.set(uid, {
        ...sessionStore.get(uid),
        step: 'await_intent',
        horaryQuestionText: null,
        horaryReceivedUnix: null,
      });
      await ctx.reply('Oturum verisi eksik; /start ile yeniden dene.', Markup.removeKeyboard());
      return;
    }
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    const geo = await geocodePlace(text);
    if (!geo.ok) {
      await ctx.reply(geo.error, Markup.removeKeyboard());
      return;
    }
    let out;
    let horaryChartBuilt = null;
    try {
      horaryChartBuilt = horaryService.buildHoraryChartForQuestion({
        question: qtext,
        receivedAtUnix: recv,
        latitude: geo.latitude,
        longitude: geo.longitude,
        placeLabel: geo.label,
        timezoneIANA: null,
      });
      out = await interpretationService.generateHoraryInterpretation(
        horaryChartBuilt,
        env.GROQ_API_KEY,
        env.GROQ_MODEL
      );
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        logger.warn(`Horary sanitize user_id=${uid}`);
        await ctx.reply(MSG_SANITIZE_FAIL, Markup.removeKeyboard());
      } else {
        logger.error(`Horary yorum user_id=${uid}`, e);
        await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
      }
      sessionStore.set(uid, {
        ...sessionStore.get(uid),
        step: 'await_intent',
        horaryQuestionText: null,
        horaryReceivedUnix: null,
      });
      return;
    }
    const chartSnap = horaryChartBuilt ? cloneJson(horaryChartBuilt) : null;
    sessionStore.set(uid, {
      ...sessionStore.get(uid),
      step: 'await_intent',
      horaryQuestionText: null,
      horaryReceivedUnix: null,
      lastHoraryChartData: chartSnap,
    });
    for (const part of chunkTelegram(out)) {
      await ctx.reply(part, Markup.removeKeyboard());
    }
    await ctx.reply('Başka bir sorun olursa yazabilirsin.', Markup.removeKeyboard());
    afterConversationReply(uid, qtext, out, {
      intent: 'horary',
      replyMode: 'horary',
      lastHoraryChartData: chartSnap,
    });
    return;
  }

  if (step === 'await_topic_preset') {
    await handleTopicPresetMessage(ctx, uid, s, text);
    return;
  }

  if (step === 'await_concept') {
    if (text.length < 2) {
      await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
      return;
    }
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    const preservedChart = sessionStore.get(uid).lastChartData;
    let out;
    try {
      out = await interpretationService.explainAstrologicalConcept(
        text,
        env.GROQ_API_KEY,
        env.GROQ_MODEL
      );
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        logger.warn(`Genel kavram sanitize user_id=${uid}`);
        sessionStore.reset(uid);
        sessionStore.set(uid, { step: 'await_intent', lastChartData: preservedChart || null });
        await ctx.reply(MSG_SANITIZE_FAIL, Markup.removeKeyboard());
        return;
      }
      logger.error(`Genel kavram hatası user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR);
      sessionStore.reset(uid);
      sessionStore.set(uid, { step: 'await_intent', lastChartData: preservedChart || null });
      await ctx.reply(START_INTRO, Markup.removeKeyboard());
      return;
    }
    const parts = chunkTelegram(out);
    for (const part of parts) {
      await ctx.reply(part);
    }
    sessionStore.reset(uid);
    sessionStore.set(uid, {
      ...sessionStore.defaultSession(),
      step: 'await_intent',
      lastChartData: preservedChart || null,
      lastUserMessage: text,
      lastAssistantAnswer: out,
      lastIntent: 'concept',
      lastReplyMode: 'general_astro',
    });
    logger.info(`Genel kavram yanıtı gönderildi user_id=${uid}`);
    await ctx.reply('Başka bir soru veya konu için yazmaya devam edebilirsin.', Markup.removeKeyboard());
    return;
  }

  if (step === 'await_date') {
    const parsed = chartCalculator.parseBirthDate(text);
    if (!parsed.ok) {
      await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
      return;
    }
    sessionStore.set(uid, {
      ...s,
      step: 'await_place',
      birthYmd: { year: parsed.year, month: parsed.month, day: parsed.day },
      birthDateText: text,
    });
    logger.info(`Veri toplama: doğum tarihi user_id=${uid} step=await_place`);
    await ctx.reply('Süper. Doğduğun yer neresi? (örn: Bursa, Türkiye)');
    return;
  }

  if (step === 'await_place') {
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    const geo = await geocodePlace(text);
    if (!geo.ok) {
      await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
      return;
    }
    sessionStore.set(uid, {
      ...s,
      step: 'await_time',
      placeText: text,
      placeLabel: geo.label,
      latitude: geo.latitude,
      longitude: geo.longitude,
    });
    logger.info(`Veri toplama: doğum yeri user_id=${uid} step=await_time`);
    await ctx.reply(
      [
        'Tamamdır.',
        'Doğum saatini yaz (örn: 09:15). Bilmiyorsan sadece "bilmiyorum" yazman yeterli.',
      ].join('\n')
    );
    return;
  }

  if (step === 'await_time') {
    const tp = chartCalculator.parseBirthTime(text);
    if (!tp.ok) {
      await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
      return;
    }
    const hasKnownBirthTime = !tp.unknown;
    const base = {
      ...s,
      birthTimeText: text,
      hasKnownBirthTime,
      birthHour: hasKnownBirthTime ? tp.hour : 12,
      birthMinute: hasKnownBirthTime ? tp.minute : 0,
    };
    sessionStore.set(uid, base);
    const full = sessionStore.get(uid);

    const modeMsg = hasKnownBirthTime
      ? 'Saatin net: tam harita modu (yükselen ve evler dahil).'
      : 'Saat bilinmiyor: kısmi harita modu (yükselen ve ev yok; öğle saati varsayımıyla gezegen burçları ve açılar hesaplandı).';

    logger.info(
      `Veri toplama: doğum saati user_id=${uid} has_time=${hasKnownBirthTime} preset_topic=${full.topicCodePreset || 'none'} pending_topic=${full.pendingTopicCode || 'none'} freeform=${Boolean(full.pendingFreeformPersonal)}`
    );

    if (full.pendingFreeformPersonal) {
      await ctx.reply(modeMsg);
      await deliverChartReadingFreeform(ctx, uid, full);
      return;
    }

    if (full.topicCodePreset) {
      await ctx.reply(modeMsg);
      await deliverChartReading(ctx, uid, full, full.topicCodePreset, text);
      return;
    }

    if (full.pendingTopicCode) {
      const tpc = full.pendingTopicCode;
      await ctx.reply(modeMsg);
      const forRead = { ...full, pendingTopicCode: null };
      sessionStore.set(uid, forRead);
      await deliverChartReading(ctx, uid, forRead, tpc, text);
      return;
    }

    sessionStore.set(uid, { ...full, step: 'await_topic' });
    await ctx.reply(
      [
        modeMsg,
        '',
        'Hangi konuda özet istersin? Örneğin: genel özet, ilişkiler, iş ve para, iç dünya veya iletişim.',
      ].join('\n'),
      Markup.removeKeyboard()
    );
    return;
  }

  if (step === 'await_topic') {
    const tp = parseTopicCode(text);
    if (tp.ok) {
      await deliverChartReading(ctx, uid, s, tp.code, text);
      return;
    }
    const profT = userProfileStore.getProfile(uid);
    const profileComplete = userProfileStore.isProfileComplete(profT);
    let b2;
    try {
      b2 = await conversationBrain.decide(text, s, profT, env.GROQ_API_KEY, env.GROQ_MODEL, {
        awaitingTopic: true,
        profileComplete,
      });
    } catch (e) {
      logger.error(`await_topic brain user_id=${uid}`, e);
      b2 = conversationBrain.decideFallback(text, s, profT);
    }
    const topicPick = new Set([
      'general',
      'relationships',
      'work_money',
      'inner_family',
      'communication_learning',
    ]);
    if (b2.topic_code && topicPick.has(b2.topic_code)) {
      await deliverChartReading(ctx, uid, s, b2.topic_code, text);
      return;
    }
    if (b2.reply_mode === 'direct_chat' && b2.direct_reply && b2.direct_reply.trim().length > 4) {
      try {
        const out = sanitizeAiOutputOrThrow(b2.direct_reply.trim(), 'await_topic_brain');
        await ctx.reply(out, Markup.removeKeyboard());
        afterConversationReply(uid, text, out, { intent: b2.intent, replyMode: 'direct_chat' });
      } catch {
        await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
      }
      return;
    }
    await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
    return;
  }

  logger.warn(`Beklenmeyen adım user_id=${uid} step=${step}`);
  await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
});

const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(env.PORT, HOST, () => {
  logger.info(`HTTP hazır: / ve /health — port=${env.PORT} host=${HOST}`);
});

bot
  .launch()
  .then(() => {
    logger.info('Bot başladı: Telegram polling aktif.');
  })
  .catch((e) => {
    logger.error('Telegram bot.launch başarısız', e);
    process.exit(1);
  });

function shutdown(signal) {
  logger.info(`Kapanıyor: ${signal}`);
  bot.stop(signal);
  server.close(() => {
    logger.info('HTTP sunucusu kapatıldı.');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('HTTP kapanışı zaman aşımı, çıkılıyor.');
    process.exit(0);
  }, 8000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
