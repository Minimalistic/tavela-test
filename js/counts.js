// Counting rules for reports (docs/SPEC.md §10.1). Pure functions. Every
// number starts from filterEntries(), the same filter the Records list uses,
// so a report always reconciles with "See these N records". Voided entries
// are left out everywhere. Nothing here judges a value: counts only.
import { filterEntries } from './entries.js';
import { localDate } from './time.js';
import { BRISTOL, BOWEL_CARE_STATUS } from './bathroom.js';
import { BEHAVIORS } from './handoff.js';

const URINATIONS = new Set(['pee', 'both', 'urine_accident']);
const BMS = new Set(['bm', 'both', 'stool_accident']);
const APPEARANCE = new Set(['darker', 'cloudy', 'pink_red', 'other']);
const INCOMPLETE_COVERAGE = new Set(['some_missing', 'unsure']);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m: m - 1, d };
};

// Every local calendar day from `from` to `to`, both inclusive. Steps by
// calendar date, not by 24 hours, so a clock change never skips or repeats.
export function daysBetween(from, to) {
  // A blank or reversed custom range must fail loudly, not loop forever.
  if (!DAY.test(from ?? '') || !DAY.test(to ?? '') || from > to) throw new RangeError('Invalid date window');
  const days = [];
  const start = parseDay(from);
  for (let i = 0; ; i++) {
    const day = dateKey(new Date(start.y, start.m, start.d + i));
    if (day > to) break;
    days.push(day);
  }
  return days;
}

// Calendar days from one local date to another (to − from).
export function dayDiff(from, to) {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86_400_000);
}

// SPEC §10: the trailing N complete days plus today.
export function presetWindow(days, today = new Date()) {
  return {
    from: dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)),
    to: dateKey(today),
  };
}

// Days since the last documented BM, across the whole dataset, whatever the
// report window or site: it describes the person, not the chart. null means
// "Not recorded". A BM dated after today (the forms only warn about a future
// time) is left out, so a mistyped date can't make the gap negative.
export function daysSinceLastBm(records, today = new Date()) {
  const todayKey = dateKey(today);
  let latest = null;
  for (const record of records) {
    if (record.voided_at || !BMS.has(record.event_code)) continue;
    const day = localDate(record.occurred_at);
    if (day > todayKey) continue;
    if (latest === null || day > latest) latest = day;
  }
  return latest === null ? null : dayDiff(latest, todayKey);
}

// For each day, days since the latest documented BM on or before it, from the
// whole dataset like daysSinceLastBm(). null until the first BM.
export function bmGapByDay(records, days) {
  const bmDates = [...new Set(records
    .filter((record) => !record.voided_at && BMS.has(record.event_code))
    .map((record) => localDate(record.occurred_at)))].sort();
  const gaps = {};
  let latest = -1;
  for (const day of days) {
    while (latest + 1 < bmDates.length && bmDates[latest + 1] <= day) latest += 1;
    gaps[day] = latest < 0 ? null : dayDiff(bmDates[latest], day);
  }
  return gaps;
}

const zeroByDay = (days) => Object.fromEntries(days.map((day) => [day, 0]));

