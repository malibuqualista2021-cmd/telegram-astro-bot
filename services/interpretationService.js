/**
 * AI yorum katmanı — Groq (chat completions). Yalnızca verilen chartData’ya dayanır.
 * GROQ_API_KEY uygulama açılışında doğrulanır; hata durumunda üst katmana fırlatılır.
 */

const Groq = require('groq-sdk');
const logger = require('./logger');
const astroKnowledgeService = require('./astroKnowledgeService');
const { sanitizeAiOutputOrThrow } = require('./sanitizeTurkishText');
const horaryPromptBuilder = require('./horaryPromptBuilder');

const TOPIC_LABEL_TR = {
  general: 'Genel özet',
  relationships: 'İlişkiler',
  work_money: 'İş, para, değerler',
  inner_family: 'İç dünya, duygular, aile',
  communication_learning: 'İletişim, öğrenme, kendini ifade',
};

function logGroqError(context, err) {
  logger.error(`${context} (Groq)`, err);
  if (err && typeof err === 'object') {
    if (err.status) logger.error(`${context} HTTP status`, err.status);
    if (err.message) logger.error(`${context} mesaj`, err.message);
    if (err.error) logger.error(`${context} error alanı`, err.error);
    if (err.code) logger.error(`${context} kod`, err.code);
  }
}

function buildGroqClient(apiKey) {
  return new Groq({ apiKey });
}

function buildSystemPrompt() {
  return [
    'Sen bir doğum haritası yorum asistanısın.',
    'SADECE mesajda verilen JSON (chartData) içindeki sayısal ve metinsel verilere dayan.',
    'JSON\'da olmayan gezegen derecesi, yükselen, ev, açı veya tema UYDURMA.',
    'Genel burç yorumu yazma: her cümle kullanıcının haritasındaki somut öğelere bağlansın.',
    'chart_mode "partial" ise yükselen, ev veya gezegen-ev yorumu yapma; data_availability kurallarına uy.',
    'Kesin kehanet, sağlık tanısı, yatırım tavsiyesi, ilişkinin biteceği gibi kesin hüküm verme.',
    '"Kesin olacak", "kaderin bu", "bu ilişki biter", "para kaybedeceksin" gibi ifadeleri kullanma.',
    'Türkçe, sade, samimi ve kısa yaz.',
    'Yanıtlarını yalnızca Türkçe yaz; sadece Türkçe Latin alfabesi kullan (ç, ğ, ı, İ, ö, ş, ü dahil).',
    'Kiril, Yunanca, Arapça, özel sembol veya bozuk Unicode kullanma.',
    'Latin harfine benzeyen Kiril harfleri (ör. а, е, о, р, с, у, х) asla kullanma; her zaman doğru Latin harfleri kullan.',
    'Çıktı temiz, okunabilir ve Telegram uyumlu olsun.',
    'Markdown veya özel biçim kullanma; düz metin, kısa başlık satırları için başında tire veya numara kullanabilirsin.',
    '',
    'Yanıtın bölümleri (bu sırayla, kısa tut):',
    '1) Mod: tam veya kısmi harita; kısmi ise yükselen/ev olmadığını bir cümleyle belirt.',
    '2) Ana tema: themes ve Güneş-Ay-(varsa Yükselen) ile 2-4 cümle.',
    '3) Seçilen konu başlığı altında 3-5 madde; her madde en az bir gezegen+burç ve tam modda mümkünse ev veya açı referansı içersin.',
    '4) İki kısa pratik öneri (davranış odaklı, kesin sonuç iddiası yok).',
    '5) Bir cümlelik güvenli hatırlatma: eğlence/farkındalık; uzman yerine geçmez.',
  ].join('\n');
}

