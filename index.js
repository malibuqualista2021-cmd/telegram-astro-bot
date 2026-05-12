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

function brainReplyText(brain) {
  return String(brain && brain.reply != null ? brain.reply : '').trim();
}

function inferChartTopicCodeFromBrain(userText, brain) {
  const codes = conversationBrain.VALID_CHART_TOPIC_CODES;
  if (brain && brain.chart_topic_code && codes.has(brain.chart_topic_code)) return brain.chart_topic_code;
  const combined = `${userText || ''} ${(brain && brain.topic) || ''}`.toLocaleLowerCase('tr-TR');
  if (combined.includes('ilişki') || combined.includes('iliski') || /7\s*\.\s*ev/.test(combined))
    return 'relationships';
  if (combined.includes('iş') || combined.includes('is') || combined.includes('para') || combined.includes('kariyer'))
    return 'work_money';
  if (combined.includes('iç dünya') || combined.includes('ic dunya') || combined.includes('aile') || combined.includes('duygu'))
    return 'inner_family';
  if (combined.includes('iletişim') || combined.includes('iletişim') || combined.includes('öğrenme') || combined.includes('ogrenme'))
    return 'communication_learning';
  if (combined.includes('genel')) return 'general';
  return 'general';
}

function isFreeformChartQuestion(userText, brainTopic) {
  const low = `${userText || ''} ${brainTopic || ''}`.toLocaleLowerCase('tr-TR');
  return (
    /\bbenim\b.{0,48}(\d{1,2}\s*\.?\s*ev|yukselen|yükselen|haritam(a|da|ı|i)?)/i.test(low) ||
    /\b(venüsüm|venusum|güneşim|gunesim|ayım|ayim|merkürüm|merkurum|marsım|marsim|natal)/i.test(low)
  );
}

async function sendBrainNaturalReply(ctx, uid, userText, brain, kb, meta = {}) {
  const raw = brainReplyText(brain);
  const tag = meta.sanitizeTag || 'brain_reply';
  if (raw.length > 3) {
    try {
      const out = sanitizeAiOutputOrThrow(raw, tag);
      for (const part of chunkTelegram(out)) {
        await ctx.reply(part, kb);
      }
      afterConversationReply(uid, userText, out, {
        intent: meta.intent || brain.intent || 'chat',
        replyMode: brain.action,
        lastChartData: meta.lastChartData,
        lastHoraryChartData: meta.lastHoraryChartData,
      });
      return true;
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        await ctx.reply(MSG_SANITIZE_FAIL, kb);
        return true;
      }
    }
  }
  if (meta.skipDirectFallback) return false;
  await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
  const ctxSum = buildBrainContextSummary(uid, sessionStore.get(uid), userProfileStore.getProfile(uid));
  const out = await interpretationService.generateDirectChatReply(userText, env.GROQ_API_KEY, env.GROQ_MODEL, {
    hint: raw || '',
    contextSummary: ctxSum,
  });
  for (const part of chunkTelegram(out)) {
    await ctx.reply(part, kb);
  }
  afterConversationReply(uid, userText, out, { intent: meta.intent || 'chat', replyMode: brain.action });
  return true;
}

