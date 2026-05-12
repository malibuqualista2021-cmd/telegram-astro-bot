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

const USER_SOFT_ERROR =
  'Şu an yorum hazırlanırken küçük bir sorun oluştu. Lütfen biraz sonra tekrar dene.';

const MSG_UNSUPPORTED =
  'Bu özellik yakında eklenecek. Şimdilik doğum haritası ve astrolojik kavramlar üzerinden yardımcı olabilirim.';

const MSG_RISKY_BOUNDARY =
  'Bu tarz konularda kesin hüküm veya kader dili kullanmıyorum. Astroloji burada farkındalık ve simgesel düşünce içindir; sağlık, hukuk ve finans için uzmanlara danışmalısın. İstersen genel bir kavramı sorabilir veya doğum bilgilerinle haritandan devam edebilirsin.';

const MSG_BIRTH_TIME_FAQ =
  'Saati bilmiyorsan sorun değil: haritayı kısmi modda hesaplarım (yükselen ve ev yerleşimleri olmadan). Tarih ve yer net olsa bile Güneş, Ay ve gezegen burçlarına göre kişisel bir özet çıkarabilirim. Menüden "1" ile akışa girebilir veya doğum adımlarında saat sorulunca "bilmiyorum" yazabilirsin.';

const MSG_SAVED_PROFILE_HINT =
  'Harita bilgilerin kayıtlı. Bu soruya kayıtlı doğum bilgilerine göre yanıt veriyorum.';

const GEOCODE_UA =
  env.GEOCODE_USER_AGENT || 'TelegramAstroMVP/1.0 (https://github.com/)';

const START_INTRO = [
  'Merhaba, ben kişisel astroloji asistanın.',
  'Doğum haritanı yorumlayabilir, haritan üzerinden bir konuyu inceleyebilir veya astrolojik bir kavramı sade şekilde açıklayabilirim.',
  '',
  'İstersen menüden seç, istersen doğrudan soru da yazabilirsin.',
  '',
  'Nasıl ilerleyelim?',
  '',
  '1. Doğum haritamı yorumla',
  '2. Haritam üzerinden bir konu soracağım',
  '3. Astrolojik bir kavramı öğrenmek istiyorum',
  '4. Yakında: transitler, Ay döngüleri ve horary',
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

const intentMenuKeyboard = Markup.keyboard([
  ['1 Doğum haritamı yorumla'],
  ['2 Haritam üzerinden bir konu soracağım'],
  ['3 Astrolojik bir kavramı öğrenmek istiyorum'],
  ['4 Yakında: transitler, Ay döngüleri ve horary'],
]).resize();

const topicKeyboard = Markup.keyboard([
  ['1 Genel özet'],
  ['2 İlişkiler'],
  ['3 İş / para / değerler'],
  ['4 İç dünya / duygular / aile'],
  ['5 İletişim / öğrenme / kendini ifade'],
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
  if (/yakında|transit|ay döngü|horary/.test(low) && !/[1-5]\s+genel/i.test(raw)) {
    return { ok: true, n: 4 };
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
  const low = raw.toLowerCase();
  if (low.includes('genel')) return { ok: true, code: 'general' };
  if (low.includes('ilişki')) return { ok: true, code: 'relationships' };
  if (low.includes('para') || low.includes('değer') || /\biş\b/.test(low) || low.includes(' kariyer'))
    return { ok: true, code: 'work_money' };
  if (low.includes('iç dünya') || low.includes('duygu') || low.includes('aile'))
    return { ok: true, code: 'inner_family' };
  if (low.includes('iletişim') || low.includes('öğrenme') || low.includes('ifade'))
    return { ok: true, code: 'communication_learning' };
  return { ok: false, error: 'Lütfen aşağıdaki düğmelerden birini seç veya 1–5 yaz.' };
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
  await ctx.reply('Sormaya devam edebilir veya menüden yeni bir akış seçebilirsin.', intentMenuKeyboard);
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
  await ctx.reply('Başka bir sorun olursa yazabilirsin; menü aşağıda.', intentMenuKeyboard);
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
  await ctx.reply(START_INTRO, intentMenuKeyboard);
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Komutlar:',
      '/start — menüyü ve oturumu sıfırlar (kayıtlı doğum profilin kalır).',
      '/help — bu mesaj',
      '/profile — kayıtlı doğum bilgilerini gösterir.',
      '/update_birth — doğum bilgilerini yeniden girersin.',
      '/reset — kayıtlı doğum profilini siler ve sohbeti sıfırlar.',
      '',
      'Menüden seçebilir veya doğrudan astroloji sorusu yazabilirsin.',
      'Kişisel yorum için doğum bilgisi ve harita gerekir; bir kez kaydettikten sonra tekrar sormamaya çalışırım. Kavram sorularında genel bilgi verilir.',
    ].join('\n')
  );
});

