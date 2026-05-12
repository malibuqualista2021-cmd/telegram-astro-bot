/**
 * Bellek içi oturum (MVP). İleride aynı arayüzle DB adapter değiştirilebilir.
 */

const sessions = new Map();

function defaultSession() {
  return {
    step: 'idle',
    birthDateText: null,
    birthYmd: null,
    placeText: null,
    placeLabel: null,
    latitude: null,
    longitude: null,
    birthTimeText: null,
    birthHour: null,
    birthMinute: null,
    hasKnownBirthTime: null,
    topicCode: null,
  };
}

function get(userId) {
  const key = String(userId);
  if (!sessions.has(key)) sessions.set(key, defaultSession());
  return sessions.get(key);
}

function set(userId, patch) {
  const key = String(userId);
  const cur = { ...get(userId), ...patch };
  sessions.set(key, cur);
  return cur;
}

function reset(userId) {
  sessions.set(String(userId), defaultSession());
}

module.exports = { get, set, reset, defaultSession };
