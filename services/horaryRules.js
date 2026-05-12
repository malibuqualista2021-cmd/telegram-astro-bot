/**
 * Horary MVP: kategori, klasik ev yöneticileri, haritadan türetilen basit göstergeler.
 * Veri yoksa veya hesaplanmıyorsa alan bırakılır; uydurma yok.
 */

/** @typedef {'relationship'|'career'|'money'|'lost_item'|'home'|'communication'|'travel'|'legal'|'general'} HoraryCategory */

const SIGN_RULER_CLASSICAL = {
  aries: 'Mars',
  taurus: 'Venus',
  gemini: 'Mercury',
  cancer: 'Moon',
  leo: 'Sun',
  virgo: 'Mercury',
  libra: 'Venus',
  scorpio: 'Mars',
  sagittarius: 'Jupiter',
  capricorn: 'Saturn',
  aquarius: 'Saturn',
  pisces: 'Jupiter',
};

const RESTRICTED_RE =
  /\b(ölüm|ölecek|ölücek|hastalık|teşhis|tümör|kanser|hamile\s*misin|hamile\s*miyim|yatırım|hisse|bitcoin|dava\s*sonucu|mahkeme|hukuk|aldat|takıntı|stalk|sağlık|sağlığım|sağlığımda|ciddi\s+bir\s+şey)\b/i;

/**
 * @param {string} q
 * @returns {boolean}
 */
function isHoraryRestricted(q) {
  return RESTRICTED_RE.test(String(q || ''));
}

/**
 * @param {string} q
 * @returns {HoraryCategory}
 */
function classifyHoraryCategory(q) {
  const t = String(q || '').toLocaleLowerCase('tr-TR');
  if (/\b(kaybol|kayıp|bulunur|bulur\s*muyum|eşya|esyam)\b/i.test(t)) return 'lost_item';
  if (/\b(terfi|iş|kariyer|işimde|meslek|patron)\b/i.test(t)) return 'career';
  if (/\b(para|maaş|kazanç|zengin)\b/i.test(t)) return 'money';
  if (/\b(ev|aile|yuva|taşın)\b/i.test(t)) return 'home';
  if (/\b(mesaj|haber|iletişim|yaz|aran)\b/i.test(t)) return 'communication';
  if (/\b(seyahat|yolculuk|eğitim|okul|üniversite)\b/i.test(t)) return 'travel';
  if (/\b(dava|hukuk|mahkeme|sözleşme|anlaşma)\b/i.test(t)) return 'legal';
  if (/\b(ilişki|aşk|sevgili|evlen|evlilik|olur\s*mu|döner|dönecek|partner)\b/i.test(t)) return 'relationship';
  return 'general';
}

/** Soru evi (quesited): klasik horary eşlemesi (MVP) */
const CATEGORY_HOUSE = {
  relationship: 7,
  career: 10,
  money: 2,
  lost_item: 2,
  home: 4,
  communication: 3,
  travel: 9,
  legal: 7,
  general: 7,
};

function normSign(s) {
  return String(s || '').toLowerCase();
}

function classicalRulerForSign(signLabel) {
  const k = normSign(signLabel);
  return SIGN_RULER_CLASSICAL[k] || null;
}

function findPlanet(planets, id) {
  const want = String(id || '').toLowerCase();
  return (planets || []).find((p) => String(p.id || '').toLowerCase() === want) || null;
}

function ascEarlyLate(asc) {
  if (!asc || asc.degree_in_sign == null) return { early: false, late: false };
  const d = Number(asc.degree_in_sign);
  return { early: d < 3, late: d > 27 };
}

/**
 * @param {object} chart
 * @param {HoraryCategory} category
 */
function computeHoraryHints(chart, category) {
  const out = {
    category,
    quesited_house: CATEGORY_HOUSE[category] || 7,
    querent_significator: null,
    quesited_significator: null,
    moon: null,
    asc_early: false,
    asc_late: false,
    saturn_in_seventh: false,
    moon_void_of_course: null,
    moon_void_note: null,
    notable_aspects: [],
    data_notes: [],
  };

  const planets = chart.planets || [];
  const houses = chart.houses || [];
  const angles = chart.angles || {};
  const aspects = chart.aspects || [];

  const asc = angles.ASC;
  if (asc && asc.sign) {
    const rulerName = classicalRulerForSign(asc.sign);
    out.querent_significator = {
      role: 'querent',
      asc_sign: asc.sign,
      ruler_name: rulerName,
      ruler_body: rulerName ? findPlanet(planets, rulerName) : null,
    };
  }

  const qh = out.quesited_house;
  const houseCusp = houses.find((h) => h.number === qh);
  if (houseCusp && houseCusp.sign) {
    const r2 = classicalRulerForSign(houseCusp.sign);
    out.quesited_significator = {
      role: 'quesited',
      house: qh,
      cusp_sign: houseCusp.sign,
      ruler_name: r2,
      ruler_body: r2 ? findPlanet(planets, r2) : null,
    };
  }

  const moon = findPlanet(planets, 'Moon');
  if (moon) {
    out.moon = {
      sign: moon.sign,
      house: moon.house,
      longitude: moon.longitude,
      retrograde: moon.retrograde,
    };
  }

  if (asc) {
    const el = ascEarlyLate(asc);
    out.asc_early = el.early;
    out.asc_late = el.late;
  }

  const sat = findPlanet(planets, 'Saturn');
  if (sat && sat.house === 7) out.saturn_in_seventh = true;

  out.moon_void_of_course = null;
  out.moon_void_note =
    'Ayın void-of-course durumu bu sürümde ephemeris üzerinden doğrulanmıyor; yorumda kesin VOC iddiası kullanılmaz.';

  const rq = out.querent_significator?.ruler_name;
  const qq = out.quesited_significator?.ruler_name;
  if (rq && qq && aspects.length) {
    const ra = String(rq).toLowerCase();
    const rb = String(qq).toLowerCase();
    for (const a of aspects) {
      const x = String(a.body_a || '').toLowerCase();
      const y = String(a.body_b || '').toLowerCase();
      if (
        (x === ra && y === rb) ||
        (x === rb && y === ra) ||
        (x === ra && y === 'moon') ||
        (x === 'moon' && y === ra) ||
        (x === rb && y === 'moon') ||
        (x === 'moon' && y === rb)
      ) {
        out.notable_aspects.push({
          body_a: a.body_a,
          body_b: a.body_b,
          aspect_type: a.aspect_type,
          orb: a.orb,
        });
        if (out.notable_aspects.length >= 8) break;
      }
    }
  }

  if (!houses || houses.length < 12) {
    out.data_notes.push('Ev verisi eksik; ev tabanlı göstergeler sınırlı.');
  }

  return out;
}

function isHoraryKeywordOnlyMessage(text) {
  const t = String(text || '').trim();
  if (/^horary(\s+yap)?\s*$/i.test(t)) return true;
  if (t.length < 22 && /\bhorary\b/i.test(t) && !/[?？]/.test(t)) return true;
  return false;
}

module.exports = {
  isHoraryRestricted,
  classifyHoraryCategory,
  computeHoraryHints,
  CATEGORY_HOUSE,
  SIGN_RULER_CLASSICAL,
  isHoraryKeywordOnlyMessage,
};
