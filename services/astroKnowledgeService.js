/**
 * Genel astroloji bilgisi: önce kontrollü sözlük eşlemesi, gerekirse Groq ile tamamlama.
 * Kişisel harita yok; kişisel iddia ve kesin kehanet yok.
 */

const Groq = require('groq-sdk');
const logger = require('./logger');

const CHART_NOTE =
  'Kendi haritanda bu temanın nasıl işlediğini görmek için doğum tarihi, yer ve mümkünse saat gerekir.';

/** @typedef {{ id: string, kind: string, labels: string[], title: string, definition: string, astro: string, daily: string }} GlossEntry */

/** @type {GlossEntry[]} */
const GLOSSARY = [];

function entry(kind, id, labels, title, definition, astro, daily) {
  GLOSSARY.push({ kind, id, labels: labels.map((l) => l.toLowerCase()), title, definition, astro, daily });
}

/* Gezegenler */
entry(
  'planet',
  'sun',
  ['güneş', 'gunes'],
  'Güneş',
  'Haritada “benlik çekirdeği” olarak okunan temel ışık noktasıdır.',
  'Kimlik, yaşam enerjisi, bilinçli motivasyon ve “nereye doğuyorum?” hissiyle ilişkilendirilir.',
  'Kendini nerede görünür kıldığın, gurur duyduğun ve ileri gitmek istediğin alanlarda Güneş teması sıkça hissedilir.'
);
entry(
  'planet',
  'moon',
  ['ay'],
  'Ay',
  'Duygusal ihtiyaçları ve iç ritmi temsil eden hızlı hareket eden gök cismidir.',
  'Duygular, güven ihtiyacı, iç dünya, alışkanlıklar ve “rahatladığım yer” ile ilişkilidir.',
  'Stres anında neye sarıldığın, nerede beslendiğin ve duygusal olarak neyin “ev” saydığın Ay ile okunur.'
);
entry(
  'planet',
  'mercury',
  ['merkür', 'merkur'],
  'Merkür',
  'Zihin, sözcükler ve bağlantıları temsil eder.',
  'İletişim, öğrenme, merak, analiz ve kısa mesafeli hareketlilikle ilişkilidir.',
  'Konuşma tarzın, öğrenme yöntemin ve günlük kararlarda “nasıl düşünüyorum?” sorusu Merkür alanıdır.'
);
entry(
  'planet',
  'venus',
  ['venüs', 'venus'],
  'Venüs',
  'Çekim ve uyum arayan gezegendir.',
  'İlişki tarzı, değerler, estetik, haz ve “neye yakın hissediyorum?” ile ilişkilidir.',
  'Sevgi dili, zevklerin, para-har vurgusu (değer) ve sosyal uyum Venüs üzerinden okunur.'
);
entry(
  'planet',
  'mars',
  ['mars'],
  'Mars',
  'İrade ve hareketi temsil eder.',
  'Cesaret, mücadele, arzu, sinir ve “nerede ileri atılıyorum?” ile ilişkilidir.',
  'Sinirlendiğinde ne yaptığın, rekabet ettiğin alan ve cinsel enerjinin “motoru” Mars’ta aranır.'
);
entry(
  'planet',
  'jupiter',
  ['jüpiter', 'jupiter'],
  'Jüpiter',
  'Genişleme ve anlam arayışını temsil eder.',
  'Büyüme, inanç, fırsat, iyimserlik ve öğretmen/mentor temasıyla ilişkilidir.',
  'Risk alma payın, hayata anlam katma biçimin ve “daha fazlası” isteği Jüpiter ile okunur.'
);
entry(
  'planet',
  'saturn',
  ['satürn', 'saturn'],
  'Satürn',
  'Sınır ve olgunlaşma gezegenidir.',
  'Sorumluluk, yapı, zaman, sabır ve “hayatın ciddi dersleri” ile ilişkilidir.',
  'Erteleme, disiplin, sınırlar koyma ve uzun vadeli hedefler Satürn alanında görülür.'
);
entry(
  'planet',
  'uranus',
  ['uranüs', 'uranus'],
  'Uranüs',
  'Beklenmedik kırılmalar ve özgürleşmeyi temsil eder.',
  'Değişim, özgürleşme, ani dönüşüm ve bireyselleşme ile ilişkilidir.',
  'Sıkıldığın kurallar, ani kararlar ve “farklı olma” ihtiyacı Uranüs temasıdır.'
);
entry(
  'planet',
  'neptune',
  ['neptün', 'neptun'],
  'Neptün',
  'Sınırların eridiği, imgelerin güçlü olduğu gezegendir.',
  'Sezgi, hayal, belirsizlik, merhamet ve idealler ile ilişkilidir.',
  'Hayal kırıklıkları, ilham, kaçış isteği ve “net olmayan” konular Neptün’de yoğunlaşır.'
);
entry(
  'planet',
  'pluto',
  ['plüton', 'pluton'],
  'Plüton',
  'Güç ve dönüşümün derin katmanlarını temsil eder.',
  'Kriz, kontrol-serbest bırakma, tabulaşma ve yoğun yenilenme ile ilişkilidir.',
  'Bırakamadığın konular, güç dinamikleri ve radikal değişim ihtiyacı Plüton alanıdır.'
);

