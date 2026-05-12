/**
 * Harita hesaplama katmanı — AI burada hesap yapmaz.
 * Ephemeris + evler: circular-natal-horoscope-js (Placidus, tropical).
 */

const { Origin, Horoscope } = require('circular-natal-horoscope-js');
const { DateTime } = require('luxon');

const PLANET_KEYS = [
  'sun',
  'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];

function capitalizeSign(key) {
  if (!key || typeof key !== 'string') return key;
  return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
}

function normalizeLongitude(dec) {
  let x = Number(dec);
  if (Number.isNaN(x)) return 0;
  x %= 360;
  if (x < 0) x += 360;
  return Math.round(x * 10000) / 10000;
}

function degreeInSign(longitude) {
  const d = normalizeLongitude(longitude) % 30;
  return Math.round(d * 10000) / 10000;
}

function buildThemes(planetsForTheme, chartMode) {
  const items = [];
  const bodies = planetsForTheme.filter((p) => PLANET_KEYS.includes(p.id));

  const bySign = {};
  for (const p of bodies) {
    const s = (p.sign || '').toLowerCase();
    if (!s) continue;
    if (!bySign[s]) bySign[s] = [];
    bySign[s].push(p.id);
  }
  for (const [sign, ids] of Object.entries(bySign)) {
    if (ids.length >= 3) {
      items.push({
        type: 'stellium_sign',
        description: `${ids.length} gövde ${capitalizeSign(sign)} burcunda yoğunlaşıyor.`,
        related_bodies: ids,
        related_houses: [],
      });
    }
  }

  const elementMap = {
    aries: 'fire',
    leo: 'fire',
    sagittarius: 'fire',
    taurus: 'earth',
    virgo: 'earth',
    capricorn: 'earth',
    gemini: 'air',
    libra: 'air',
    aquarius: 'air',
    cancer: 'water',
    scorpio: 'water',
    pisces: 'water',
  };
  const elCount = { fire: 0, earth: 0, air: 0, water: 0 };
  for (const p of bodies) {
    const e = elementMap[(p.sign || '').toLowerCase()];
    if (e) elCount[e]++;
  }
  const dominant = Object.entries(elCount).sort((a, b) => b[1] - a[1])[0];
  if (dominant[1] >= 4) {
    items.push({
      type: 'element_emphasis',
      description: `${dominant[0]} elementi gövde sayısında öne çıkıyor (${dominant[1]}).`,
      related_bodies: bodies.map((b) => b.id),
      related_houses: [],
    });
  }

  if (chartMode === 'full') {
    const byHouse = {};
    for (const p of bodies) {
      const h = p.house;
      if (h == null || h < 1 || h > 12) continue;
      if (!byHouse[h]) byHouse[h] = [];
      byHouse[h].push(p.id);
    }
    for (const [h, ids] of Object.entries(byHouse)) {
      if (ids.length >= 3) {
        items.push({
          type: 'stellium_house',
          description: `${ids.length} gövde ${h}. evde yoğunlaşıyor.`,
          related_bodies: ids,
          related_houses: [Number(h)],
        });
      }
    }
  }

  return { items };
}

function mapPlanetBody(bodyKey, horoscope, chartMode) {
  const b = horoscope.CelestialBodies[bodyKey];
  if (!b) return null;
  const lon = b.ChartPosition?.Ecliptic?.DecimalDegrees;
  const signKey = (b.Sign?.key || '').toLowerCase();
  const houseNum =
    chartMode === 'full' && b.House && typeof b.House.id === 'number'
      ? b.House.id
      : null;

  return {
    id: capitalizeSign(bodyKey),
    longitude: normalizeLongitude(lon),
    sign: capitalizeSign(signKey),
    degree_in_sign: degreeInSign(lon),
    retrograde: Boolean(b.isRetrograde),
    house: houseNum,
  };
}

function mapAngles(horoscope) {
  const asc = horoscope.Ascendant;
  const mc = horoscope.Midheaven;
  const ascLon = asc?.ChartPosition?.Ecliptic?.DecimalDegrees;
  const mcLon = mc?.ChartPosition?.Ecliptic?.DecimalDegrees;
  return {
    ASC: {
      longitude: normalizeLongitude(ascLon),
      sign: capitalizeSign((asc.Sign?.key || '').toLowerCase()),
      degree_in_sign: degreeInSign(ascLon),
    },
    MC: {
      longitude: normalizeLongitude(mcLon),
      sign: capitalizeSign((mc.Sign?.key || '').toLowerCase()),
      degree_in_sign: degreeInSign(mcLon),
    },
  };
}

function mapHouses(horoscope) {
  return horoscope.Houses.map((h) => {
    const lon = h.ChartPosition?.StartPosition?.Ecliptic?.DecimalDegrees;
    const signKey = (h.Sign?.key || '').toLowerCase();
    return {
      number: h.id,
      cusp_longitude: normalizeLongitude(lon),
      sign: capitalizeSign(signKey),
      degree_in_sign: degreeInSign(lon),
    };
  });
}

function mapAspects(horoscope) {
  const allowed = new Set(PLANET_KEYS);
  const out = [];
  for (const a of horoscope.Aspects.all || []) {
    const k1 = a.point1Key;
    const k2 = a.point2Key;
    if (!allowed.has(k1) || !allowed.has(k2)) continue;
    out.push({
      body_a: capitalizeSign(k1),
      body_b: capitalizeSign(k2),
      aspect_type: String(a.aspectKey || '').toLowerCase(),
      orb: Math.round(Number(a.orb) * 10000) / 10000,
      house_dependent: false,
    });
  }
  return out;
}

/**
 * @param {object} p
 * @param {number} p.year
 * @param {number} p.month 1-12
 * @param {number} p.day
 * @param {number} p.hour
 * @param {number} p.minute
 * @param {number} p.latitude
 * @param {number} p.longitude
 * @param {boolean} p.hasKnownBirthTime
 * @param {string} p.placeLabel
 */
function calculateChart(p) {
  const {
    year,
    month,
    day,
    hour,
    minute,
    latitude,
    longitude,
    hasKnownBirthTime,
    placeLabel,
  } = p;

  const chartMode = hasKnownBirthTime ? 'full' : 'partial';

  const origin = new Origin({
    year,
    month: month - 1,
    date: day,
    hour,
    minute,
    second: 0,
    latitude,
    longitude,
  });
  const timezoneNote = origin.timezone?.name || null;

  const horoscope = new Horoscope({
    origin,
    houseSystem: 'placidus',
    zodiac: 'tropical',
    aspectPoints: ['bodies'],
    aspectWithPoints: ['bodies'],
    aspectTypes: ['major'],
    language: 'en',
  });

  const planets = PLANET_KEYS.map((k) => mapPlanetBody(k, horoscope, chartMode)).filter(Boolean);

  let angles = null;
  let houses = null;
  if (chartMode === 'full') {
    angles = mapAngles(horoscope);
    houses = mapHouses(horoscope);
  } else {
    for (const pl of planets) {
      pl.house = null;
    }
  }

  const aspects = mapAspects(horoscope);
  const themes = buildThemes(planets, chartMode);

  const chartData = {
    schema_version: '1.0',
    chart_mode: chartMode,
    data_availability: {
      chart_mode: chartMode,
      houses_usable: chartMode === 'full',
      angles_usable: chartMode === 'full',
      planet_houses_usable: chartMode === 'full',
      forbidden_inference:
        chartMode === 'partial'
          ? [
              'do_not_infer_ascendant',
              'do_not_infer_houses',
              'do_not_infer_mc_ic',
            ]
          : [],
    },
    meta: {
      house_system: chartMode === 'full' ? 'Placidus' : null,
      zodiac: 'Tropical',
      ephemeris_note: 'circular-natal-horoscope-js',
      computed_at: new Date().toISOString(),
      timezone_note: timezoneNote,
    },
    birth: {
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time: hasKnownBirthTime ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null,
      place_label: placeLabel,
      latitude,
      longitude,
      julian_date: origin.julianDate,
      utc_time_formatted: origin.utcTimeFormatted,
    },
    angles,
    houses,
    planets,
    aspects,
    themes,
  };

  return chartData;
}

/**
 * Tarih metni: önce ISO yyyy-MM-dd, sonra dd.MM.yyyy, sonra Luxon locale tr "d MMMM yyyy".
 */
function parseBirthDate(text) {
  const raw = (text || '').trim();
  if (!raw) return { ok: false, error: 'Boş tarih.' };

  let dt = DateTime.fromISO(raw, { zone: 'local' });
  if (dt.isValid) return { ok: true, year: dt.year, month: dt.month, day: dt.day };

  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    dt = DateTime.fromObject({ year, month, day }, { zone: 'local' });
    if (dt.isValid) return { ok: true, year, month, day };
  }

  dt = DateTime.fromFormat(raw, 'd MMMM yyyy', { locale: 'tr' });
  if (dt.isValid) return { ok: true, year: dt.year, month: dt.month, day: dt.day };

  dt = DateTime.fromFormat(raw, 'd MMMM yyyy', { locale: 'en' });
  if (dt.isValid) return { ok: true, year: dt.year, month: dt.month, day: dt.day };

  return { ok: false, error: 'Tarihi anlayamadım. Örnek: 1998-07-07 veya 7.7.1998' };
}

/**
 * Saat: HH:mm, H:mm, HH.mm
 */
function parseBirthTime(text) {
  const raw = (text || '').trim().toLowerCase();
  if (raw === 'bilmiyorum' || raw === 'bilmiyorum.') {
    return { ok: true, unknown: true };
  }
  const m = raw.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return { ok: false, error: 'Saati 09:15 gibi yaz veya "bilmiyorum" de.' };
  let h = Number(m[1]);
  let min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    return { ok: false, error: 'Saat 0–23, dakika 0–59 olmalı.' };
  }
  return { ok: true, unknown: false, hour: h, minute: min };
}

module.exports = {
  calculateChart,
  parseBirthDate,
  parseBirthTime,
  PLANET_KEYS,
};