function buildPersonalQuestionPrompt() {
  return [
    'Sen doğum haritası yorum asistanısın. Kullanıcının sorusuna YALNIZCA verilen JSON (chartData) ile cevap ver.',
    'chartData dışına çıkma; gezegen, yükselen, ev veya açı UYDURMA.',
    'chart_mode "partial" veya data_availability ile yükselen/ev kapalıysa bunlar hakkında yorum yapma.',
    'En az 2–3 somut harita öğesine bağlan (ör. Güneş+Ay+Venüs burcu, veya JSON\'daki bir açı; yalnızca veride varsa).',
    'Genel "X burcu şöyledir" cümleleri kullanma; her cümleyi bu haritaya bağla.',
    'chartData içinde listelenmeyen gezegen açısı veya ev konumu hakkında “var/yok/kare” gibi kesin iddia kullanma.',
    'Kesin kader, sağlık tanısı, yatırım tavsiyesi, ilişki kesinliği verme.',
    'Türkçe, sade, samimi ve kısa.',
    'Yanıtlarını yalnızca Türkçe yaz; sadece Türkçe Latin alfabesi kullan (ç, ğ, ı, İ, ö, ş, ü dahil).',
    'Kiril, Yunanca, Arapça, özel sembol veya bozuk Unicode kullanma.',
    'Latin harfine benzeyen Kiril harfleri (ör. а, е, о, р, с, у, х) asla kullanma.',
    'Markdown kullanma; düz metin.',
    '',
    'Yanıt yapısı:',
    '1) Kullanıcı sorusuna bir cümlelik doğrudan giriş.',
    '2) Haritadan destekleyen 2–4 kısa madde (somut etiket: gezegen+burç veya açı; tam modda ev mümkünse).',
    '3) Bir pratik davranış önerisi (kesin sonuç iddiası yok).',
    '4) Tek cümlelik hatırlatma: eğlence/farkındalık; uzman yerine geçmez.',
  ].join('\n');
}

async function answerPersonalQuestion(chartData, userQuestion, apiKey, model) {
  const q = String(userQuestion || '').trim();
  if (q.length < 2) throw new Error('QUESTION_TOO_SHORT');

  logger.info('Groq: kişisel serbest soru başladı', { model });

  const client = buildGroqClient(apiKey);
  const payload = JSON.stringify(chartData, null, 2);

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.55,
      max_tokens: 900,
      messages: [
        { role: 'system', content: buildPersonalQuestionPrompt() },
        {
          role: 'user',
          content: `Kullanıcı sorusu:\n${q}\n\nchartData (JSON):\n${payload}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      logger.warn('Groq: kişisel soru yanıtı boş');
      throw new Error('EMPTY_PERSONAL_REPLY');
    }
    logger.info('Groq: kişisel serbest soru bitti');
    return sanitizeAiOutputOrThrow(text, 'answerPersonalQuestion');
  } catch (e) {
    logGroqError('Groq kişisel soru', e);
    throw e;
  }
}

async function generateInterpretation(chartData, apiKey, model) {
  logger.info('Groq: harita yorumu başladı', {
    topic: chartData.interpretation_request?.topic_code,
    chart_mode: chartData.chart_mode,
    model,
  });

  const client = buildGroqClient(apiKey);

  const topicCode = chartData.interpretation_request?.topic_code || 'general';
  const topicLabel = TOPIC_LABEL_TR[topicCode] || topicCode;

  const userPayload = JSON.stringify(
    {
      chartData,
      topic_label_tr: topicLabel,
    },
    null,
    2
  );

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.65,
      max_tokens: 900,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: `Aşağıdaki JSON harita verisine göre yorum üret. Konu: ${topicLabel}.\n\n${userPayload}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      logger.warn('Groq: harita yorumu boş choices');
      throw new Error('EMPTY_INTERPRETATION');
    }
    logger.info('Groq: harita yorumu bitti');
    return sanitizeAiOutputOrThrow(text, 'generateInterpretation');
  } catch (e) {
    logGroqError('Groq harita yorumu', e);
    throw e;
  }
}

async function explainAstrologicalConcept(userQuestion, apiKey, model) {
  return astroKnowledgeService.answerGeneralConcept(userQuestion, apiKey, model);
}