/* Burçlar */
const SIGNS = [
  ['aries', ['koç'], 'Koç', 'Öncü ateş burcudur.', 'Başlatma, cesaret, doğrudanlık ve “ilk adım” enerjisi.', 'Yeni projelere sıçrama, rekabet ve acelecilik temaları.'],
  ['taurus', ['boğa', 'boga'], 'Boğa', 'Sabit toprak burcudur.', 'Güvenlik, duyular, maddi istikrar ve sabırlı ilerleme.', 'Rutin, beden, kaynak yönetimi ve değişime direnç.'],
  ['gemini', ['ikizler'], 'İkizler', 'Değişken hava burcudur.', 'Merak, çoklu ilgi, iletişim ve zihinsel çeviklik.', 'Sosyal ağ, öğrenme, kısa yolculuklar ve dağınıklık riski.'],
  ['cancer', ['yengeç', 'crab'], 'Yengeç', 'Öncü su burcudur.', 'Duygusal güven, ait olma, koruma ve içgüdü.', 'Aile, yuva, besleyicilik ve hassasiyet.'],
  ['leo', ['aslan'], 'Aslan', 'Sabit ateş burcudur.', 'Özgüven, yaratıcılık, sahne ve kalpten bağlılık.', 'Görünürlük, liderlik ve onay ihtiyacı dengesi.'],
  ['virgo', ['başak', 'basak'], 'Başak', 'Değişken toprak burcudur.', 'Düzen, hizmet, eleştirel zihin ve iyileştirme.', 'Detay, sağlık rutinleri ve mükemmeliyetçilik.'],
  ['libra', ['terazi'], 'Terazi', 'Öncü hava burcudur.', 'Denge, adalet, ilişkide uyum ve estetik.', 'Diplomasi, kararsızlık ve “ikilik” temaları.'],
  ['scorpio', ['akrep'], 'Akrep', 'Sabit su burcudur.', 'Derinlik, bağlılık, gizem ve dönüşüm.', 'Güven, kontrol, intikam değil dönüşüm okumaları tercih edilir.'],
  ['sagittarius', ['yay'], 'Yay', 'Değişken ateş burcudur.', 'Arayış, inanç, özgürlük ve geniş ufuk.', 'Seyahat, felsefe, öğretme ve abartı.'],
  ['capricorn', ['oğlak', 'oglak'], 'Oğlak', 'Öncü toprak burcudur.', 'Hedef, statü, disiplin ve zaman içinde inşa.', 'Kariyer basamakları, sorumluluk ve mesafe.'],
  ['aquarius', ['kova'], 'Kova', 'Sabit hava burcudur.', 'Özgün düşünce, topluluk, ideal ve sistem eleştirisi.', 'Arkadaşlık, teknoloji ve “kurala meydan okuma”.'],
  ['pisces', ['balık', 'balik'], 'Balık', 'Değişken su burcudur.', 'Empati, hayal, spiritüel açık ve sınır esnekliği.', 'Sanat, fedakarlık ve kaçış/ kurban rolü farkındalığı.'],
];
for (const [id, labs, title, def, astro, daily] of SIGNS) {
  entry('sign', id, labs, title, def, astro, daily);
}

