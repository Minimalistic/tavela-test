// What Reports show (SPEC §10), as plain data from the counts: the window line,
// the caveat, the lead numbers, the timeline rows (drawn by chart-draw.js),
// the totals by kind and the sentences for "In words". Pure, so node:test
// checks every number. Reports describe and never judge: no flags, shaded
// ranges or correlations.
import { BRISTOL, BOWEL_CARE_STATUS } from './bathroom.js';
import { BEHAVIORS } from './handoff.js';
import { INCOMPLETE, shortDate } from './chart-draw.js';

export { shortDate } from './chart-draw.js';

export const CAVEAT = 'Observations may be incomplete.';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const listDates = (days) => days.map(shortDate).join(', ');
// Long lists stop being readable aloud; Records has the full set.
const LIST_MAX = 8;
const listSome = (items) => {
  if (items.length === 0) return '';
  const more = items.length - LIST_MAX;
  return ` (${items.slice(0, LIST_MAX).join(', ')}${more > 0 ? `, and ${more} more` : ''})`;
};

// The window in two parts for the bar pinned to the top of Reports, so it's
// said once: "Sep 24 – Oct 24, 2026" and "Last 30 days + today · All places".
// A preset names itself, so "Last 30 days" never seems to show 31 by mistake.
export function windowParts({ from, to, days }, siteLabel, preset = null) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const range = `${shortDate(from)}${sameYear ? '' : `, ${from.slice(0, 4)}`} – ${shortDate(to)}, ${to.slice(0, 4)}`;
  const span = preset ? `Last ${preset} days + today` : plural(days.length, 'day');
  return { range, detail: `${span} · ${siteLabel ?? 'All places'}` };
}

// The one caveat line under the bar, in place of one on every chart.
export function caveatText(c) {
  const marked = c.coverage.incomplete;
  return [
    CAVEAT,
    marked ? `${plural(marked, 'Update')} said some may be missing or unsure.` : null,
    'A day with nothing logged doesn\'t mean nothing happened.',
  ].filter(Boolean).join(' ');
}

// The four numbers Reports lead with. Counts only: no rates, trends or flags.
export function glanceNumbers(c) {
  const since = c.daysSinceLastBm;
  const average = (series) => (series.average === null ? '–' : series.average.toFixed(1));
  return [
    { area: 'bathroom', value: String(c.urinations.total), label: c.urinations.total === 1 ? 'urination observed' : 'urinations observed' },
    { area: 'bowel', value: String(c.bms.total), label: `${c.bms.total === 1 ? 'BM' : 'BMs'} observed, on ${plural(c.bmDays, 'day')}` },
    since === null ? { area: 'bowel', value: 'Not recorded', label: 'days since the last BM' }
      : since === 0 ? { area: 'bowel', value: 'Today', label: 'the last BM' }
        : { area: 'bowel', value: String(since), label: since === 1 ? 'day since the last BM' : 'days since the last BM' },
    { area: 'comfort', value: `${average(c.comfort.home_am)} · ${average(c.comfort.day_pm)}`, label: 'comfort, morning · afternoon (1–5)' },
  ];
}

const perDay = (days, byDay, fn = (v) => v) => days.map((day) => fn(byDay[day]));

// "What kind": totals for the window that aren't about time. Bristol types on
// the form's own 1–7 bar, then short lists: incontinence episodes, behaviors
// (each kind on its own line, never added together), flush care by status,
// and Updates recorded. Counts only, straight from computeCounts.
export function kindTotals(c) {
  const n = c.window.days.length;
  const recorded = (type) => c.window.days.filter((day) => c.coverage.byDay[day][type] !== null).length;
  const list = (items) => ({ items, max: Math.max(1, ...items.map((item) => item.count)) });
  return {
    bristol: {
      total: c.bms.total,
      types: BRISTOL.map(({ code, label, description }) => ({ code, label, description: description || null, count: c.bristol[code] })),
    },
    groups: [
      { key: 'episodes', title: 'Incontinence episodes', note: 'Wet and Soiled on the Check-In', ...list([
        { label: 'Urine', area: 'bathroom', count: c.accidents.urine },
        { label: 'Bowel', area: 'bowel', count: c.accidents.stool },
      ]) },
      { key: 'behaviors', title: 'Behaviors', note: 'Each kind on its own', ...list(BEHAVIORS.map(({ code, label }) => ({ label, area: 'behavior', count: c.behaviors.total[code] }))) },
      { key: 'flush', title: 'Flush care', note: plural(c.flushCare.total, 'time'), ...list(BOWEL_CARE_STATUS.map(({ code, label }) => ({ label, area: 'bowel', count: c.flushCare.byStatus[code] }))) },
      { key: 'updates', title: 'Updates', note: `${c.coverage.incomplete} marked "some may be missing" or "unsure"`, items: [
        { label: 'Morning', area: 'handoff', count: recorded('home_am'), of: n },
        { label: 'Afternoon', area: 'handoff', count: recorded('day_pm'), of: n },
      ], max: n },
    ],
  };
}

