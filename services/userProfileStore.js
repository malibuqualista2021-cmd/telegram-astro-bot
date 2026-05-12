/**
 * Kullanıcı doğum profili (MVP: bellek).
 * İleride aynı arayüzle PostgreSQL / Redis / Supabase adapter bağlanabilir.
 * Yalnızca Telegram userId anahtarı kullanılır; veri kullanıcılar arasında paylaşılmaz.
 */

const profiles = new Map();

function nowIso() {
  return new Date().toISOString();
}

/**
 * @typedef {{
 *   birthDate: { year: number, month: number, day: number },
 *   birthDateText: string,
 *   birthPlace: { label: string, latitude: number, longitude: number, searchText: string },
 *   birthTime: { hour: number, minute: number } | null,
 *   birthTimeKnown: boolean,
 *   chartMode: 'full' | 'partial',
 *   lastChartData: object | null,
 *   createdAt: string,
 *   updatedAt: string,
 * }} UserBirthProfile
 */

function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

/**
 * @param {string|number} userId
 * @returns {UserBirthProfile|null}
 */
function getProfile(userId) {
  const key = String(userId);
  const p = profiles.get(key);
  return p ? deepClone(p) : null;
}

/**
 * @param {string|number} userId
 */
function hasProfile(userId) {
  return isProfileComplete(getProfile(userId));
}

/**
 * @param {UserBirthProfile|null} p
 */
function isProfileComplete(p) {
  if (!p || !p.birthDate) return false;
  const { year, month, day } = p.birthDate;
  if (typeof year !== 'number' || typeof month !== 'number' || typeof day !== 'number') return false;
  if (!p.birthPlace || typeof p.birthPlace.latitude !== 'number' || typeof p.birthPlace.longitude !== 'number')
    return false;
  if (!p.birthPlace.label || typeof p.birthPlace.label !== 'string') return false;
  if (typeof p.birthTimeKnown !== 'boolean') return false;
  if (p.birthTimeKnown) {
    if (!p.birthTime || typeof p.birthTime.hour !== 'number' || typeof p.birthTime.minute !== 'number')
      return false;
  }
  return true;
}

/**
 * @param {string|number} userId
 * @param {UserBirthProfile} profile
 * @returns {UserBirthProfile}
 */
function saveProfile(userId, profile) {
  const key = String(userId);
  const t = nowIso();
  const prev = profiles.get(key);
  const next = {
    ...deepClone(profile),
    createdAt: prev?.createdAt || profile.createdAt || t,
    updatedAt: t,
  };
  profiles.set(key, deepClone(next));
  return deepClone(next);
}

/**
 * @param {string|number} userId
 * @param {Partial<UserBirthProfile>} patch
 * @returns {UserBirthProfile|null}
 */
function updateProfile(userId, patch) {
  const cur = getProfile(userId);
  if (!cur && Object.keys(patch).length === 0) return null;
  const base = cur || {};
  return saveProfile(userId, { ...base, ...deepClone(patch) });
}

/**
 * @param {string|number} userId
 */
function deleteProfile(userId) {
  profiles.delete(String(userId));
}

module.exports = {
  getProfile,
  saveProfile,
  updateProfile,
  deleteProfile,
  hasProfile,
  isProfileComplete,
};
