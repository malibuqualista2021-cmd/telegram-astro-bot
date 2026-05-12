/**
 * Bellek içi oturum (MVP). İleride aynı arayüzle DB adapter değiştirilebilir.
 */

const sessions = new Map();

function defaultSession() {
  return {
    step: 'idle',
    intent: null,
    topicCodePreset: null,
    pendingFreeformPersonal: null,
    lastChartData: null,
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
    pendingTopicCode: null,
    pendingClarifyText: null,
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

/**
 * Doğum verisini temizler, son haritayı saklar, sohbet menüsüne döner.
 */
function prepareForNextChat(userId, chartData) {
  let snapshot = null;
  try {
    snapshot = JSON.parse(JSON.stringify(chartData));
  } catch {
    snapshot = chartData;
  }
  if (snapshot && typeof snapshot === 'object') {
    delete snapshot.interpretation_request;
  }
  const base = defaultSession();
  base.step = 'await_intent';
  base.lastChartData = snapshot;
  sessions.set(String(userId), base);
}

module.exports = { get, set, reset, defaultSession, prepareForNextChat };