// The rows of the one timeline (SPEC §10.2's shared timeline, carrying the
// daily, urinary, bowel, comfort, behavior and coverage views): one value per
// day each, drawn by chart-draw.js rowDrawing. A null is a gap, never zero.
// `more` rows sit behind "+ 3 more rows". Behaviors mark days with any kind
// and total days, never a sum, so kinds are never added together.
export function timelineRows(c) {
  const { days } = c.window;
  const average = (series) => (series.average === null ? 'no ratings' : `average ${series.average.toFixed(1)}`);
  const behaviorDays = perDay(days, c.behaviors.byDay, (codes) => (Object.values(codes).some((n) => n > 0) ? 1 : 0));
  const updates = perDay(days, c.coverage.byDay, (slot) => [slot.home_am, slot.day_pm]);
  const updateCount = updates.flat().filter((code) => code !== null).length;
  const flushDays = perDay(days, c.flushCare.byDay, (list) => list.length);
  return [
    { key: 'urinations', label: 'Urinations', area: 'bathroom', kind: 'bars', values: perDay(days, c.urinations.byDay), total: String(c.urinations.total) },
    { key: 'bms', label: 'BMs', area: 'bowel', kind: 'dots', values: perDay(days, c.bms.byDay), total: String(c.bms.total) },
    { key: 'pain', label: 'Pain or "ow"', area: 'bathroom', kind: 'dots', values: perDay(days, c.pain.byDay), total: String(c.pain.total) },
    { key: 'change', label: 'Urine looked different', area: 'bathroom', kind: 'dots', values: perDay(days, c.appearanceChanges.byDay), total: String(c.appearanceChanges.total) },
    { key: 'comfort_am', label: 'Comfort, morning', area: 'comfort', kind: 'line', values: perDay(days, c.comfort.home_am.byDay), total: average(c.comfort.home_am) },
    { key: 'comfort_pm', label: 'Comfort, afternoon', area: 'comfort', kind: 'line', dashed: true, values: perDay(days, c.comfort.day_pm.byDay), total: average(c.comfort.day_pm) },
    { key: 'behaviors', label: 'Behaviors', area: 'behavior', kind: 'dots', values: behaviorDays, total: `on ${plural(behaviorDays.filter(Boolean).length, 'day')}` },
    { key: 'updates', label: 'Updates, morning and afternoon', area: 'handoff', kind: 'cells', values: updates, total: String(updateCount) },
    { key: 'odor', label: 'Strong smell', area: 'bathroom', kind: 'dots', more: true, values: perDay(days, c.odor.byDay), total: String(c.odor.total) },
    { key: 'flush', label: 'Flush care', area: 'bowel', kind: 'dots', shape: 'diamond', more: true, values: flushDays, total: String(c.flushCare.total) },
    { key: 'bm_gap', label: 'Days since last BM', area: 'bowel', kind: 'bars', faint: true, more: true, values: perDay(days, c.bmGapByDay), total: 'all places' },
  ];
}

// --- In words ----------------------------------------------------------------
// The sentences behind every view, word for word as the charts carried them,
// for the "In words" section: the text equivalent of the timeline and "What
// kind" (SPEC §10), for screen readers and anyone who wants the words.

function dailyBars(c) {
  const { days } = c.window;
  const values = perDay(days, c.urinations.byDay);
  return {
    key: 'daily',
    title: 'Daily bathroom events',
    summary: [
      `Observed urinations: ${c.urinations.total}, between ${Math.min(...values)} and ${Math.max(...values)} on a single day.`,
      `Observed BMs: ${c.bms.total}, on ${c.bmDays} of ${plural(days.length, 'day')}.`,
      `Incontinence episodes (included above): ${c.accidents.urine} urine, ${c.accidents.stool} bowel. Tried with no output (not included): ${c.attempts}.`,
    ],
  };
}