/* Evler (kısa) */
const HOUSES = [
  [1, 'Birinci ev', 'Yükselenle bağlantılı “ben” alanı ve vitrin.', 'Beden imajı, yaklaşım tarzı, yeni başlangıçlar.', 'İnsanlar seni ilk nasıl görüyor, hangi enerjiyle öne çıkıyorsun.'],
  [2, 'İkinci ev', 'Kaynaklar ve değerler evi.', 'Para, yetenek, maddi güvenlik ve “neye değer veriyorum?”.', 'Kazanç biçimi, harcama alışkanlıkları ve özsaygı.'],
  [3, 'Üçüncü ev', 'Yakın çevre ve zihin evi.', 'Kardeş, komşu, kısa yolculuk, temel eğitim, yazılı-sözlü iletişim.', 'Günlük konuşmalar, merak ve öğrenme tarzı.'],
  [4, 'Dördüncü ev', 'Kökler ve özel alan.', 'Aile, yuva, içsel temel ve geçmiş.', 'Hissettiğin güvenli liman, ev ortamı.'],
  [5, 'Beşinci ev', 'Yaratıcı ifade ve keyif.', 'Aşk, hobiler, çocuklar, riskli eğlence ve sahne.', 'Flört, sanat, oyun ve “neyle eğleniyorum?”.'],
  [6, 'Altıncı ev', 'Günlük düzen ve hizmet.', 'İş rutini, sağlık alışkanlıkları, hizmet ve detay.', 'Verimlilik, meslektaşlar ve beden bakımı.'],
  [7, 'Yedinci ev', 'Karşıtlık ve ortaklık evi.', 'Evlilik, iş ortaklığı, danışmanlık ve birebir ilişkiler; yalnızca romantik değil.', 'Sözleşmeler, hukuki eş, açık düşmanlık okumaları da bu alana bağlanır.'],
  [8, 'Sekizinci ev', 'Ortak kaynak ve dönüşüm.', 'Miras, borç, ortak finans, cinsellik derinliği, kriz.', 'Güven, paylaşım ve “birleşerek dönüşme” temaları.'],
  [9, 'Dokuzuncu ev', 'Geniş ufuk ve inanç.', 'Yüksek öğrenim, yurt dışı, hukuk felsefesi, yayıncılık.', 'Anlam arayışı, seyahat ve öğretmen figürleri.'],
  [10, 'Onuncu ev', 'Kamusal görünürlük ve kariyer.', 'Statü, meslek, toplumsal rol ve hedef.', 'Ne işle tanındığın, uzun vadeli başarı tanımın.'],
  [11, 'On birinci ev', 'Arkadaşlık ve gelecek projeler.', 'Gruplar, idealler, teknoloji ve kolektif umut.', 'Takım çalışması ve topluluk içindeki yerin.'],
  [12, 'On ikinci ev', 'Gizli ve bilinçdışı alan.', 'İzolasyon, hayal, spiritüel kapanış, gizli düşmanlar (klasik okuma).', 'Dinlenme ihtiyacı, sanat, gönüllülük ve sınırları netleştirme.'],
];
for (const [num, title, def, astro, daily] of HOUSES) {
  entry('house', `house_${num}`, [`${num}. ev`, `${num} ev`, `${num}.ev`], title, def, astro, daily);
}

/* Açılar */
entry(
  'aspect',
  'conjunction',
  ['kavuşum', 'konjunk'],
  'Kavuşum',
  'İki gök cisminin aynı burçta birleşmesidir (toleransla).',
  'Temaların yoğun biçimde karışması; güç veya baskınlık hissi verebilir.',
  'İki ihtiyacın aynı anda devreye girmesi; hangi gezegenler olduğuna göre anlam değişir.'
);
entry(
  'aspect',
  'opposition',
  ['karşıt', 'karşıtlık', 'oppos'],
  'Karşıtlık',
  '180° civarı açı; zıt burçlar ekseninde gerilim ve farkındalık.',
  'Denge arayışı, başkasını ayna olarak görme ve gerilimden öğrenme.',
  'İlişkilerde çekişme ve tamamlayıcılık bir arada okunabilir.'
);
entry(
  'aspect',
  'trine',
  ['üçgen', 'trin'],
  'Üçgen (trigon)',
  '120° civarı uyumlu açıdır.',
  'Akış, destek ve doğal yetenek; kolaylaşan alanlar.',
  'Kullanılmazsa “tembel” kalabilir; bilinçli kullanım önemlidir.'
);
entry(
  'aspect',
  'square',
  ['kare'],
  'Kare',
  '90° civarı gerilim açısıdır.',
  'Gerilim, büyüme için zorlanma ve farklı ihtiyaçların çatışması.',
  'Pratikte iç/dış engeller üzerinden beceri geliştirme temasıdır.'
);
entry(
  'aspect',
  'sextile',
  ['sekstil'],
  'Sekstil',
  '60° civarı fırsat açısıdır.',
  'Geliştirilmeyi bekleyen uyum; küçük çaba ile açılan kapılar.',
  'İletişim ve iş birliğiyle ilerleme.'
);
entry(
  'aspect',
  'quincunx',
  ['dizilim', 'quincunx'],
  'Dizilim (inkonjans)',
  '150° civarı uyumsuzluk açısıdır.',
  'Uyarlama, mikro ayar ve sağlık/rutin gibi ince düzeltmeler.',
  'İki alanın birbirine “uymaması”ndan kaynaklı stres.'
);

