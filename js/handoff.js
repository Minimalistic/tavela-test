// Morning and Afternoon Update rules (docs/SPEC.md §8, §15.2). Pure functions:
// no DOM, no storage. Stored codes are stable; labels can change freely.
import { localDate } from './time.js';

export const SCHEMA_VERSION = 1;

export const SUMMARY_TYPES = [
  { code: 'home_am', label: 'Morning Update', direction: 'Home → day program' },
  { code: 'day_pm', label: 'Afternoon Update', direction: 'Day program → home' },
];

const SLEEP = [
  { code: 'slept_well', label: 'Slept well' },
  { code: 'disrupted', label: 'Disrupted sleep' },
  { code: 'woke_early', label: 'Woke early' },
  { code: 'woke_late', label: 'Woke late' },
  { code: 'unsure', label: 'Unsure' },
];

const MEAL = [
  { code: 'ate_all', label: 'Ate all' },
  { code: 'ate_some', label: 'Ate some' },
  { code: 'did_not_eat', label: 'Did not eat' },
  { code: 'not_observed', label: 'Not observed' },
];

const ROUTINE = [
  { code: 'typical', label: 'Typical' },
  { code: 'more_support', label: 'More support needed' },
  { code: 'challenging', label: 'Challenging' },
  { code: 'not_observed', label: 'Not observed' },
];

const ALERTNESS = [
  { code: 'typical', label: 'Typical' },
  { code: 'tired', label: 'Tired' },
  { code: 'less_alert', label: 'Less alert' },
  { code: 'not_observed', label: 'Not observed' },
];

const SUPPORT = [
  { code: 'more_independent', label: 'More independent' },
  { code: 'typical_support', label: 'Typical support' },
  { code: 'more_support', label: 'More support' },
  { code: 'not_observed', label: 'Not observed' },
];

const HUNGRY = [
  { code: 'yes', label: 'Yes' },
  { code: 'no', label: 'No' },
  { code: 'unsure', label: 'Unsure' },
  { code: 'not_observed', label: 'Not observed' },
];

export const COVERAGE = [
  { code: 'all_logged', label: 'All known events logged' },
  { code: 'some_missing', label: 'Some may be missing' },
  { code: 'none_known', label: 'No known events' },
  { code: 'unsure', label: 'Unsure' },
];

// SPEC §8.3: observational, not a validated clinical scale.
export const COMFORT = [
  { code: 1, label: '1', description: 'Marked distress or discomfort' },
  { code: 2, label: '2', description: 'More unsettled than usual' },
  { code: 3, label: '3', description: 'Typical or mixed' },
  { code: 4, label: '4', description: 'Comfortable, engaged' },
  { code: 5, label: '5', description: 'Notably at ease, positively engaged' },
  { code: 'unable', label: 'Unable to assess', description: '' },
];

// Self-directed and other-directed behaviors are separate codes, never merged.
export const BEHAVIORS = [
  { code: 'hitting', label: 'Hitting' },
  { code: 'spitting', label: 'Spitting' },
  { code: 'slapping_self', label: 'Slapping self' },
  { code: 'slapping_others', label: 'Slapping others' },
  { code: 'pinching', label: 'Pinching' },
  { code: 'kicking', label: 'Kicking' },
  { code: 'other', label: 'Other' },
];
export const BEHAVIOR_STATES = [
  { code: 'none_observed', label: 'None observed' },
  { code: 'not_observed', label: 'Not observed (wasn\'t there or couldn\'t see)' },
];

// `behaviors` is one question stored as two fields: behavior_codes[] and
// behavior_state (some / none_observed / not_observed).
const shared = {
  alertness: { field: 'alertness_code', legend: () => 'Alertness', options: ALERTNESS },
  comfort: { field: 'comfort', legend: () => 'Comfort / mood', options: COMFORT },
  behaviors: { field: 'behaviors', legend: () => 'Behaviors observed', options: [...BEHAVIORS, ...BEHAVIOR_STATES] },
  coverage: { field: 'bathroom_coverage_code', legend: () => 'Were bathroom events documented?', options: COVERAGE },
};

