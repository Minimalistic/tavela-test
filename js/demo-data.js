// Seeded generator for demo mode (docs/SPEC.md §16): months of realistic,
// fictional entries for exploring reports. Pure: the same seed and `now`
// always give identical records, ids included. Every record is built with the
// forms' own toRecord(), so it obeys the same rules as a staff entry.
import { newBathroomDraft, toRecord as bathroomRecord } from './bathroom.js';
import { newHandoffDraft, toRecord as handoffRecord } from './handoff.js';
import { voidRecord } from './entries.js';
import { toOffsetIso } from './time.js';

export const DEMO_DAYS = [30, 90, 180];
export const DEMO_SEED = 20261020;

// mulberry32: a tiny seedable PRNG. Math.random can't be seeded, and this
// needs no dependency. Not for anything secret.
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const chance = (p) => next() < p;
  const pick = (list) => list[Math.floor(next() * list.length)];
  // weighted([[value, weight], ...])
  const weighted = (pairs) => {
    let roll = next() * pairs.reduce((sum, [, w]) => sum + w, 0);
    for (const [value, w] of pairs) {
      roll -= w;
      if (roll < 0) return value;
    }
    return pairs[pairs.length - 1][0];
  };
  // UUID v4 shape from the seeded stream, so ids are reproducible too.
  const uuid = () => {
    const hex = Array.from({ length: 32 }, () => int(0, 15).toString(16));
    hex[12] = '4';
    hex[16] = '89ab'[int(0, 3)];
    const s = hex.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };
  return { next, int, chance, pick, weighted, uuid };
}

const STAFF = ['AB', 'JR', 'MK', 'TS', 'LW'];
const BM_NOTES = [
  'Demo: took a while, calm throughout.',
  'Demo: needed a reminder to wash hands.',
  'Demo: asked for privacy, waited outside.',
];
const PEE_NOTES = [
  'Demo: went on own after lunch prompt.',
  'Demo: said "ow" once, then fine.',
  'Demo: drank a lot of water at the outing.',
];
const POSITIVES = [
  'Demo: laughed during the music group.',
  'Demo: helped set the table without asking.',
  'Demo: greeted everyone by name this morning.',
  'Demo: finished the whole puzzle.',
  'Demo: enjoyed the walk to the park.',
];
const HANDOFF_NOTES = [
  'Demo: quiet start, warmed up by mid-morning.',
  'Demo: may need extra time getting ready tomorrow.',
  'Demo: new shoes, watch for rubbing.',
];
const VOID_REASONS = ['Demo: entered twice', 'Demo: wrong person', null];

// Picks one index per 30-day block, so even a 30-day demo has every rare
// thing a report needs to show (a gap, a pain cluster, a missing handoff).
function onePerBlock(rng, days, { avoidLast = 0 } = {}) {
  const chosen = new Set();
  for (let start = 0; start < days; start += 30) {
    const end = Math.min(start + 30, days - avoidLast) - 1;
    if (end >= start) chosen.add(rng.int(start, end));
  }
  return chosen;
}