// records: bathroom events and handoffs together, as stored.
// window: { from, to } local dates (both required); site: a code or null.
export function computeCounts(records, { from, to, site = null }, today = new Date()) {
  const entries = filterEntries(records, { from, to, site });
  const days = daysBetween(from, to);
  const perDay = () => zeroByDay(days);

  const counts = {
    window: { from, to, site, days },
    entries,
    urinations: { total: 0, byDay: perDay() },
    bms: { total: 0, byDay: perDay() },
    bmDays: 0,
    daysSinceLastBm: daysSinceLastBm(records, today),
    bmGapByDay: bmGapByDay(records, days),
    pain: { total: 0, byDay: perDay(), dates: [] },
    appearanceChanges: { total: 0, byDay: perDay() },
    odor: { total: 0, byDay: perDay() },
    urineNotAssessed: 0,
    // byDay: for the picked day on Reports; the totals are the counting rule.
    accidents: { urine: 0, stool: 0, urineByDay: perDay(), stoolByDay: perDay() },
    attempts: 0,
    bristol: Object.fromEntries(BRISTOL.map(({ code }) => [code, 0])),
    bristolByDay: Object.fromEntries(days.map((day) => [day, []])),
    flushCare: {
      total: 0,
      byStatus: Object.fromEntries(BOWEL_CARE_STATUS.map(({ code }) => [code, 0])),
      byDay: Object.fromEntries(days.map((day) => [day, []])),
    },
    comfort: {
      home_am: { byDay: Object.fromEntries(days.map((day) => [day, null])), average: null, rated: 0 },
      day_pm: { byDay: Object.fromEntries(days.map((day) => [day, null])), average: null, rated: 0 },
    },
    behaviors: {
      // Updates where staff couldn't see: not the same as "None observed".
      notObserved: 0,
      total: Object.fromEntries(BEHAVIORS.map(({ code }) => [code, 0])),
      byDay: Object.fromEntries(days.map((day) => [day, Object.fromEntries(BEHAVIORS.map(({ code }) => [code, 0]))])),
    },
    coverage: {
      incomplete: 0,
      byDay: Object.fromEntries(days.map((day) => [day, { home_am: null, day_pm: null }])),
    },
  };

  const bmDates = new Set();
  const painDates = new Set();
  const comfortSums = { home_am: {}, day_pm: {} };

  for (const record of entries) {
    const day = localDate(record.occurred_at);
    if (record.summary_type) {
      countHandoff(counts, record, day, comfortSums);
      continue;
    }
    const event = record.event_code;
    if (URINATIONS.has(event)) {
      counts.urinations.total += 1;
      counts.urinations.byDay[day] += 1;
      // Appearance and odor are read only where the urine question was asked.
      const details = record.urine_change_details;
      if (details.some((code) => APPEARANCE.has(code))) {
        counts.appearanceChanges.total += 1;
        counts.appearanceChanges.byDay[day] += 1;
      }
      if (details.includes('strong_odor')) {
        counts.odor.total += 1;
        counts.odor.byDay[day] += 1;
      }
      if (record.urine_change_code === 'not_assessed') counts.urineNotAssessed += 1;
    }
    if (BMS.has(event)) {
      counts.bms.total += 1;
      counts.bms.byDay[day] += 1;
      counts.bristol[record.bristol_type] += 1;
      counts.bristolByDay[day].push(record.bristol_type);
      bmDates.add(day);
    }
    if (event === 'urine_accident') {
      counts.accidents.urine += 1;
      counts.accidents.urineByDay[day] += 1;
    }
    if (event === 'stool_accident') {
      counts.accidents.stool += 1;
      counts.accidents.stoolByDay[day] += 1;
    }
    if (event === 'attempt_no_output') counts.attempts += 1;
    if (event === 'bowel_care') {
      counts.flushCare.total += 1;
      counts.flushCare.byStatus[record.bowel_care_status] += 1;
      counts.flushCare.byDay[day].push(record.bowel_care_status);
    }
    if (record.pain_code === 'yes') {
      counts.pain.total += 1;
      counts.pain.byDay[day] += 1;
      painDates.add(day);
    }
  }

  counts.bmDays = bmDates.size;
  counts.pain.dates = [...painDates].sort();
  for (const type of ['home_am', 'day_pm']) {
    const series = counts.comfort[type];
    let sum = 0;
    for (const [day, ratings] of Object.entries(comfortSums[type])) {
      series.byDay[day] = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      sum += ratings.reduce((a, b) => a + b, 0);
      series.rated += ratings.length;
    }
    series.average = series.rated === 0 ? null : sum / series.rated;
  }
  return counts;
}

function countHandoff(counts, record, day, comfortSums) {
  const type = record.summary_type;
  // "Unable to assess" is left out, never treated as a rating.
  if (typeof record.comfort === 'number') {
    (comfortSums[type][day] ??= []).push(record.comfort);
  }
  if (record.behavior_state === 'not_observed') counts.behaviors.notObserved += 1;
  for (const code of record.behavior_codes) {
    counts.behaviors.total[code] += 1;
    counts.behaviors.byDay[day][code] += 1;
  }
  // The latest handoff of each type that day sets the strip (the list is
  // newest first, so the first one seen wins).
  const slot = counts.coverage.byDay[day];
  if (slot[type] === null) slot[type] = record.bathroom_coverage_code;
  if (INCOMPLETE_COVERAGE.has(record.bathroom_coverage_code)) counts.coverage.incomplete += 1;
}