entry(
  'point',
  'asc',
  ['yükselen', 'asc', 'doğum haritası yükseleni', 'dogum haritasi yukseleni'],
  'Yükselen (ASC)',
  'Haritanın doğu ufkunda yükselen burç derecesidir; saat ve yer gerektirir.',
  'Dışa yansıyan tarz, hayata yaklaşım ve “ilk izlenim” ile ilişkilidir.',
  'Yeni ortamlarda otomatikleşen tavır ve savunma tarzı burada aranır.'
);
entry(
  'point',
  'mc',
  ['mc', 'gökyüzü tepe', 'gokyuzu tepe', 'tepe noktası', 'tepe nokta'],
  'MC (Gökyüzü tepesi)',
  'Haritanın en yüksek noktasına yakın burç eksenidir; tam konum için saat ve yer gerekir.',
  'Kariyer yönü, toplumsal görünür hedef ve “neye tanınıyorum?” sorusu.',
  'İş kimliği ve uzun vadeli hedefler MC ekseniyle okunur.'
);

entry(
  'technique',
  'retro',
  ['retro', 'retrograd', 'retrosu', 'retro hareket'],
  'Retro hareket',
  'Gök cisminin dünya üzerinden geriye gidiyormuş gibi görünmesidir.',
  'Sembolik olarak yeniden gözden geçirme, yavaşlama ve içselleştirme teması verilir (kesin yaşam olayı değil).',
  'İletişim (Merkür), ilişki değerleri (Venüs) gibi alanlarda “ikinci tur” farkındalığı sık anlatılır.'
);

entry(
  'element',
  'fire',
  ['ateş elementi', 'ateş burçları'],
  'Ateş elementi',
  'Koç, Aslan, Yay burçlarını kapsar.',
  'İlham, hareket, cesaret ve hızlı başlatma enerjisi.',
  'İnisiyatif ve risk alma; sabır ve detayda denge gerekir.'
);
entry(
  'element',
  'earth',
  ['toprak elementi', 'toprak burçları'],
  'Toprak elementi',
  'Boğa, Başak, Oğlak burçlarını kapsar.',
  'Somutlaştırma, güvenlik, beceri ve zaman içinde inşa.',
  'Pratik sonuç, maddi düzen ve dayanıklılık.'
);
entry(
  'element',
  'air',
  ['hava elementi', 'hava burçları'],
  'Hava elementi',
  'İkizler, Terazi, Kova burçlarını kapsar.',
  'Fikir, sosyal bağ, kavramlar ve mesafe.',
  'Söylem, analiz ve ilişkide zihinsel uyum.'
);
entry(
  'element',
  'water',
  ['su elementi', 'su burçları'],
  'Su elementi',
  'Yengeç, Akrep, Balık burçlarını kapsar.',
  'Duygu, empati, içsel derinlik ve bellek.',
  'Yakınlık ihtiyacı ve sınır yönetimi önemlidir.'
);

entry(
  'quality',
  'cardinal',
  ['öncü burç', 'oncu burc', 'kardinal'],
  'Öncü (kardinal) nitelik',
  'Koç, Yengeç, Terazi, Oğlak burçlarını kapsar.',
  'Başlatma, mevsim değişimi ve yeni döngülerde öne çıkma.',
  'Liderlik ve acelecilik dengesi.'
);
entry(
  'quality',
  'fixed',
  ['sabit burç'],
  'Sabit nitelik',
  'Boğa, Aslan, Akrep, Kova burçlarını kapsar.',
  'Sürdürme, sadakat, direnç ve ısrar.',
  'Değişime direnç ve güçlü odaklanma.'
);
entry(
  'quality',
  'mutable',
  ['değişken burç', 'degisken burc'],
  'Değişken nitelik',
  'İkizler, Başak, Yay, Balık burçlarını kapsar.',
  'Uyum sağlama, esneklik ve çok yönlülük.',
  'Dağınıklık ve kararsızlık riski; çoklu ilgi.'
);