async function handleGenerateChartReadingAction(ctx, uid, s, text, brain, kb) {
  const standardTopicCodes = conversationBrain.VALID_CHART_TOPIC_CODES;
  const topicCode = inferChartTopicCodeFromBrain(text, brain);
  const freeform = isFreeformChartQuestion(text, brain.topic);

  if (freeform) {
    const resolved = resolveChartForUser(uid, s);
    if (resolved.chart) {
      if (resolved.usedSavedProfile) {
        await ctx.reply(MSG_SAVED_PROFILE_HINT, kb);
      }
      sessionStore.set(uid, { ...sessionStore.get(uid), lastChartData: resolved.chart });
      const ack = brainReplyText(brain);
      if (ack.length > 4 && ack.length < 500) {
        try {
          await ctx.reply(sanitizeAiOutputOrThrow(ack, 'personal_ack'), kb);
        } catch {
          /* opsiyonel ön not */
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
          replyMode: 'generate_chart_reading',
        });
      } catch (e) {
        if (isSanitizeDegradedError(e)) {
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
    await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
      sanitizeTag: 'ask_freeform',
      intent: 'ask_birth_date',
    });
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
    const prep = brainReplyText(brain);
    if (prep.length > 4 && prep.length < 500) {
      try {
        await ctx.reply(sanitizeAiOutputOrThrow(prep, 'topic_prep'), kb);
      } catch {
        /* yok */
      }
    }
    await deliverChartReading(ctx, uid, merged, topicCode, text);
    return;
  }

  sessionStore.set(uid, {
    ...sessionStore.defaultSession(),
    step: 'await_date',
    intent: 'chart_natural',
    pendingTopicCode: standardTopicCodes.has(topicCode) ? topicCode : null,
    pendingFreeformPersonal: null,
    topicCodePreset: null,
  });
  logger.info(`Doğal dil -> konu yorumu topic=${topicCode} doğum bekleniyor user_id=${uid}`);
  await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
    sanitizeTag: 'ask_structured',
    intent: 'ask_birth_date',
  });
}

async function maybeSupplementShortGeneralReply(ctx, uid, text, brain, kb) {
  const lead = brainReplyText(brain);
  if (lead.length >= 100) {
    await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
      sanitizeTag: 'brain_general',
      intent: brain.intent || 'general_astro',
    });
    return;
  }
  await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
  try {
    const body = await astroKnowledgeService.answerGeneralConcept(text, env.GROQ_API_KEY, env.GROQ_MODEL);
    const rawCombo = (lead ? `${lead}\n\n` : '') + body;
    const combo = sanitizeAiOutputOrThrow(rawCombo, 'general_astro_combo');
    for (const part of chunkTelegram(combo)) {
      await ctx.reply(part, kb);
    }
    afterConversationReply(uid, text, combo, {
      intent: brain.intent || 'general_astro',
      replyMode: 'reply',
    });
  } catch (e) {
    if (isSanitizeDegradedError(e)) {
      await ctx.reply(MSG_SANITIZE_FAIL, kb);
      return;
    }
    logger.error(`Genel sohbet Groq user_id=${uid}`, e);
    await ctx.reply(USER_SOFT_ERROR, kb);
  }
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

/** Konu metninden kod çıkarır; rakam menüsü yoktur. */
function parseTopicCode(text) {
  const raw = (text || '').trim();
  const low = raw.toLocaleLowerCase('tr-TR');
  if (low.includes('genel')) return { ok: true, code: 'general' };
  if (low.includes('ilişki')) return { ok: true, code: 'relationships' };
  if (low.includes('para') || low.includes('değer') || /\biş\b/.test(low) || low.includes('kariyer'))
    return { ok: true, code: 'work_money' };
  if (low.includes('iç dünya') || low.includes('duygu') || low.includes('aile'))
    return { ok: true, code: 'inner_family' };
  if (low.includes('iletişim') || low.includes('öğrenme') || low.includes('ifade'))
    return { ok: true, code: 'communication_learning' };
  return { ok: false };
}

async function handleTopicPresetMessage(ctx, uid, s, text) {
  const tp = parseTopicCode(text);
  if (!tp.ok) {
    const prof = userProfileStore.getProfile(uid);
    const profileComplete = userProfileStore.isProfileComplete(prof);
    let brain;
    try {
      brain = await conversationBrain.decide(text, s, prof, env.GROQ_API_KEY, env.GROQ_MODEL, {
        awaitingTopicPreset: true,
        profileComplete,
      });
    } catch (e) {
      logger.error(`topic_preset brain user_id=${uid}`, e);
      brain = conversationBrain.decideFallback(text, s, prof);
    }
    if (brain.action === 'generate_chart_reading') {
      const code = inferChartTopicCodeFromBrain(text, brain);
      const fakeTp = { ok: true, code };
      await handleTopicPresetMessageResolved(ctx, uid, s, text, fakeTp);
      return;
    }
    if (brain.action === 'reply') {
      await sendBrainNaturalReply(ctx, uid, text, brain, Markup.removeKeyboard(), {
        sanitizeTag: 'topic_preset_brain',
        intent: brain.intent || 'chat',
      });
      return;
    }
    await tryCollectorBrainReply(ctx, uid, s, text, Markup.removeKeyboard());
    return;
  }
  await handleTopicPresetMessageResolved(ctx, uid, s, text, tp);
}

