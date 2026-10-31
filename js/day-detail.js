// What one day holds, in words, for the panel under a chart when someone taps
// or arrow-keys to a day. Pure: it reads the same counts the charts draw, so
// the words always agree with the bars. Describes only; never judges.
import { BOWEL_CARE_STATUS, labelFor } from './bathroom.js';
import { BEHAVIORS, COVERAGE } from './handoff.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function longDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

const rating = (value) => {
  if (value === null) return 'no rating';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

// Short words for an Update's coverage answer in a day box.
const COVERAGE_SHORT = { all_logged: 'Done', none_known: 'Done', some_missing: 'Some missing', unsure: 'Unsure' };
// A box with nothing recorded shows a dash (views/timeline.js reads it as "none recorded").
export const NONE = '—';

// The picked day as boxes: a label, a number (or a few words), and a dash for
// none recorded. Same counts as dayDetail, so the boxes and the words agree.
export function dayFacts(c, day) {
  const count = (n) => (n ? String(n) : NONE);
  const types = c.bristolByDay[day].map((code) => (code === 'unable' ? 'unable to tell' : code));
  const am = c.comfort.home_am.byDay[day];
  const pm = c.comfort.day_pm.byDay[day];
  const behaviors = BEHAVIORS.filter(({ code }) => c.behaviors.byDay[day][code] > 0)
    .map(({ code, label }) => `${label}${c.behaviors.byDay[day][code] > 1 ? ` ×${c.behaviors.byDay[day][code]}` : ''}`);
  const update = (type) => {
    const code = c.coverage.byDay[day][type];
    return code === null ? '–' : COVERAGE_SHORT[code];
  };
  const wet = c.accidents.urineByDay[day];
  const soiled = c.accidents.stoolByDay[day];
  const flush = c.flushCare.byDay[day];
  return [
    { key: 'urinations', area: 'bathroom', label: 'Urinations', value: count(c.urinations.byDay[day]), note: wet ? `${wet} wet` : null },
    {
      key: 'bms', area: 'bowel', label: 'BMs', value: count(c.bms.byDay[day]),
      note: [types.length ? `type ${types.join(', ')}` : null, soiled ? `${soiled} soiled` : null].filter(Boolean).join(' · ') || null,
    },
    { key: 'pain', area: 'bathroom', label: 'Pain or "ow"', value: count(c.pain.byDay[day]), note: null },
    { key: 'change', area: 'bathroom', label: 'Urine looked different', value: count(c.appearanceChanges.byDay[day]), note: null },
    { key: 'comfort', area: 'comfort', label: 'Comfort, AM · PM', value: am === null && pm === null ? NONE : `${am === null ? '–' : rating(am)} · ${pm === null ? '–' : rating(pm)}`, note: null },
    { key: 'behaviors', area: 'behavior', label: 'Behaviors', value: behaviors.length ? behaviors.join(', ') : NONE, note: null },
    { key: 'updates', area: 'handoff', label: 'Updates, AM · PM', value: c.coverage.byDay[day].home_am === null && c.coverage.byDay[day].day_pm === null ? NONE : `${update('home_am')} · ${update('day_pm')}`, note: null },
    { key: 'flush', area: 'bowel', label: 'Flush care', value: flush.length ? flush.map((code) => labelFor(BOWEL_CARE_STATUS, code)).join(', ') : NONE, note: null },
  ];
}

export function dayDetail(c, day) {
  const lines = [
    `Observed urinations: ${c.urinations.byDay[day]}. Observed BMs: ${c.bms.byDay[day]}.`,
  ];
  const signs = [
    c.pain.byDay[day] ? `pain or "ow" ${c.pain.byDay[day]}` : null,
    c.appearanceChanges.byDay[day] ? `appearance change ${c.appearanceChanges.byDay[day]}` : null,
    c.odor.byDay[day] ? `strong smell ${c.odor.byDay[day]}` : null,
  ].filter(Boolean);
  if (signs.length) lines.push(`Urinary signs observed: ${signs.join(', ')}.`);
  const flush = c.flushCare.byDay[day];
  if (flush.length) lines.push(`Flush care: ${flush.map((code) => labelFor(BOWEL_CARE_STATUS, code)).join(', ')}.`);
  lines.push(`Comfort: Morning ${rating(c.comfort.home_am.byDay[day])}, Afternoon ${rating(c.comfort.day_pm.byDay[day])}.`);
  const behaviors = BEHAVIORS.filter(({ code }) => c.behaviors.byDay[day][code] > 0)
    .map(({ code, label }) => `${label} ${c.behaviors.byDay[day][code]}`);
  if (behaviors.length) lines.push(`Behaviors: ${behaviors.join(', ')}.`);
  const coverage = (type) => {
    const code = c.coverage.byDay[day][type];
    return code === null ? 'no update' : labelFor(COVERAGE, code);
  };
  lines.push(`Morning Update: ${coverage('home_am')}. Afternoon Update: ${coverage('day_pm')}.`);
  lines.push(`Days since the last documented BM: ${c.bmGapByDay[day] ?? 'Not recorded'}.`);
  return { title: longDate(day), lines };
}