// days: how many calendar days, today included. now: the end of the data;
// nothing is generated after it.
export function generateDemoData({ days, seed = DEMO_SEED, now = new Date() }) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new RangeError('days must be 1–366');
  const rng = makeRng(seed);
  const bathroom = [];
  const handoffs = [];

  // Day 0 is the oldest. Rare things are placed up front, away from today.
  const gapDays = onePerBlock(rng, days, { avoidLast: 2 });
  const painStarts = onePerBlock(rng, days, { avoidLast: 3 });
  const stoolAccidentDays = onePerBlock(rng, days);
  const missingHandoffDays = onePerBlock(rng, days, { avoidLast: 1 });
  const someMissingDays = onePerBlock(rng, days, { avoidLast: 1 });

  let painLeft = 0;
  let daysSinceBm = 1;
  let nextFlush = rng.int(1, 3);
  let flushedYesterday = false;
  let owedMissingHandoff = false;
  let owedSomeMissing = false;

  for (let index = 0; index < days; index++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index));
    const weekday = date.getDay() >= 1 && date.getDay() <= 5;
    const at = (hour, minute) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    const past = (when) => when.getTime() <= now.getTime();

    if (painStarts.has(index) || (painLeft === 0 && rng.chance(1 / 40))) painLeft = rng.int(2, 4);
    const inPain = painLeft > 0;
    if (painLeft > 0) painLeft -= 1;

    const gap = gapDays.has(index) || (index < days - 2 && rng.chance(0.015));
    if (missingHandoffDays.has(index)) owedMissingHandoff = true;
    if (someMissingDays.has(index)) owedSomeMissing = true;
    const someMissing = (weekday && owedSomeMissing) || rng.chance(0.08);
    const siteAt = (hour) => {
      if (weekday && hour >= 9 && hour < 15) return 'day_program';
      if (!weekday && hour >= 11 && hour < 15 && date.getDate() % 3 === 0) return 'community';
      return rng.chance(0.02) ? 'other' : 'home';
    };

    const addBathroom = (when, answers) => {
      if (!past(when)) return;
      const occurredAt = toOffsetIso(when);
      // Logged a few minutes after the event, never after `now`.
      const loggedAt = new Date(Math.min(when.getTime() + rng.int(1, 20) * 60_000, now.getTime()));
      const draft = { ...newBathroomDraft({ id: rng.uuid(), occurredAt, siteCode: siteAt(when.getHours()) }), ...answers };
      draft.initials = rng.chance(0.6) ? rng.pick(STAFF) : null;
      let record = bathroomRecord(draft, toOffsetIso(loggedAt));
      if (rng.chance(0.01)) record = voidRecord(record, rng.pick(VOID_REASONS), toOffsetIso(loggedAt));
      bathroom.push(record);
    };

    if (!gap) {
      // Urination rhythm: on waking, then every 2–4 hours until bed.
      // On a "some may be missing" day, a few are never logged.
      let minutes = rng.int(6 * 60 + 15, 7 * 60 + 30);
      const bmHour = rng.weighted([[8, 3], [11, 2], [13, 1], [19, 2]]);
      let bmPlaced = false;
      const wantsBm = flushedYesterday ? rng.chance(0.85) : rng.chance(daysSinceBm >= 2 ? 0.8 : 0.6);
      const stoolAccident = stoolAccidentDays.has(index) || rng.chance(0.01);

      while (minutes < 21 * 60 + 30) {
        const when = at(Math.floor(minutes / 60), minutes % 60);
        minutes += rng.int(140, 240);
        if (someMissing && rng.chance(0.35)) continue;

        const combine = wantsBm && !bmPlaced && !stoolAccident && when.getHours() >= bmHour;
        if (combine) bmPlaced = true;
        else if (rng.chance(0.04)) {
          addBathroom(when, {
            event_code: 'attempt_no_output',
            attempt_target: rng.weighted([['urinate', 6], ['bm', 2], ['unsure', 1]]),
            pain_code: rng.weighted([['no', 6], ['unsure', 2], ['yes', inPain ? 3 : 0]]),
          });
          continue;
        }
        const event = combine ? (rng.chance(0.5) ? 'both' : 'pee') : (rng.chance(0.02) ? 'urine_accident' : 'pee');
        addBathroom(when, { ...urineAnswers(rng, inPain, when.getHours()), event_code: event, ...(event === 'both' ? stoolAnswers(rng, daysSinceBm, flushedYesterday) : {}), notes: rng.chance(0.03) ? rng.pick(PEE_NOTES) : null });
        if (combine && event === 'pee') {
          const bmTime = new Date(when.getTime() + rng.int(2, 10) * 60_000);
          addBathroom(bmTime, { event_code: 'bm', pain_code: rng.weighted([['no', 8], ['unsure', 1]]), ...stoolAnswers(rng, daysSinceBm, flushedYesterday), notes: rng.chance(0.05) ? rng.pick(BM_NOTES) : null });
        }
      }
      if (stoolAccident) {
        addBathroom(at(rng.int(9, 17), rng.int(0, 59)), {
          event_code: 'stool_accident', pain_code: rng.weighted([['no', 3], ['unsure', 2]]),
          bristol_type: rng.weighted([[5, 2], [6, 3], [7, 2]]), bm_amount: rng.pick(['small', 'medium', 'unsure']),
          notes: 'Demo: changed clothes after, settled quickly.',
        });
      }
      const hadBm = bmPlaced || stoolAccident;
      daysSinceBm = hadBm ? 0 : daysSinceBm + 1;

      // Bowel flush-care: an evening routine every 3–4 days.
      flushedYesterday = false;
      if (index === nextFlush) {
        const status = rng.weighted([['completed', 8], ['partial', 2], ['not_completed', 1], ['unable_to_confirm', 1]]);
        addBathroom(at(19, rng.int(0, 45)), { event_code: 'bowel_care', bowel_care_status: status });
        flushedYesterday = status === 'completed' || status === 'partial';
        nextFlush = index + rng.int(3, 4);
      }

      // Handoffs are weekday-only. A forced miss or "some may be missing" that
      // lands on a weekend carries to the next weekday.
      if (weekday) {
        const skip = owedMissingHandoff ? rng.pick(['home_am', 'day_pm']) : null;
        owedMissingHandoff = false;
        if (skip !== 'home_am' && !rng.chance(0.03)) addHandoff('home_am', at(7, rng.int(30, 59)));
        if (skip !== 'day_pm' && !rng.chance(0.03)) addHandoff('day_pm', at(15, rng.int(0, 25)));
        owedSomeMissing = false;
      }
    } else {
      daysSinceBm += 1;
      if (index === nextFlush) nextFlush += 1;
    }

    function addHandoff(type, when) {
      if (!past(when)) return;
      const occurredAt = toOffsetIso(when);
      const draft = { ...newHandoffDraft({ id: rng.uuid(), type, occurredAt, siteCode: type === 'home_am' ? 'home' : 'day_program' }), ...handoffAnswers(rng, type, inPain, someMissing) };
      draft.initials = rng.chance(0.5) ? rng.pick(STAFF) : null;
      const loggedAt = new Date(Math.min(when.getTime() + rng.int(1, 15) * 60_000, now.getTime()));
      let record = handoffRecord(draft, toOffsetIso(loggedAt));
      if (rng.chance(0.01)) record = voidRecord(record, rng.pick(VOID_REASONS), toOffsetIso(loggedAt));
      handoffs.push(record);
    }
  }

  const byTime = (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  return { bathroom_events: bathroom.sort(byTime), handoffs: handoffs.sort(byTime) };
}

