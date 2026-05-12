/**
 * Genel astroloji kavramları (kişisel harita yok). Groq ile kısa, güvenilir ton.
 */

const Groq = require('groq-sdk');
const logger = require('./logger');

const REFERENCE_CORE = [
  'Referans (genel kabul, kısaltılmış):',
  'Güneş: kimlik, yaşam enerjisi, temel motivasyon.',
  'Ay: duygu, güven ihtiyacı, iç dünya.',
  'Merkür: zihin, iletişim, öğrenme.',
  'Venüs: ilişki tarzı, değerler, estetik, çekim.',
  'Mars: irade, hareket, arzu, mücadele.',
  'Jüpiter: büyüme, inanç, fırsat, genişleme.',
  'Satürn: sınır, sorumluluk, yapı, ders.',
  'Uranüs: değişim, özgürleşme, ani kırılım.',
  'Neptün: hayal, sezgi, belirsizlik, idealler.',
  'Plüton: dönüşüm, güç, kriz, derinleşme.',
  'Yükselen (ASC): dışa yansıyan tarz, hayata yaklaşım.',
  'MC: kariyer yönü, görünür hedef.',
  'Evler: hayat alanları (1–12).',
  'Açılar: gezegenler arası dinamik (ör. kare, üçgen, kavuşum).',
].join('\n');

function buildGeneralSystemPrompt() {
  return [
    'Sen bir astroloji eğitmenisin.',
    'Yalnızca genel, bilgilendirici ve sade Türkçe ile cevap ver.',
    'Kullanıcının doğum haritası YOK: "senin haritanda", "sana özel", "sende kesin" gibi kişisel yorum yapma.',
    'Bilmediğin veya tartışmalı bir detayı uydurma; emin değilsen kısaca belirt.',
    'Klasik falcı veya aşırı mistik dil kullanma.',
    'Kesin kehanet, sağlık tanısı, yatırım tavsiyesi, ilişki garantisi verme.',
    'Markdown kullanma; düz metin.',
    '',
    REFERENCE_CORE,
    '',
    'Yanıt yapısı (kısa tut):',
    '1) Bir cümlelik düz açıklama.',
    '2) Astrolojik anlam (genel çerçeve).',
    '3) İsteğe bağlı: günlük hayatta nasıl düşünülebileceğine dair tek cümle (kesin sonuç değil).',
    'Kişisel harita istenirse sonuna şunu ekle: "Kendi haritanda bu temanın nasıl işlediğini görmek için doğum tarihi, yer ve mümkünse saat gerekir."',
  ].join('\n');
}

function logGroqErr(ctx, err) {
  logger.error(`${ctx} (Groq astroKnowledge)`, err);
  if (err && typeof err === 'object') {
    if (err.status) logger.error(`${ctx} HTTP`, err.status);
    if (err.message) logger.error(`${ctx} mesaj`, err.message);
  }
}

/**
 * @param {string} userQuestion
 * @param {string} apiKey
 * @param {string} model
 */
async function answerGeneralConcept(userQuestion, apiKey, model) {
  const q = String(userQuestion || '').trim();
  if (q.length < 2) throw new Error('QUESTION_TOO_SHORT');

  logger.info('Groq: genel kavram (astroKnowledge) başladı');

  const client = new Groq({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.5,
      max_tokens: 650,
      messages: [
        { role: 'system', content: buildGeneralSystemPrompt() },
        { role: 'user', content: `Soru:\n${q}` },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      logger.warn('Groq: genel kavram boş');
      throw new Error('EMPTY_REPLY');
    }
    logger.info('Groq: genel kavram (astroKnowledge) bitti');
    return text;
  } catch (e) {
    logGroqErr('Genel kavram', e);
    throw e;
  }
}

module.exports = { answerGeneralConcept };
