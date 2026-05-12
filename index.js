const { loadEnv } = require('./config/env');
const env = loadEnv();

const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const logger = require('./services/logger');
const sessionStore = require('./services/sessionStore');
const userProfileStore = require('./services/userProfileStore');
const chartCalculator = require('./services/chartCalculator');
const interpretationService = require('./services/interpretationService');
const messageClassifier = require('./services/messageClassifier');
const astroKnowledgeService = require('./services/astroKnowledgeService');
const horaryService = require('./services/horaryService');
const horaryRules = require('./services/horaryRules');

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

const MSG_DISAMBIG_PERSONAL_VS_GENERAL =
  'Bunu kişisel haritan üzerinden yorumlamamı mı istiyorsun, yoksa genel astrolojik anlamını mı öğrenmek istiyorsun? “Haritam” veya “genel” diye kısaca yazman yeterli.';

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
      'Tam anlayamadım. Örneğin “genel özet”, “ilişkiler”, “iş ve para”, “iç dünya” veya “iletişim” diye yazabilirsin; istersen rakamla 1–5 de kullanılabilir.',
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
    await deliverChartReading(ctx, uid, hydrated, tp.code);
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

async function deliverChartReading(ctx, uid, s, topicCode) {
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
  await ctx.reply('Başka bir sorun olursa yazabilirsin.', Markup.removeKeyboard());
}

