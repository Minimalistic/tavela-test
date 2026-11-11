// What each Reports count counts, as one rule per kind of entry. counts.js
// counts with these and the Records filter (entries.js `match`) keeps the
// entries they accept, so a tapped total and the list it opens always agree
// (SPEC §10). Pure functions; nothing here judges a value.
import { BRISTOL, BOWEL_CARE_STATUS } from './bathroom.js';
import { BEHAVIORS } from './handoff.js';

const URINATIONS = new Set(['pee', 'both', 'urine_accident']);
const BMS = new Set(['bm', 'both', 'stool_accident']);
const APPEARANCE = new Set(['darker', 'cloudy', 'pink_red', 'other']);
const INCOMPLETE_COVERAGE = new Set(['some_missing', 'unsure']);

const isCheckIn = (record) => !record.summary_type;

export const isUrination = (record) => isCheckIn(record) && URINATIONS.has(record.event_code);
export const isBm = (record) => isCheckIn(record) && BMS.has(record.event_code);
// Appearance and odor are read only where the urine question was asked.
export const urineLookedDifferent = (record) => isUrination(record) && record.urine_change_details.some((code) => APPEARANCE.has(code));
export const strongSmell = (record) => isUrination(record) && record.urine_change_details.includes('strong_odor');
export const hadPain = (record) => isCheckIn(record) && record.pain_code === 'yes';
export const isFlushCare = (record) => isCheckIn(record) && record.event_code === 'bowel_care';
export const coverageIncomplete = (record) => !isCheckIn(record) && INCOMPLETE_COVERAGE.has(record.bathroom_coverage_code);

// A match is a short key kept in memory (never in a URL): a fixed kind, or a
// kind and a code ("bristol:4"). label says it in the Records filter line.
const FIXED = {
  urination: { label: 'Urinations', test: isUrination },
  bm: { label: 'BMs', test: isBm },
  pain: { label: 'Pain or "ow"', test: hadPain },
  urine_different: { label: 'Urine looked different', test: urineLookedDifferent },
  strong_smell: { label: 'Strong smell', test: strongSmell },
  flush_care: { label: 'Flush care', test: isFlushCare },
  urine_accident: { label: 'Incontinence, urine', test: (record) => isCheckIn(record) && record.event_code === 'urine_accident' },
  stool_accident: { label: 'Incontinence, bowel', test: (record) => isCheckIn(record) && record.event_code === 'stool_accident' },
  coverage_incomplete: { label: 'Updates marked "some may be missing" or "unsure"', test: coverageIncomplete },
};

const CODED = {
  bristol: (code) => {
    const type = BRISTOL.find((option) => String(option.code) === code);
    return type && { label: type.code === 'unable' ? 'Bristol type: unable to tell' : `Bristol type ${type.code}`, test: (record) => isBm(record) && record.bristol_type === type.code };
  },
  flush: (code) => {
    const status = BOWEL_CARE_STATUS.find((option) => option.code === code);
    return status && { label: `Flush care: ${status.label}`, test: (record) => isFlushCare(record) && record.bowel_care_status === code };
  },
  behavior: (code) => {
    const behavior = BEHAVIORS.find((option) => option.code === code);
    return behavior && { label: `Behavior: ${behavior.label}`, test: (record) => !isCheckIn(record) && record.behavior_codes.includes(code) };
  },
};

// { label, test } for a match key, or null for one this version doesn't know.
export function matchRule(key) {
  if (typeof key !== 'string') return null;
  if (Object.hasOwn(FIXED, key)) return FIXED[key];
  const [kind, code, ...rest] = key.split(':');
  if (rest.length || !Object.hasOwn(CODED, kind)) return null;
  return CODED[kind](code) ?? null;
}
