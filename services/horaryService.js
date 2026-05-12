/**
 * Horary soru anı haritası + ipuçları birleştirme.
 */

const chartCalculator = require('./chartCalculator');
const horaryRules = require('./horaryRules');

/**
 * @param {{
 *   question: string,
 *   receivedAtUnix: number,
 *   latitude: number,
 *   longitude: number,
 *   placeLabel: string,
 *   timezoneIANA: string|null,
 * }} p
 */
function buildHoraryChartForQuestion(p) {
  const category = horaryRules.classifyHoraryCategory(p.question);
  const chart = chartCalculator.calculateHoraryChart({
    question: p.question,
    receivedAtUnix: p.receivedAtUnix,
    latitude: p.latitude,
    longitude: p.longitude,
    placeLabel: p.placeLabel,
    timezoneIANA: p.timezoneIANA,
  });
  const hints = horaryRules.computeHoraryHints(chart, category);
  chart.horary_hints = hints;
  chart.horary_category = category;
  return chart;
}

module.exports = {
  buildHoraryChartForQuestion,
};