function urinarySigns(c) {
  return {
    key: 'urinary',
    title: 'Urinary signs',
    summary: [
      c.pain.total === 0
        ? 'Pain or "ow" observed: none recorded.'
        : `Pain or "ow" observed at ${plural(c.pain.total, 'check-in')}, on ${plural(c.pain.dates.length, 'day')}: ${listDates(c.pain.dates)}.`,
      `Urine appearance change observed (darker, cloudy, pink/red or other): ${plural(c.appearanceChanges.total, 'check-in')}.`,
      `Strong smell observed: ${plural(c.odor.total, 'check-in')}.`,
      `Urine not assessed: ${plural(c.urineNotAssessed, 'check-in')}. "Not assessed" is not the same as no change.`,
    ],
  };
}

function bristol(c) {
  return {
    key: 'bristol',
    title: 'Stool type (Bristol scale)',
    summary: [
      `Of ${plural(c.bms.total, 'observed BM')}: ${BRISTOL.map(({ code, label }) => `${label}, ${c.bristol[code]}`).join('; ')}.`,
    ],
  };
}

function bowelTimeline(c) {
  const { days } = c.window;
  const statuses = BOWEL_CARE_STATUS.map(({ code, label }) => `${label} ${c.flushCare.byStatus[code]}`).join(', ');
  return {
    key: 'bowel',
    title: 'Bowel timeline',
    summary: [
      `Days with an observed BM: ${c.bmDays} of ${days.length}.`,
      `Flush care: ${c.flushCare.total} (${statuses}).`,
      `Days since the last documented BM: ${c.daysSinceLastBm ?? 'Not recorded'}. This looks at every place and every date, not just this window.`,
    ],
  };
}

const UPDATES = [
  { type: 'home_am', name: 'Morning Update' },
  { type: 'day_pm', name: 'Afternoon Update' },
];

function comfort(c) {
  const n = c.window.days.length;
  return {
    key: 'comfort',
    title: 'Comfort over time',
    summary: [
      ...UPDATES.map(({ type, name }) => {
        const series = c.comfort[type];
        if (series.rated === 0) return `${name} comfort: no ratings in this window.`;
        const gaps = Object.values(series.byDay).filter((v) => v === null).length;
        return `${name} comfort: average ${series.average.toFixed(1)} across ${plural(series.rated, 'rated update')}. ${plural(gaps, 'day')} of ${n} have no rating and are left as gaps.`;
      }),
      '"Unable to assess" is left out, never counted as a rating.',
    ],
  };
}

function behaviors(c) {
  const present = BEHAVIORS.filter(({ code }) => c.behaviors.total[code] > 0);
  const daysWith = (code) => Object.values(c.behaviors.byDay).filter((day) => day[code] > 0).length;
  return {
    key: 'behaviors',
    title: 'Behaviors over time',
    summary: [
      ...(present.length === 0
        ? ['No behaviors were recorded in Morning or Afternoon Updates in this window.']
        : [
          ...present.map(({ code, label }) => `${label}: ${plural(c.behaviors.total[code], 'time')}, on ${plural(daysWith(code), 'day')}.`),
          'Each behavior is shown on its own; self-directed and other-directed behaviors are never added together.',
        ]),
      `Updates where behaviors were marked "Not observed" (staff couldn't see): ${c.behaviors.notObserved}.`,
    ],
  };
}

function coverage(c) {
  const { days } = c.window;
  const has = (type) => days.filter((day) => c.coverage.byDay[day][type] !== null).length;
  const marked = days.flatMap((day) => UPDATES
    .filter(({ type }) => INCOMPLETE.has(c.coverage.byDay[day][type]))
    .map(({ name }) => `${shortDate(day)} (${name})`));
  return {
    key: 'coverage',
    title: 'Observation coverage',
    summary: [
      `Morning Update on ${has('home_am')} of ${plural(days.length, 'day')}; Afternoon Update on ${has('day_pm')}.`,
      `Updates marked "Some may be missing" or "Unsure": ${c.coverage.incomplete}${listSome(marked)}.`,
      'A day with no entries does not mean nothing happened.',
    ],
  };
}

function shared() {
  return {
    key: 'shared',
    title: 'Shared timeline',
    summary: [
      'Pain, urine appearance changes, observed BMs, comfort and behaviors on one date axis, so overlaps can be compared by eye. The numbers are the same as in the timeline and totals.',
    ],
  };
}

export function summaries(counts) {
  return [dailyBars, urinarySigns, bristol, bowelTimeline, comfort, behaviors, coverage, shared].map((build) => build(counts));
}
