/**
 * AI yorum katmanı — Groq (chat completions). Yalnızca verilen chartData’ya dayanır.
 * GROQ_API_KEY uygulama açılışında doğrulanır; hata durumunda üst katmana fırlatılır.
 */

const Groq = require('groq-sdk');
const logger = require('./logger');
const astroKnowledgeService = require('./astroKnowledgeService');

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
    'Kesin kader, sağlık tanısı, yatırım tavsiyesi, ilişki kesinliği verme.',
    'Türkçe, sade, samimi ve kısa.',
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
    return text;
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
    return text;
  } catch (e) {
    logGroqError('Groq harita yorumu', e);
    throw e;
  }
}

async function explainAstrologicalConcept(userQuestion, apiKey, model) {
  return astroKnowledgeService.answerGeneralConcept(userQuestion, apiKey, model);
}

module.exports = {
  generateInterpretation,
  answerPersonalQuestion,
  explainAstrologicalConcept,
  TOPIC_LABEL_TR,
};