function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

/**
 * Uzun etiketler önce eşlensin (ör. "7. ev" "7"den önce).
 * @param {string} raw
 * @returns {GlossEntry[]}
 */
function findGlossaryMatches(raw) {
  const t = normalizeForMatch(raw);
  if (t.length < 2) return [];

  /** @type {GlossEntry[]} */
  const hits = [];
  const seen = new Set();

  const sorted = [...GLOSSARY].sort((a, b) => {
    const la = Math.max(...a.labels.map((x) => x.length));
    const lb = Math.max(...b.labels.map((x) => x.length));
    return lb - la;
  });

  for (const g of sorted) {
    for (const lab of g.labels) {
      const n = normalizeForMatch(lab);
      if (n.length >= 2 && t.includes(n)) {
        if (!seen.has(g.id)) {
          seen.add(g.id);
          hits.push(g);
        }
        break;
      }
    }
  }
  return hits;
}

const PLANET_ORDER = {
  sun: 0,
  moon: 1,
  mercury: 2,
  venus: 3,
  mars: 4,
  jupiter: 5,
  saturn: 6,
  uranus: 7,
  neptune: 8,
  pluto: 9,
};

function sortCanonicalPlanets(arr) {
  return [...arr].sort((a, b) => (PLANET_ORDER[a.id] ?? 99) - (PLANET_ORDER[b.id] ?? 99));
}

/**
 * @param {GlossEntry[]} hits
 * @param {string} userQuestion
 * @returns {string|null}
 */
function tryBuildGlossaryAnswer(hits, userQuestion) {
  if (!hits.length) return null;

  const q = normalizeForMatch(userQuestion);
  const hasAspect = hits.some((h) => h.kind === 'aspect');
  const planets = sortCanonicalPlanets(hits.filter((h) => h.kind === 'planet'));
  const houses = hits.filter((h) => h.kind === 'house');
  const signs = hits.filter((h) => h.kind === 'sign');
  const others = hits.filter((h) => !['planet', 'house', 'sign', 'aspect'].includes(h.kind));

  /** Venüs kare Satürn gibi bileşik */
  if (hasAspect && planets.length >= 2) {
    const asp = hits.find((h) => h.kind === 'aspect');
    const [p1, p2] = planets.slice(0, 2);
    const lines = [
      `${p1.title} ile ${p2.title} arasındaki ${asp.title.toLowerCase()} açısı genelde şöyle okunur: ${asp.astro}`,
      `${p1.title}: ${p1.astro}`,
      `${p2.title}: ${p2.astro}`,
      `Günlük hayatta: ${asp.daily} ${p1.daily} ${p2.daily}`.replace(/\s+/g, ' ').trim(),
      CHART_NOTE,
    ];
    return lines.join('\n\n');
  }

  if (hasAspect && planets.length === 1) {
    const asp = hits.find((h) => h.kind === 'aspect');
    const p = planets[0];
    return [
      `${p.title} ile ilgili bir ${asp.title.toLowerCase()} bağlantısı sorduğunda, önce ${asp.title.toLowerCase()}nin anlamı: ${asp.definition} ${asp.astro}`,
      `${p.title} ise: ${p.astro}`,
      `Günlük hayatta: ${p.daily} ${asp.daily}`,
      CHART_NOTE,
    ].join('\n\n');
  }

  if (hasAspect && planets.length === 0) {
    const asp = hits.find((h) => h.kind === 'aspect');
    return [
      `${asp.title}: ${asp.definition}`,
      `Astrolojide: ${asp.astro}`,
      `Günlük hayatta: ${asp.daily}`,
      CHART_NOTE,
    ].join('\n\n');
  }

  if (houses.length === 1 && planets.length === 0 && !hasAspect) {
    const h = houses[0];
    return [
      `${h.title} astrolojide ${h.definition} ${h.astro}`,
      `Günlük hayatta: ${h.daily}`,
      `Senin ${h.title.toLowerCase()}inin haritanda nasıl işlediğini görmek için doğum haritana bakmam gerekir.`,
    ].join('\n\n');
  }

  if (planets.length === 1 && houses.length === 1 && !hasAspect) {
    const p = planets[0];
    const h = houses[0];
    return [
      `${p.title} gezegeni ${h.title.toLowerCase()}de (genel çerçevede) ${p.astro.toLowerCase()} Bu ev alanı ise ${h.astro.toLowerCase()}`,
      `Günlük hayatta: ${p.daily} ${h.daily}`,
      CHART_NOTE,
    ].join('\n\n');
  }

  if (planets.length === 1 && !houses.length && !hasAspect) {
    const p = planets[0];
    return [
      `${p.title}: ${p.definition}`,
      `Astrolojide: ${p.astro}`,
      `Günlük hayatta: ${p.daily}`,
      CHART_NOTE,
    ].join('\n\n');
  }

  if (signs.length === 1 && planets.length === 0 && !houses.length && !hasAspect) {
    const s = signs[0];
    return [
      `${s.title} burcu: ${s.definition}`,
      `Astrolojide: ${s.astro}`,
      `Günlük hayatta: ${s.daily}`,
      CHART_NOTE,
    ].join('\n\n');
  }

  if (others.length >= 1 && planets.length + houses.length + signs.length === 0 && !hasAspect) {
    const o = others[0];
    return [
      `${o.title}: ${o.definition}`,
      `Astrolojide: ${o.astro}`,
      `Günlük hayatta: ${o.daily}`,
      CHART_NOTE,
    ].join('\n\n');
  }

  /* Çoklu isabet: özet birleştir */
  if (hits.length >= 2 && (planets.length + signs.length + houses.length >= 2 || hits.length <= 4)) {
    const parts = hits.slice(0, 4).map((h) => `- ${h.title}: ${h.definition} (${h.astro})`);
    return [
      'Sorduğun terimler astrolojide şöyle özetlenir:',
      parts.join('\n'),
      CHART_NOTE,
    ].join('\n\n');
  }

  return null;
}