function urineAnswers(rng, inPain, hour) {
  const pain_code = inPain
    ? rng.weighted([['yes', 4], ['unsure', 2], ['no', 4]])
    : rng.weighted([['no', 90], ['unsure', 6], ['yes', 1]]);
  // Day program staff assess less often; "not assessed" is never "normal".
  const urine_change_code = rng.weighted([
    ['none_noticed', hour >= 9 && hour < 15 ? 5 : 8],
    ['not_assessed', hour >= 9 && hour < 15 ? 4 : 2],
    ['change', inPain ? 5 : 0.3],
  ]);
  const answers = { pain_code, urine_change_code };
  if (urine_change_code === 'change') {
    const details = new Set([rng.weighted([['darker', 4], ['cloudy', 3], ['strong_odor', 3], ['pink_red', 0.5], ['other', 0.5]])]);
    if (rng.chance(0.4)) details.add(rng.pick(['darker', 'cloudy', 'strong_odor']));
    answers.urine_change_details = [...details];
    if (details.has('other')) answers.urine_change_note = 'Demo: looked foamy';
  }
  if (pain_code === 'yes' || answers.urine_change_details) {
    answers.concern_codes = rng.weighted([
      [['nurse_notified'], 4], [['no_concern'], 3], [['supervisor_notified', 'follow_up_needed'], 1], [[], 2],
    ]);
  }
  return answers;
}

