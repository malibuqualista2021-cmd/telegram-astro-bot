/**
 * AI yorum katmanı — sadece verilen chartData üzerinden metin üretir.
 * OPENAI_API_KEY yoksa aynı veriye dayalı kısa şablon yanıt (MVP yedek).
 */

const OpenAI = require('openai');

const TOPIC_LABEL_TR = {
  general: 'Genel özet',
  relationships: 'İlişkiler',
  work_money: 'İş, para, değerler',
  inner_family: 'İç dünya, duygular, aile',
  communication_learning: 'İletişim, öğrenme, kendini ifade',
};

const SIGN_TR = {
  Aries: 'Koç',
  Taurus: 'Boğa',
  Gemini: 'İkizler',
  Cancer: 'Yengeç',
  Leo: 'Aslan',
  Virgo: 'Başak',
  Libra: 'Terazi',
  Scorpio: 'Akrep',
  Sagittarius: 'Yay',
  Capricorn: 'Oğlak',
  Aquarius: 'Kova',
  Pisces: 'Balık',
};

function trSign(s) {
  return SIGN_TR[s] || s;
}

function planet(chartData, id) {
  return chartData.planets.find((p) => p.id === id);
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

function buildFallback(chartData) {
  const mode = chartData.data_availability.chart_mode;
  const topic =
    TOPIC_LABEL_TR[chartData.interpretation_request?.topic_code] || 'Genel özet';
  const sun = planet(chartData, 'Sun');
  const moon = planet(chartData, 'Moon');
  const asc = chartData.angles?.ASC;

  const lines = [];
  lines.push(
    mode === 'full'
      ? 'Mod: Tam harita (Placidus evler ve yükselen hesaba katıldı).'
      : 'Mod: Kısmi harita (doğum saati olmadığı için yükselen ve ev yerleşimleri yok; Güneş, Ay ve gezegen burçları + açılar kullanıldı).'
  );

  const theme0 = chartData.themes?.items?.[0];
  lines.push('');
  lines.push('Ana tema:');
  if (theme0) {
    lines.push(`- ${theme0.description}`);
  }
  lines.push(
    `- Güneş ${trSign(sun.sign)} burcunda; Ay ${trSign(moon.sign)} burcunda.`
  );
  if (mode === 'full' && asc) {
    lines.push(`- Yükselen ${trSign(asc.sign)}.`);
  }

  lines.push('');
  lines.push(`${topic} (harita verisine dayalı kısa notlar):`);
  const picks = chartData.planets
    .filter((p) => ['Venus', 'Mars', 'Mercury', 'Saturn', 'Jupiter'].includes(p.id))
    .slice(0, 5);
  for (const p of picks) {
    const house = mode === 'full' && p.house ? `, ${p.house}. ev` : '';
    lines.push(`- ${p.id} ${trSign(p.sign)} burcunda${house}.`);
  }

  lines.push('');
  lines.push('Pratik:');
  lines.push('- Bugün için küçük bir nefes molası ve net bir cümleyle ihtiyaçlarını ifade etmeyi dene.');
  lines.push('- Konuşurken hem duygunu hem sınırını aynı cümlede taşımayı pratik et (zor gelirse tek cümle yeter).');

  lines.push('');
  lines.push(
    'Hatırlatma: Bu metin eğlence ve kişisel farkındalık içindir; tıbbi, hukuki veya finansal karar yerine geçmez.'
  );

  return lines.join('\n');
}

async function generateInterpretation(chartData) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return buildFallback(chartData);
  }

  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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
    if (!text) return buildFallback(chartData);
    return text;
  } catch (e) {
    console.error('OpenAI yorum hatası:', e.message);
    return buildFallback(chartData);
  }
}

module.exports = {
  generateInterpretation,
  TOPIC_LABEL_TR,
};