async function summarizePreviousAnswer(previousAssistantText, latestUserMessage, apiKey, model) {
  const prev = String(previousAssistantText || '').trim();
  if (prev.length < 30) throw new Error('NOTHING_TO_SUMMARIZE');

  logger.info('Groq: önceki yanıt özetleme başladı', { model });
  const client = buildGroqClient(apiKey);
  const sys = [
    'Kullanıcı, asistanın bir önceki mesajını daha kısa ve anlaşılır istiyor.',
    'SADECE verilen "önceki_yanıt" metnini özetle ve sadeleştir; yeni gezegen, ev, burç, tarih, isim veya harita detayı UYDURMA.',
    'Astrolojik iddia veya kehanet ekleme; sadece metinde geçenleri daha net anlat.',
    'Türkçe, 4–10 kısa cümle veya madde; düz metin, markdown yok.',
    'Kesin kader, sağlık, hukuk, yatırım sonucu ekleme.',
  ].join('\n');

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 700,
      messages: [
        { role: 'system', content: sys },
        {
          role: 'user',
          content: `Kullanıcının son mesajı (isteği):\n${String(latestUserMessage || '').trim()}\n\nÖnceki yanıt:\n${prev}`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('EMPTY_SUMMARY');
    logger.info('Groq: önceki yanıt özetleme bitti');
    return sanitizeAiOutputOrThrow(text, 'summarizePreviousAnswer');
  } catch (e) {
    logGroqError('Groq özetleme', e);
    throw e;
  }
}

async function generateDirectChatReply(userMessage, apiKey, model, options = {}) {
  const hint = String(options.hint || '').trim().slice(0, 400);
  const ctx = String(options.contextSummary || '').trim().slice(0, 600);

  logger.info('Groq: doğal sohbet yanıtı başladı', { model });
  const client = buildGroqClient(apiKey);
  const sys = [
    'Sen sıcak ve sakin bir astroloji sohbet asistanısın.',
    'Kullanıcı mesajına doğal, kısa ve samimi yanıt ver (2–6 cümle).',
    'Astrolojik veri, harita, ev veya gezegen yerleşimi UYDURMA; kişisel harita için doğum bilgisi gerekir demeden, istersen nazikçe astrolojiye bağlan.',
    'Sağlık, hukuk, yatırım, kesin kader veya kesin ilişki sonucu verme.',
    'Türkçe Latin alfabesi; markdown yok.',
  ].join('\n');

  let userBlock = `Kullanıcı mesajı:\n${String(userMessage || '').trim()}`;
  if (ctx) userBlock += `\n\nBağlam özeti:\n${ctx}`;
  if (hint) userBlock += `\n\nİpucu (yönlendirme): ${hint}`;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.65,
      max_tokens: 450,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userBlock },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('EMPTY_DIRECT_REPLY');
    logger.info('Groq: doğal sohbet yanıtı bitti');
    return sanitizeAiOutputOrThrow(text, 'generateDirectChatReply');
  } catch (e) {
    logGroqError('Groq doğal sohbet', e);
    throw e;
  }
}

async function generateHoraryInterpretation(horaryChartData, apiKey, model) {
  logger.info('Groq: horary yorumu başladı', { model });
  const client = buildGroqClient(apiKey);
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.42,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: horaryPromptBuilder.buildHorarySystemPrompt() },
        { role: 'user', content: horaryPromptBuilder.buildHoraryUserPrompt(horaryChartData) },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      logger.warn('Groq: horary yanıtı boş');
      throw new Error('EMPTY_HORARY_REPLY');
    }
    logger.info('Groq: horary yorumu bitti');
    return sanitizeAiOutputOrThrow(raw, 'generateHoraryInterpretation');
  } catch (e) {
    logGroqError('Groq horary yorumu', e);
    throw e;
  }
}

module.exports = {
  generateInterpretation,
  answerPersonalQuestion,
  explainAstrologicalConcept,
  generateHoraryInterpretation,
  summarizePreviousAnswer,
  generateDirectChatReply,
  TOPIC_LABEL_TR,
};