async function handleTopicPresetMessageResolved(ctx, uid, s, text, tp) {
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
    replyMode: 'generate_chart_reading',
  });
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
    replyMode: 'generate_chart_reading',
  });
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
      replyMode: 'reply',
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
  const dr = brainReplyText(brain);
  if (dr.length > 4) {
    try {
      const out = sanitizeAiOutputOrThrow(dr, 'collector_brain');
      await ctx.reply(out, kb);
      afterConversationReply(uid, text, out, { intent: brain.intent, replyMode: brain.action });
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
      hint: `Kullanıcı doğum bilgisi adımında: ${s.step}. Eksik bilgiyi doğal biçimde sor; kalıp ve "anlamadım" kullanma.`,
      contextSummary: `Adım: ${s.step}.`,
    });
    for (const part of chunkTelegram(out)) {
      await ctx.reply(part, kb);
    }
    afterConversationReply(uid, text, out, { intent: 'collector', replyMode: 'reply' });
  } catch {
    await ctx.reply(USER_SOFT_ERROR, kb);
  }
}

async function runIntentClassificationFlow(ctx, uid, s, text, options = {}) {
  const kb = Markup.removeKeyboard();
  const prof = userProfileStore.getProfile(uid);
  const profileComplete = userProfileStore.isProfileComplete(prof);
  const standardTopicCodes = conversationBrain.VALID_CHART_TOPIC_CODES;

  let brain;
  try {
    brain = await conversationBrain.decide(text, s, prof, env.GROQ_API_KEY, env.GROQ_MODEL, {
      awaitingTopic: options.awaitingTopic === true,
      awaitingTopicPreset: options.awaitingTopicPreset === true,
      profileComplete,
    });
  } catch (e) {
    logger.error(`conversationBrain user_id=${uid}`, e);
    brain = conversationBrain.decideFallback(text, s, prof);
  }

  logger.info(`Brain user_id=${uid} action=${brain.action} intent=${brain.intent} source=${brain.intentSource}`);

  if (brain.intentSource === 'groq_error') {
    await ctx.reply(MSG_INTENT_GROQ_FALLBACK, kb);
  }

  if (brain.action === 'reset_profile') {
    userProfileStore.deleteProfile(uid);
    sessionStore.reset(uid);
    sessionStore.set(uid, { step: 'await_intent', conversationHistory: [] });
    let ack = 'Kayıtlı doğum profilin silindi. İstersen doğum bilgisiyle yeniden başlayabilirsin.';
    const r = brainReplyText(brain);
    if (r.length > 8) {
      try {
        ack = sanitizeAiOutputOrThrow(r, 'reset_ack');
      } catch {
        /* varsayılan */
      }
    }
    await ctx.reply(ack, kb);
    afterConversationReply(uid, text, ack, { intent: 'reset', replyMode: 'reset_profile' });
    await ctx.reply(START_INTRO, kb);
    return;
  }

  if (brain.action === 'update_profile') {
    sessionStore.set(uid, {
      ...sessionStore.defaultSession(),
      step: 'await_date',
      intent: 'update_birth',
      pendingTopicCode: null,
    });
    let ack = 'Tamam. Yeni doğum tarihini yazar mısın? (örn: 1998-07-07 veya 7.7.1998)';
    const r = brainReplyText(brain);
    if (r.length > 10) {
      try {
        ack = sanitizeAiOutputOrThrow(r, 'update_birth_ack');
      } catch {
        /* varsayılan */
      }
    }
    await ctx.reply(ack, kb);
    afterConversationReply(uid, text, ack, { intent: 'update_birth', replyMode: 'update_profile' });
    return;
  }

  if (brain.action === 'summarize_previous') {
    const last = sessionStore.get(uid).lastAssistantAnswer;
    if (!last || String(last).trim().length < 40) {
      let soft =
        'Az önce uzun bir yanıt göremedim; neye odaklanmamı istersin, bir cümleyle yazabilir misin?';
      const r = brainReplyText(brain);
      if (r.length > 10) {
        try {
          soft = sanitizeAiOutputOrThrow(r, 'summarize_soft');
        } catch {
          /* varsayılan */
        }
      }
      await ctx.reply(soft, kb);
      afterConversationReply(uid, text, soft, { intent: 'summarize', replyMode: 'reply' });
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

  if (brain.action === 'ask_horary_location') {
    await routeHoraryQuestion(ctx, uid, text, kb, brainReplyText(brain));
    return;
  }

  if (brain.action === 'generate_horary_reading') {
    const snap = sessionStore.get(uid).lastHoraryChartData;
    if (!snap) {
      await routeHoraryQuestion(ctx, uid, text, kb, brainReplyText(brain));
      return;
    }
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    try {
      const out = await interpretationService.generateHoraryInterpretation(
        snap,
        env.GROQ_API_KEY,
        env.GROQ_MODEL
      );
      for (const part of chunkTelegram(out)) {
        await ctx.reply(part, kb);
      }
      afterConversationReply(uid, text, out, {
        intent: 'horary_repeat',
        replyMode: 'generate_horary_reading',
        lastHoraryChartData: snap,
      });
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        await ctx.reply(MSG_SANITIZE_FAIL, kb);
        return;
      }
      logger.error(`Horary tekrar yorum user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR, kb);
    }
    return;
  }

  if (brain.action === 'generate_chart_reading') {
    await handleGenerateChartReadingAction(ctx, uid, s, text, brain, kb);
    return;
  }

  if (brain.action === 'ask_birth_date') {
    const inferred = inferChartTopicCodeFromBrain(text, brain);
    const tpc =
      brain.chart_topic_code && standardTopicCodes.has(brain.chart_topic_code)
        ? brain.chart_topic_code
        : inferred;
    let hintMsg = brainReplyText(brain);
    if (hintMsg.length < 12) {
      hintMsg = 'Kişisel haritana bakmak için doğum tarihinden başlayalım; nasıl yazdığını esnetebilirsin.';
    } else {
      try {
        hintMsg = sanitizeAiOutputOrThrow(hintMsg, 'ask_birth');
      } catch {
        hintMsg = 'Kişisel haritana bakmak için doğum tarihinden başlayalım; nasıl yazdığını esnetebilirsin.';
      }
    }
    sessionStore.set(uid, {
      ...sessionStore.defaultSession(),
      step: 'await_date',
      intent: standardTopicCodes.has(tpc) ? 'chart_natural' : 'chart',
      pendingTopicCode: standardTopicCodes.has(tpc) ? tpc : null,
      pendingFreeformPersonal: null,
      topicCodePreset: null,
    });
    await ctx.reply(hintMsg, kb);
    afterConversationReply(uid, text, hintMsg, { intent: brain.intent || 'ask_birth', replyMode: 'ask_birth_date' });
    return;
  }

  if (brain.action === 'ask_birth_place') {
    const cur = sessionStore.get(uid);
    if (!cur.birthYmd) {
      const inferred = inferChartTopicCodeFromBrain(text, brain);
      const tpc =
        brain.chart_topic_code && standardTopicCodes.has(brain.chart_topic_code)
          ? brain.chart_topic_code
          : inferred;
      let hintMsg = brainReplyText(brain);
      if (hintMsg.length < 8) {
        hintMsg = 'Önce doğum tarihini paylaşalım; ardından yeri sorarım.';
      } else {
        try {
          hintMsg = sanitizeAiOutputOrThrow(hintMsg, 'ask_birth_date_from_place');
        } catch {
          hintMsg = 'Önce doğum tarihini paylaşalım; ardından yeri sorarım.';
        }
      }
      sessionStore.set(uid, {
        ...sessionStore.defaultSession(),
        step: 'await_date',
        intent: standardTopicCodes.has(tpc) ? 'chart_natural' : 'chart',
        pendingTopicCode: standardTopicCodes.has(tpc) ? tpc : null,
        pendingFreeformPersonal: null,
        topicCodePreset: null,
      });
      await ctx.reply(hintMsg, kb);
      afterConversationReply(uid, text, hintMsg, { intent: 'ask_birth_date', replyMode: 'ask_birth_date' });
      return;
    }
    sessionStore.set(uid, { ...cur, step: 'await_place' });
    await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
      sanitizeTag: 'ask_place',
      intent: 'ask_birth_place',
    });
    return;
  }

  if (brain.action === 'ask_birth_time') {
    const cur = sessionStore.get(uid);
    if (!cur.birthYmd) {
      sessionStore.set(uid, {
        ...sessionStore.defaultSession(),
        step: 'await_date',
        intent: 'chart',
        pendingTopicCode: null,
        pendingFreeformPersonal: null,
        topicCodePreset: null,
      });
      await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
        sanitizeTag: 'ask_time_needs_date',
        intent: 'ask_birth_date',
      });
      return;
    }
    if (cur.latitude == null) {
      sessionStore.set(uid, { ...cur, step: 'await_place' });
      await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
        sanitizeTag: 'ask_place_first',
        intent: 'ask_birth_place',
      });
      return;
    }
    sessionStore.set(uid, { ...cur, step: 'await_time' });
    await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
      sanitizeTag: 'ask_time',
      intent: 'ask_birth_time',
    });
    return;
  }

  if (brain.action === 'reply') {
    if (brain.intent === 'birth_time_faq') {
      const r = brainReplyText(brain);
      const body = r.length > 20 ? r : MSG_BIRTH_TIME_FAQ;
      await ctx.reply(body, kb);
      afterConversationReply(uid, text, body, { intent: 'birth_time_faq', replyMode: 'reply' });
      return;
    }
    const r0 = brainReplyText(brain);
    if (r0.length > 35) {
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
        sanitizeTag: 'brain_direct_chat',
        intent: brain.intent || 'chat',
      });
      return;
    }
    if (brain.intent === 'general_astro' || /nedir|ne demek|kavram|ev\b|gezegen|burç/i.test(text)) {
      await maybeSupplementShortGeneralReply(ctx, uid, text, brain, kb);
      return;
    }
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
      sanitizeTag: 'brain_direct_chat',
      intent: brain.intent || 'chat',
    });
    return;
  }

  await sendBrainNaturalReply(ctx, uid, text, brain, kb, {
    sanitizeTag: 'brain_default',
    intent: brain.intent || 'chat',
  });
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
      await tryCollectorBrainReply(ctx, uid, sessionStore.get(uid), qn, Markup.removeKeyboard());
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
      await tryCollectorBrainReply(ctx, uid, cur, text, Markup.removeKeyboard());
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
    afterConversationReply(uid, qtext, out, {
      intent: 'horary',
      replyMode: 'generate_horary_reading',
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
    await ctx.reply('Tamam. Şimdi doğduğun yeri şehir ve ülke ile yazabilir misin?');
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
    await ctx.reply('Teşekkürler. Doğum saatini yazabilirsin; bilmiyorsan bunu da söyleyebilirsin.');
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
        'İstersen genel özet, ilişkiler, iş ve para, iç dünya veya iletişim diyebilirsin; doğrudan aklındaki soruyu da yazabilirsin.',
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
    const topicPick = conversationBrain.VALID_CHART_TOPIC_CODES;
    if (b2.action === 'generate_chart_reading') {
      const code = inferChartTopicCodeFromBrain(text, b2);
      await deliverChartReading(ctx, uid, s, code, text);
      return;
    }
    const legacyCode = b2.chart_topic_code || (b2.topic_code && topicPick.has(b2.topic_code) ? b2.topic_code : null);
    if (legacyCode && topicPick.has(legacyCode)) {
      await deliverChartReading(ctx, uid, s, legacyCode, text);
      return;
    }
    if (b2.action === 'reply' && brainReplyText(b2).length > 4) {
      try {
        const out = sanitizeAiOutputOrThrow(brainReplyText(b2), 'await_topic_brain');
        await ctx.reply(out, Markup.removeKeyboard());
        afterConversationReply(uid, text, out, { intent: b2.intent, replyMode: b2.action });
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
