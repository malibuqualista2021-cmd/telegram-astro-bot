/**
 * AI yorum katmanı — sadece verilen chartData üzerinden metin üretir.
 * OPENAI_API_KEY uygulama açılışında doğrulanır; burada yalnızca API çağrısı yapılır.
 * Hata durumunda üst katmana fırlatılır (kullanıcı mesajı index.js’te).
 */

const OpenAI = require('openai');
const logger = require('./logger');

const TOPIC_LABEL_TR = {
  general: 'Genel özet',
  relationships: 'İlişkiler',
  work_money: 'İş, para, değerler',
  inner_family: 'İç dünya, duygular, aile',
  communication_learning: 'İletişim, öğrenme, kendini ifade',
};

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

function buildConceptSystemPrompt() {
  return [
    'Sen bir astroloji eğitmenisin. Kullanıcı bir kavram veya terim soruyor.',
    'Yalnızca genel, bilgilendirici ve sade Türkçe ile açıkla; doğum haritası veya kişisel yorum yapma.',
    '"Senin haritanda", "sana göre", burçları kişiselleştirerek anlatma.',
    'Klasik falcı veya aşırı mistik dil kullanma; modern ve güven veren bir ton kullan.',
    'Kısa tut (birkaç paragraf). Kesin kehanet, sağlık, yatırım veya ilişki garantisi verme.',
    'Markdown kullanma; düz metin.',
  ].join('\n');
}

async function generateInterpretation(chartData, apiKey, model) {
  logger.info('AI yorum üretimi başladı', {
    topic: chartData.interpretation_request?.topic_code,
    chart_mode: chartData.chart_mode,
  });

  const client = new OpenAI({ apiKey });

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
      logger.warn('AI yorum boş döndü');
      throw new Error('EMPTY_INTERPRETATION');
    }
    logger.info('AI yorum üretimi bitti');
    return text;
  } catch (e) {
    logger.error('AI yorum üretimi hata', e);
    throw e;
  }
}

/**
 * Kişisel harita olmadan yalnızca genel kavram açıklaması (OpenAI).
 */
async function explainAstrologicalConcept(userQuestion, apiKey, model) {
  const q = (userQuestion || '').trim();
  if (q.length < 2) {
    throw new Error('QUESTION_TOO_SHORT');
  }

  logger.info('Genel kavram açıklaması başladı');

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.55,
      max_tokens: 550,
      messages: [
        { role: 'system', content: buildConceptSystemPrompt() },
        {
          role: 'user',
          content: `Kullanıcının sorusu (yalnızca genel açıklama ver, kişisel harita yok):\n${q}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      logger.warn('Genel kavram yanıtı boş');
      throw new Error('EMPTY_CONCEPT_REPLY');
    }
    logger.info('Genel kavram açıklaması bitti');
    return text;
  } catch (e) {
    logger.error('Genel kavram açıklaması hata', e);
    throw e;
  }
}

module.exports = {
  generateInterpretation,
  explainAstrologicalConcept,
  TOPIC_LABEL_TR,
};