function stoolAnswers(rng, daysSinceBm, flushedYesterday) {
  let bristol_type;
  if (rng.chance(0.04)) bristol_type = 'unable';
  else if (flushedYesterday) bristol_type = rng.weighted([[4, 3], [5, 4], [6, 2]]);
  else if (daysSinceBm >= 2) bristol_type = rng.weighted([[1, 2], [2, 4], [3, 3], [4, 1]]);
  else bristol_type = rng.weighted([[2, 1], [3, 4], [4, 5], [5, 2]]);
  return { bristol_type, bm_amount: rng.weighted([['small', 3], ['medium', 4], ['large', 2], ['unsure', 1]]) };
}

const COMFORT_WEIGHTS = { normal: [[2, 1], [3, 4], [4, 6], [5, 2], ['unable', 0.4]], pain: [[1, 1], [2, 4], [3, 4], [4, 1], ['unable', 0.4]] };
const BEHAVIOR_PICKS = [['slapping_self', 4], ['hitting', 2], ['pinching', 2], ['spitting', 1], ['slapping_others', 1], ['kicking', 1], ['other', 1]];

function handoffAnswers(rng, type, inPain, someMissing) {
  const often = (common, ...rest) => rng.weighted([[common, 10], ...rest.map((code) => [code, 1.5])]);
  const answers = {
    alertness_code: often('typical', 'tired', 'less_alert', 'not_observed'),
    comfort: rng.weighted(inPain ? COMFORT_WEIGHTS.pain : COMFORT_WEIGHTS.normal),
    bathroom_coverage_code: someMissing ? rng.weighted([['some_missing', 4], ['unsure', 1]]) : rng.weighted([['all_logged', 30], ['unsure', 1], ['none_known', 0.3]]),
    handoff_note: rng.chance(0.15) ? rng.pick(HANDOFF_NOTES) : null,
    positive_note: rng.chance(0.4) ? rng.pick(POSITIVES) : null,
  };
  const state = rng.weighted([['none_observed', 14], ['some', inPain ? 8 : 4], ['not_observed', 1]]);
  answers.behavior_state = state;
  answers.behavior_codes = [];
  answers.behavior_other_note = null;
  if (state === 'some') {
    const codes = new Set([rng.weighted(BEHAVIOR_PICKS)]);
    if (rng.chance(0.3)) codes.add(rng.weighted(BEHAVIOR_PICKS));
    answers.behavior_codes = [...codes];
    if (codes.has('other')) answers.behavior_other_note = 'Demo: threw a cushion';
  }
  if (type === 'home_am') {
    Object.assign(answers, {
      sleep_code: often('slept_well', 'disrupted', 'woke_early', 'woke_late', 'unsure'),
      breakfast_code: often('ate_all', 'ate_some', 'did_not_eat', 'not_observed'),
      routine_code: inPain ? often('more_support', 'typical', 'challenging') : often('typical', 'more_support', 'challenging', 'not_observed'),
    });
  } else {
    Object.assign(answers, {
      work_tasks_code: often('typical_support', 'more_independent', 'more_support', 'not_observed'),
      am_support_code: often('typical_support', 'more_independent', 'more_support', 'not_observed'),
      pm_support_code: often('typical_support', 'more_independent', 'more_support', 'not_observed'),
      lunch_code: often('ate_all', 'ate_some', 'did_not_eat', 'not_observed'),
      still_hungry_code: often('no', 'yes', 'unsure', 'not_observed'),
    });
  }
  return answers;
}