bot.command('profile', async (ctx) => {
  const uid = ctx.from.id;
  const p = userProfileStore.getProfile(uid);
  if (!userProfileStore.isProfileComplete(p)) {
    await ctx.reply(
      'Henüz kayıtlı doğum profilin yok. Menüden "1" veya "2" ile doğum bilgilerini ekleyebilir veya kişisel bir soru yazarak akışı başlatabilirsin.'
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
    ['Kayıtlı doğum profilin silindi. Yeniden kaydetmek için menüden "1" veya "2" ile ilerleyebilirsin.', '', START_INTRO].join(
      '\n'
    ),
    intentMenuKeyboard
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
            lastChartData: prof.lastChartData ? cloneJson(prof.lastChartData) : null,
            ...sessionFieldsFromProfile(prof),
          });
          logger.info(`Niyet:1 kayıtlı profil user_id=${uid}`);
          await ctx.reply(
            [
              'Kayıtlı doğum bilgilerinle devam ediyorum.',
              'Hangi konuda odaklanayım? Aşağıdan seç veya 1–5 yaz:',
            ].join('\n'),
            topicKeyboard
          );
          return;
        }
        sessionStore.set(uid, {
          step: 'await_date',
          intent: 'chart',
          topicCodePreset: null,
          pendingFreeformPersonal: null,
        });
        logger.info(`Niyet:1 harita yorumu user_id=${uid}`);
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
        });
        logger.info(`Niyet:2 önce konu user_id=${uid}`);
        await ctx.reply(
          'Önce hangi temada haritandan ilerleyelim? Aşağıdan seç veya 1–5 yaz:',
          topicKeyboard
        );
        return;
      }
      if (pi.n === 3) {
        sessionStore.set(uid, { step: 'await_concept', intent: 'concept' });
        logger.info(`Niyet:3 kavram user_id=${uid}`);
        await ctx.reply(
          'Merak ettiğin kavramı veya terimi kısaca yaz. Örnek: "Yükselen burç nedir?", "Satürn retrosu ne anlama gelir?"',
          Markup.removeKeyboard()
        );
        return;
      }
      if (pi.n === 4) {
        logger.info(`Niyet:4 yakında user_id=${uid}`);
        await ctx.reply('Bu özellik yakında eklenecek.', intentMenuKeyboard);
        return;
      }
    }

    const cls = messageClassifier.classifyMessage(text);
    logger.info(`Sınıflandırma user_id=${uid} category=${cls.category} reason=${cls.reason}`);

    if (cls.category === 'normal_flow') {
      await ctx.reply(
        'Menüden 1–4 ile seçebilir veya astrolojiyle ilgili bir kavram sorabilirsin. Örnek: “Yükselen ne demek?” veya “7. ev nedir?”',
        intentMenuKeyboard
      );
      return;
    }
    if (cls.category === 'risky_question') {
      await ctx.reply(MSG_RISKY_BOUNDARY, intentMenuKeyboard);
      return;
    }
    if (cls.category === 'unsupported_transit_or_future') {
      await ctx.reply(MSG_UNSUPPORTED, intentMenuKeyboard);
      return;
    }
    if (cls.category === 'personal_chart_question') {
      const resolved = resolveChartForUser(uid, s);
      if (resolved.chart) {
        if (resolved.usedSavedProfile) {
          await ctx.reply(MSG_SAVED_PROFILE_HINT, intentMenuKeyboard);
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
          logger.error(`Serbest kişisel yorum hatası user_id=${uid}`, e);
          await ctx.reply(USER_SOFT_ERROR, intentMenuKeyboard);
        }
        await ctx.reply('Sormaya devam edebilirsin.', intentMenuKeyboard);
        return;
      }
      sessionStore.set(uid, {
        ...sessionStore.get(uid),
        step: 'await_date',
        intent: 'freeform_personal',
        pendingFreeformPersonal: text,
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
      logger.info(`Serbest kişisel soru -> doğum toplama user_id=${uid}`);
      await ctx.reply(
        'Kişisel bakabilmem için doğum bilgilerine ihtiyacım var. Doğum tarihini yazar mısın? (örn: 1998-07-07 veya 7.7.1998)',
        Markup.removeKeyboard()
      );
      return;
    }

    if (cls.category === 'general_astro_knowledge' && cls.reason === 'birth_time_faq') {
      await ctx.reply(MSG_BIRTH_TIME_FAQ, intentMenuKeyboard);
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
      logger.error(`Genel sohbet Groq user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR, intentMenuKeyboard);
      return;
    }
    await ctx.reply('Başka sorun olursa yaz; menü hâlâ geçerli.', intentMenuKeyboard);
    return;
  }

  if (step === 'await_topic_preset') {
    const tp = parseTopicCode(text);
    if (!tp.ok) {
      await ctx.reply(tp.error, topicKeyboard);
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
      logger.error(`Genel kavram hatası user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR);
      sessionStore.reset(uid);
      sessionStore.set(uid, { step: 'await_intent', lastChartData: preservedChart || null });
      await ctx.reply(START_INTRO, intentMenuKeyboard);
      return;
    }
    const parts = chunkTelegram(out);
    for (const part of parts) {
      await ctx.reply(part);
    }
    sessionStore.reset(uid);
    sessionStore.set(uid, { step: 'await_intent', lastChartData: preservedChart || null });
    logger.info(`Genel kavram yanıtı gönderildi user_id=${uid}`);
    await ctx.reply('Başka bir şey için menüden seçebilir veya soru yazabilirsin:', intentMenuKeyboard);
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
      `Veri toplama: doğum saati user_id=${uid} has_time=${hasKnownBirthTime} preset_topic=${full.topicCodePreset || 'none'} freeform=${Boolean(full.pendingFreeformPersonal)}`
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

    sessionStore.set(uid, { ...full, step: 'await_topic' });
    await ctx.reply(
      [modeMsg, '', 'Şimdi hangi konuda odaklanayım? Aşağıdan seç veya 1–5 yaz:'].join('\n'),
      topicKeyboard
    );
    return;
  }

  if (step === 'await_topic') {
    const tp = parseTopicCode(text);
    if (!tp.ok) {
      await ctx.reply(tp.error, topicKeyboard);
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