export const QUESTIONS = {
  home_am: [
    { field: 'sleep_code', legend: (name) => `How did ${name} sleep?`, options: SLEEP },
    { field: 'breakfast_code', legend: () => 'Breakfast', options: MEAL },
    { field: 'routine_code', legend: () => 'Morning routine', options: ROUTINE },
    shared.alertness, shared.comfort, shared.behaviors, shared.coverage,
  ],
  day_pm: [
    { field: 'work_tasks_code', legend: () => 'Work tasks', options: SUPPORT },
    { field: 'am_support_code', legend: () => 'AM support needed', options: SUPPORT },
    { field: 'pm_support_code', legend: () => 'PM support needed', options: SUPPORT },
    { field: 'lunch_code', legend: () => 'Lunch', options: MEAL },
    { field: 'still_hungry_code', legend: (name) => `Did ${name} still seem hungry?`, options: HUNGRY },
    shared.alertness, shared.comfort, shared.behaviors, shared.coverage,
  ],
};

export const TEXT_LABELS = {
  home_am: { handoff_note: 'Notes to help the day program', positive_note: 'A positive from home' },
  day_pm: { handoff_note: 'Notes to help home', positive_note: 'A positive from the day program' },
};

export function newHandoffDraft({ id, type, occurredAt, siteCode = null }) {
  const answers = {};
  for (const { field } of QUESTIONS[type]) {
    if (field === 'behaviors') {
      answers.behavior_codes = [];
      answers.behavior_state = null;
      answers.behavior_other_note = null;
    } else {
      answers[field] = null;
    }
  }
  return {
    id,
    schema_version: SCHEMA_VERSION,
    summary_type: type,
    occurred_at: occurredAt,
    date_local: null,
    created_at: null,
    updated_at: null,
    site_code: siteCode,
    ...answers,
    handoff_note: null,
    positive_note: null,
    initials: null,
    voided_at: null,
    void_reason: null,
  };
}

// Returns the behavior fields to merge into the draft. The "What was it?"
// note only exists while Other is ticked; unticking clears it (SPEC §6).
export function toggleBehavior(draft, code) {
  if (code === 'none_observed' || code === 'not_observed') {
    return draft.behavior_state === code
      ? { behavior_codes: [], behavior_state: null, behavior_other_note: null }
      : { behavior_codes: [], behavior_state: code, behavior_other_note: null };
  }
  const codes = draft.behavior_codes.includes(code)
    ? draft.behavior_codes.filter((c) => c !== code)
    : [...draft.behavior_codes, code];
  return {
    behavior_codes: codes,
    behavior_state: codes.length > 0 ? 'some' : null,
    behavior_other_note: codes.includes('other') ? draft.behavior_other_note : null,
  };
}

export function behaviorChecked(draft, code) {
  return draft.behavior_state === code || draft.behavior_codes.includes(code);
}

const BEHAVIOR_CODES = new Set(BEHAVIORS.map((b) => b.code));

// Returns { field: message } for every required answer still missing.
export function validate(draft) {
  const errors = {};
  if (!draft.occurred_at || Number.isNaN(Date.parse(draft.occurred_at))) {
    errors.occurred_at = 'Enter when this update is for.';
  }
  if (!draft.site_code) errors.site_code = 'Choose where.';
  for (const { field, options } of QUESTIONS[draft.summary_type] ?? []) {
    if (field === 'behaviors') {
      const { behavior_state: state, behavior_codes: codes } = draft;
      const ok = (state === 'some' && codes.length > 0 && codes.every((c) => BEHAVIOR_CODES.has(c)))
        || ((state === 'none_observed' || state === 'not_observed') && codes.length === 0);
      if (!ok) errors.behaviors = 'Choose the behaviors seen, None observed, or Not observed.';
    } else if (!options.some((option) => option.code === draft[field])) {
      errors[field] = 'Choose one.';
    }
  }
  return errors;
}

function blankToNull(text) {
  const trimmed = (text ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function toRecord(draft, nowIso) {
  return {
    ...draft,
    schema_version: SCHEMA_VERSION,
    date_local: localDate(draft.occurred_at),
    created_at: draft.created_at ?? nowIso,
    updated_at: nowIso,
    behavior_other_note: draft.behavior_codes.includes('other') ? blankToNull(draft.behavior_other_note) : null,
    handoff_note: blankToNull(draft.handoff_note),
    positive_note: blankToNull(draft.positive_note),
    initials: blankToNull(draft.initials),
  };
}