function buildCompactGlossaryForPrompt(maxChars = 12000) {
  const lines = GLOSSARY.map(
    (g) => `${g.title} [${g.kind}]: ${g.definition} | ${g.astro} | ${g.daily}`
  );
  let s = lines.join('\n');
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n...';
  return s;
}

function buildGeneralSystemPrompt() {
  return [
    'Sen bir astroloji eğitmenisin.',
    'Aşağıdaki SÖZLÜK maddeleri gerçeklere yakın referanstır; çelişirse sözlüğe uy, uydurma.',
    'Kullanıcının doğum haritası YOK: "senin haritanda", "sende kesin", "sana özel kesin" deme.',
    'Yükselen veya ev derecesi verilmeden kişisel ev/yükselen yorumu yapma.',
    'Bilmediğin veya desteklenmeyen konuda emin gibi konuşma; kısaca belirt.',
    'Kesin kehanet, sağlık tanısı, yatırım tavsiyesi, kesin evlilik/ayrılık/para kaybı verme.',
    'Markdown kullanma; düz metin.',
    '',
    'SÖZLÜK:',
    buildCompactGlossaryForPrompt(),
    '',
    'Yanıt yapısı (kısa):',
    '1) Kısa tanım.',
    '2) Astrolojide neyi temsil eder.',
    '3) Günlük hayatta nasıl düşünülebilir (kesin sonuç değil).',
    `4) Son cümle: "${CHART_NOTE}"`,
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

  const hits = findGlossaryMatches(q);
  const local = tryBuildGlossaryAnswer(hits, q);
  if (local && hits.length > 0) {
    const h0 = hits[0];
    const strong =
      hits.length >= 2 ||
      ['planet', 'house', 'aspect', 'point'].includes(h0.kind) ||
      hits.some((h) => h.kind === 'house');

    if (strong || h0.kind === 'sign' || h0.kind === 'element' || h0.kind === 'quality' || h0.kind === 'technique') {
      logger.info('Genel kavram: sözlük katmanı (deterministik) kullanıldı', { keys: hits.map((h) => h.id) });
      return local;
    }
  }

  logger.info('Groq: genel kavram (sözlük + model) başladı');

  const client = new Groq({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 700,
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
    logger.info('Groq: genel kavram bitti');
    return text;
  } catch (e) {
    logGroqErr('Genel kavram', e);
    throw e;
  }
}

module.exports = {
  answerGeneralConcept,
  findGlossaryMatches,
  tryBuildGlossaryAnswer,
  GLOSSARY,
};