async function runIntentClassificationFlow(ctx, uid, s, text, options = {}) {
  const skipDigit = options.skipDigitShortcut === true;

  if (!skipDigit && /^[1-4]\b/.test(text.trim())) {
    const pi = parseMainIntent(text);
    if (pi.ok) {
      if (pi.n === 1) {
        const prof = userProfileStore.getProfile(uid);
        if (userProfileStore.isProfileComplete(prof)) {
          sessionStore.set(uid, {
            ...sessionStore.defaultSession(),
            step: 'await_topic',
            intent: 'chart',
            topicCodePreset: null,
            pendingFreeformPersonal: null,
            pendingTopicCode: null,
            lastChartData: prof.lastChartData ? cloneJson(prof.lastChartData) : null,
            ...sessionFieldsFromProfile(prof),
          });
          logger.info(`Kısayol:1 kayıtlı profil user_id=${uid}`);
          await ctx.reply(
            [
              'Kayıtlı doğum bilgilerinle devam ediyorum.',
              'Hangi konuda özet istersin? Örneğin: genel özet, ilişkiler, iş ve para, iç dünya veya iletişim.',
            ].join('\n'),
            Markup.removeKeyboard()
          );
          return;
        }
        sessionStore.set(uid, {
          step: 'await_date',
          intent: 'chart',
          topicCodePreset: null,
          pendingFreeformPersonal: null,
          pendingTopicCode: null,
        });
        logger.info(`Kısayol:1 doğum toplama user_id=${uid}`);
        await ctx.reply(
          'Tamam. Kişisel harita için doğum tarihini yazar mısın? (örn: 1998-07-07 veya 7.7.1998)',
          Markup.removeKeyboard()
        );
        return;
      }
      if (pi.n === 2) {
        sessionStore.set(uid, {
          step: 'await_topic_preset',
          intent: 'chart_topic_first',
          topicCodePreset: null,
          pendingFreeformPersonal: null,
          pendingTopicCode: null,
        });
        logger.info(`Kısayol:2 önce konu user_id=${uid}`);
        await ctx.reply(
          'Hangi başlıkla ilerleyelim? Örneğin: genel özet, ilişkiler, iş ve para, iç dünya veya iletişim — kısaca yazman yeterli.',
          Markup.removeKeyboard()
        );
        return;
      }
      if (pi.n === 3) {
        sessionStore.set(uid, { step: 'await_concept', intent: 'concept', pendingTopicCode: null });
        logger.info(`Kısayol:3 kavram user_id=${uid}`);
        await ctx.reply('Hangi kavramı merak ediyorsun? Kısaca yazabilirsin.', Markup.removeKeyboard());
        return;
      }
      if (pi.n === 4) {
        logger.info(`Kısayol:4 transit yok user_id=${uid}`);
        await ctx.reply(MSG_UNSUPPORTED, Markup.removeKeyboard());
        return;
      }
    }
  }

  const cls = await messageClassifier.classifyMessageAsync(text, {
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL,
  });
  logger.info(
    `Sınıflandırma user_id=${uid} category=${cls.category} reason=${cls.reason} source=${cls.intentSource} conf=${cls.confidence}`
  );

  const kb = Markup.removeKeyboard();

  if (cls.intentSource === 'groq_error') {
    await ctx.reply(MSG_INTENT_GROQ_FALLBACK, kb);
  }

  if (cls.ambiguousPersonalVsGeneral) {
    sessionStore.set(uid, {
      ...sessionStore.get(uid),
      step: 'await_intent_clarify',
      pendingClarifyText: text,
    });
    await ctx.reply(MSG_DISAMBIG_PERSONAL_VS_GENERAL, kb);
    return;
  }

  if (cls.category === 'reset_profile') {
    userProfileStore.deleteProfile(uid);
    sessionStore.reset(uid);
    sessionStore.set(uid, { step: 'await_intent' });
    logger.info(`Metin: reset_profile user_id=${uid}`);
    await ctx.reply(
      'Kayıtlı doğum profilin silindi. İstersen yeniden doğum bilgisi vererek devam edebilirsin.',
      kb
    );
    await ctx.reply(START_INTRO, kb);
    return;
  }

  if (cls.category === 'update_birth_data') {
    sessionStore.set(uid, {
      ...sessionStore.defaultSession(),
      step: 'await_date',
      intent: 'update_birth',
      pendingTopicCode: null,
    });
    logger.info(`Metin: update_birth_data user_id=${uid}`);
    await ctx.reply(
      'Tamam. Yeni doğum tarihini yazar mısın? (örn: 1998-07-07 veya 7.7.1998)',
      kb
    );
    return;
  }

  if (cls.category === 'horary_question') {
    if (horaryRules.isHoraryRestricted(text)) {
      await ctx.reply(MSG_HORARY_RESTRICTED, kb);
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
    return;
  }

  if (cls.category === 'unsupported_transit') {
    await ctx.reply(MSG_UNSUPPORTED, kb);
    return;
  }

  if (cls.category === 'risky_question') {
    await ctx.reply(MSG_RISKY_BOUNDARY, kb);
    return;
  }

  if (cls.category === 'unclear_message') {
    const rawTrim = text.trim();
    const low = rawTrim.toLocaleLowerCase('tr-TR');
    const tpPick = parseTopicCode(text);
    const looksLikeTopicLabel =
      tpPick.ok &&
      rawTrim.length <= 52 &&
      (/^(genel\s*özet|ilişkiler|iş\s*\/\s*para|iç\s*dünya|iletişim)/i.test(rawTrim) || /^[1-5]$/.test(rawTrim)) &&
      !/\bbenim\b|\bharitam\b/i.test(low);
    if (looksLikeTopicLabel) {
      sessionStore.set(uid, {
        ...sessionStore.defaultSession(),
        step: 'await_topic_preset',
        intent: 'chart_topic_first',
        topicCodePreset: null,
        pendingFreeformPersonal: null,
        pendingTopicCode: null,
      });
      await handleTopicPresetMessage(ctx, uid, sessionStore.get(uid), text);
      return;
    }
    await ctx.reply(
      [
        'Bunu tam olarak çözemedim; bir iki cümleyle yazabilir misin.',
        'İstersen /help ile örneklere de bakabilirsin.',
      ].join('\n'),
      kb
    );
    return;
  }

  if (cls.category === 'general_astro_knowledge') {
    if (cls.reason === 'birth_time_faq') {
      await ctx.reply(MSG_BIRTH_TIME_FAQ, kb);
      return;
    }
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    try {
      const out = await astroKnowledgeService.answerGeneralConcept(
        text,
        env.GROQ_API_KEY,
        env.GROQ_MODEL
      );
      for (const part of chunkTelegram(out)) {
        await ctx.reply(part);
      }
    } catch (e) {
      if (isSanitizeDegradedError(e)) {
        logger.warn(`Genel sohbet sanitize user_id=${uid}`);
        await ctx.reply(MSG_SANITIZE_FAIL, kb);
        return;
      }
      logger.error(`Genel sohbet Groq user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR, kb);
      return;
    }
    await ctx.reply('Başka bir astroloji sorusun olursa yazabilirsin.', kb);
    return;
  }

  const personalCategories = new Set([
    'personal_chart_reading',
    'personal_topic_relationship',
    'personal_topic_career_money',
    'personal_topic_inner_world',
    'personal_topic_communication',
  ]);

  if (personalCategories.has(cls.category)) {
    const topicCode = cls.topicCode || 'general';
    const freeform = cls.personalKind === 'freeform';

    if (freeform) {
      const resolved = resolveChartForUser(uid, s);
      if (resolved.chart) {
        if (resolved.usedSavedProfile) {
          await ctx.reply(MSG_SAVED_PROFILE_HINT, kb);
        }
        sessionStore.set(uid, { ...sessionStore.get(uid), lastChartData: resolved.chart });
        await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
        try {
          const ans = await interpretationService.answerPersonalQuestion(
            resolved.chart,
            text,
            env.GROQ_API_KEY,
            env.GROQ_MODEL
          );
          for (const part of chunkTelegram(ans)) {
            await ctx.reply(part);
          }
        } catch (e) {
          if (isSanitizeDegradedError(e)) {
            logger.warn(`Kişisel yorum sanitize user_id=${uid}`);
            await ctx.reply(MSG_SANITIZE_FAIL, kb);
            return;
          }
          logger.error(`Kişisel yorum hatası user_id=${uid}`, e);
          await ctx.reply(USER_SOFT_ERROR, kb);
        }
        await ctx.reply('Sormaya devam edebilirsin.', kb);
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
      await ctx.reply(
        'Bunu kişisel haritanda görmek için önce doğum tarihini paylaşır mısın? (örn: 1998-07-07 veya 7.7.1998)',
        kb
      );
      return;
    }

    const prof = userProfileStore.getProfile(uid);
    if (userProfileStore.isProfileComplete(prof)) {
      const merged = {
        ...sessionStore.defaultSession(),
        ...sessionFieldsFromProfile(prof),
        lastChartData: prof.lastChartData ? cloneJson(prof.lastChartData) : null,
        step: 'await_intent',
      };
      logger.info(`Doğal dil -> konu yorumu topic=${topicCode} profil var user_id=${uid}`);
      await ctx.reply('Kayıtlı bilgilerinle haritanı hazırlıyorum…', kb);
      await deliverChartReading(ctx, uid, merged, topicCode);
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
    await ctx.reply(
      'Bunu haritandan yorumlayabilmem için doğum tarihini paylaşır mısın? (örn: 1998-07-07 veya 7.7.1998)',
      kb
    );
    return;
  }

  await ctx.reply(
    [
      'Bunu tam olarak çözemedim; bir iki cümleyle yazabilir misin.',
      'İstersen /help ile örneklere de bakabilirsin.',
    ].join('\n'),
    kb
  );
}

async function processIntentClarify(ctx, uid, s, text) {
  const orig = (s.pendingClarifyText || '').trim();
  const low = text.toLocaleLowerCase('tr-TR');
  let suffix = '';
  if (/\b(haritam|kişisel|doğum|natal|evet)\b/i.test(low) || /\bharita\b/i.test(low)) {
    suffix = '\n[Kullanıcı bağlamı: kişisel doğum haritası üzerinden.]';
  } else if (/\b(genel|tanım|kavram)\b/i.test(low)) {
    suffix = '\n[Kullanıcı bağlamı: yalnızca genel astroloji bilgisi.]';
  } else {
    suffix = `\n[Kullanıcı netleştirmesi: ${text}]`;
  }
  sessionStore.set(uid, {
    ...sessionStore.get(uid),
    step: 'await_intent',
    pendingClarifyText: null,
  });
  await runIntentClassificationFlow(ctx, uid, sessionStore.get(uid), `${orig}${suffix}`, {
    skipDigitShortcut: true,
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

  if (step === 'await_intent_clarify') {
    await processIntentClarify(ctx, uid, s, text);
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
    try {
      const chart = horaryService.buildHoraryChartForQuestion({
        question: qtext,
        receivedAtUnix: recv,
        latitude: geo.latitude,
        longitude: geo.longitude,
        placeLabel: geo.label,
        timezoneIANA: null,
      });
      out = await interpretationService.generateHoraryInterpretation(
        chart,
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
    sessionStore.set(uid, {
      ...sessionStore.get(uid),
      step: 'await_intent',
      horaryQuestionText: null,
      horaryReceivedUnix: null,
    });
    for (const part of chunkTelegram(out)) {
      await ctx.reply(part, Markup.removeKeyboard());
    }
    await ctx.reply('Başka bir sorun olursa yazabilirsin.', Markup.removeKeyboard());
    return;
  }

  if (step === 'await_topic_preset') {
    await handleTopicPresetMessage(ctx, uid, s, text);
    return;
  }

  if (step === 'await_concept') {
    if (text.length < 2) {
      await ctx.reply('Biraz daha detay yazabilir misin?');
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
    sessionStore.set(uid, { step: 'await_intent', lastChartData: preservedChart || null });
    logger.info(`Genel kavram yanıtı gönderildi user_id=${uid}`);
    await ctx.reply('Başka bir soru veya konu için yazmaya devam edebilirsin.', Markup.removeKeyboard());
    return;
  }

  if (step === 'await_date') {
    const parsed = chartCalculator.parseBirthDate(text);
    if (!parsed.ok) {
      await ctx.reply(parsed.error);
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
      await ctx.reply(geo.error);
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
      await ctx.reply(tp.error);
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
      await deliverChartReading(ctx, uid, full, full.topicCodePreset);
      return;
    }

    if (full.pendingTopicCode) {
      const tpc = full.pendingTopicCode;
      await ctx.reply(modeMsg);
      const forRead = { ...full, pendingTopicCode: null };
      sessionStore.set(uid, forRead);
      await deliverChartReading(ctx, uid, forRead, tpc);
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
    if (!tp.ok) {
      await ctx.reply(tp.error, Markup.removeKeyboard());
      return;
    }
    await deliverChartReading(ctx, uid, s, tp.code);
    return;
  }

  logger.warn(`Beklenmeyen adım user_id=${uid} step=${step}`);
  await ctx.reply('Beklenmeyen durum. /start ile baştan başlayalım.');
  sessionStore.reset(uid);
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
