const { loadEnv } = require('./config/env');
const env = loadEnv();

const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const logger = require('./services/logger');
const sessionStore = require('./services/sessionStore');
const chartCalculator = require('./services/chartCalculator');
const interpretationService = require('./services/interpretationService');

const USER_SOFT_ERROR =
  'Şu an yorum hazırlanırken küçük bir sorun oluştu. Lütfen biraz sonra tekrar dene.';

const GEOCODE_UA =
  env.GEOCODE_USER_AGENT || 'TelegramAstroMVP/1.0 (https://github.com/)';

const START_INTRO = [
  'Merhaba, ben kişisel astroloji asistanın.',
  'Doğum haritanı yorumlayabilir, haritan üzerinden bir konuyu inceleyebilir veya astrolojik bir kavramı sade şekilde açıklayabilirim.',
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

  return {
    ok: false,
    error: 'Lütfen 1–4 arasında bir seçenek yaz veya alttaki düğmelerden birine bas.',
  };
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
      env.OPENAI_API_KEY,
      env.OPENAI_MODEL
    );
  } catch (e) {
    logger.error(`AI yorum hatası user_id=${uid}`, e);
    await ctx.reply(USER_SOFT_ERROR, Markup.removeKeyboard());
    sessionStore.reset(uid);
    return;
  }

  const parts = chunkTelegram(interpretation);
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) await ctx.reply(parts[i], Markup.removeKeyboard());
    else await ctx.reply(parts[i]);
  }

  sessionStore.reset(uid);
  await ctx.reply('Yeni bir yorum için /start yazman yeterli.');
}

bot.start(async (ctx) => {
  logger.info(`Kullanıcı /start yazdı user_id=${ctx.from?.id}`);
  sessionStore.reset(ctx.from.id);
  sessionStore.set(ctx.from.id, { step: 'await_intent' });
  await ctx.reply(START_INTRO, intentMenuKeyboard);
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Komutlar:',
      '/start — ana menüden nasıl devam edeceğini seçersin.',
      '/help — bu mesaj',
      '',
      'Doğum haritası yorumu için verdiğin doğum bilgileriyle hesaplanan haritaya dayanır; genel burç metni değildir.',
      'Kavram seçeneğinde kişisel harita kullanılmaz, yalnızca genel bilgi verilir.',
    ].join('\n')
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
    if (!pi.ok) {
      await ctx.reply(pi.error, intentMenuKeyboard);
      return;
    }
    if (pi.n === 1) {
      sessionStore.set(uid, {
        step: 'await_date',
        intent: 'chart',
        topicCodePreset: null,
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

  if (step === 'await_topic_preset') {
    const tp = parseTopicCode(text);
    if (!tp.ok) {
      await ctx.reply(tp.error, topicKeyboard);
      return;
    }
    sessionStore.set(uid, {
      ...s,
      step: 'await_date',
      topicCodePreset: tp.code,
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
    let out;
    try {
      out = await interpretationService.explainAstrologicalConcept(
        text,
        env.OPENAI_API_KEY,
        env.OPENAI_MODEL
      );
    } catch (e) {
      logger.error(`Genel kavram hatası user_id=${uid}`, e);
      await ctx.reply(USER_SOFT_ERROR);
      sessionStore.reset(uid);
      sessionStore.set(uid, { step: 'await_intent' });
      await ctx.reply(START_INTRO, intentMenuKeyboard);
      return;
    }
    const parts = chunkTelegram(out);
    for (const part of parts) {
      await ctx.reply(part);
    }
    sessionStore.reset(uid);
    sessionStore.set(uid, { step: 'await_intent' });
    logger.info(`Genel kavram yanıtı gönderildi user_id=${uid}`);
    await ctx.reply('Başka bir şey için menüden seçebilirsin:', intentMenuKeyboard);
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
      `Veri toplama: doğum saati user_id=${uid} has_time=${hasKnownBirthTime} preset_topic=${full.topicCodePreset || 'none'}`
    );

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
