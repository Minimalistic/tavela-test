// Bathroom Check-In rules (docs/SPEC.md §7). Pure functions: no DOM, no storage,
// so the same rules drive the form, the tests and (later) reports and restore.

export const SCHEMA_VERSION = 1;

// `section` groups the tiles on the form (Jason, 10-20); codes are unchanged.
export const EVENTS = [
  { code: 'pee', label: 'Pee', section: 'In the toilet' },
  { code: 'bm', label: 'BM', section: 'In the toilet' },
  { code: 'both', label: 'Pee and BM', section: 'In the toilet' },
  { code: 'urine_accident', label: 'Urine accident', section: 'Accident' },
  { code: 'stool_accident', label: 'Stool accident', section: 'Accident' },
  { code: 'attempt_no_output', label: 'Tried, no output', section: 'Other' },
  { code: 'bowel_care', label: 'Bowel flush-care', section: 'Other' },
];

// The form's wording for the same events: "Wet" and "Soiled" are what staff
// say out loud (docs/research/reports/Continence log wording.md). Records
// keep the names above; reports say "Incontinence episode". Codes never change.
const FORM_WORDS = { urine_accident: 'Wet', stool_accident: 'Soiled' };
export const FORM_EVENTS = EVENTS.map((event) => ({ ...event, label: FORM_WORDS[event.code] ?? event.label }));

export const PAIN = [
  { code: 'yes', label: 'Yes' },
  { code: 'no', label: 'No' },
  { code: 'unsure', label: 'Unsure' },
];

export const URINE_CHANGE = [
  { code: 'none_noticed', label: 'No change noticed' },
  { code: 'change', label: 'Change noticed' },
  { code: 'not_assessed', label: 'Not assessed' },
];

export const URINE_DETAILS = [
  { code: 'darker', label: 'Darker' },
  { code: 'cloudy', label: 'Cloudy' },
  { code: 'pink_red', label: 'Pink/red' },
  { code: 'strong_odor', label: 'Strong/unusual smell' },
  { code: 'other', label: 'Other' },
];

// Original plain-language descriptions (SPEC §7.2: no copied chart images).
export const BRISTOL = [
  { code: 1, label: 'Type 1', description: 'Separate hard lumps', group: 'Hard' },
  { code: 2, label: 'Type 2', description: 'Lumpy and hard, log-shaped', group: 'Hard' },
  { code: 3, label: 'Type 3', description: 'Log-shaped with cracks', group: 'Formed' },
  { code: 4, label: 'Type 4', description: 'Smooth, soft log', group: 'Formed' },
  { code: 5, label: 'Type 5', description: 'Soft pieces with clear edges', group: 'Softer' },
  { code: 6, label: 'Type 6', description: 'Mushy, ragged pieces', group: 'Looser' },
  { code: 7, label: 'Type 7', description: 'Watery, no solid pieces', group: 'Liquid' },
  { code: 'unable', label: 'Unable to tell', description: '', group: '' },
];

export const BM_AMOUNT = [
  { code: 'small', label: 'Small' },
  { code: 'medium', label: 'Medium' },
  { code: 'large', label: 'Large' },
  { code: 'unsure', label: 'Unsure' },
];

export const ATTEMPT_TARGET = [
  { code: 'urinate', label: 'Urinate' },
  { code: 'bm', label: 'Have BM' },
  { code: 'unsure', label: 'Unsure' },
];

export const BOWEL_CARE_STATUS = [
  { code: 'completed', label: 'Completed' },
  { code: 'partial', label: 'Partial' },
  { code: 'not_completed', label: 'Not completed' },
  { code: 'unable_to_confirm', label: 'Unable to confirm' },
];

export const NO_CONCERN = 'no_concern';
export const CONCERNS = [
  { code: 'nurse_notified', label: 'Nurse notified' },
  { code: 'supervisor_notified', label: 'Supervisor notified' },
  { code: 'follow_up_needed', label: 'Follow-up needed' },
  { code: NO_CONCERN, label: 'No concern identified' },
];

const URINE_EVENTS = new Set(['pee', 'both', 'urine_accident']);
const STOOL_EVENTS = new Set(['bm', 'both', 'stool_accident']);

// Value each conditional field takes when hidden. Never '' (SPEC §2.3).
const CLEARED = {
  pain_code: null,
  urine_change_code: null,
  urine_change_details: [],
  urine_change_note: null,
  bristol_type: null,
  bm_amount: null,
  attempt_target: null,
  bowel_care_status: null,
  concern_codes: [],
};

export function labelFor(options, code) {
  return options.find((option) => option.code === code)?.label ?? String(code);
}

export function newBathroomDraft({ id, occurredAt, siteCode = null }) {
  return {
    id,
    schema_version: SCHEMA_VERSION,
    occurred_at: occurredAt,
    created_at: null,
    updated_at: null,
    site_code: siteCode,
    event_code: null,
    ...structuredClone(CLEARED),
    initials: null,
    notes: null,
    voided_at: null,
    void_reason: null,
  };
}

export function visibleFields(draft) {
  const visible = new Set();
  const event = draft.event_code;
  if (!event) return visible;

  if (event !== 'bowel_care') visible.add('pain_code');
  if (URINE_EVENTS.has(event)) {
    visible.add('urine_change_code');
    if (draft.urine_change_code === 'change') {
      visible.add('urine_change_details');
      visible.add('urine_change_note');
    }
  }
  if (STOOL_EVENTS.has(event)) {
    visible.add('bristol_type');
    visible.add('bm_amount');
  }
  if (event === 'attempt_no_output') visible.add('attempt_target');
  if (event === 'bowel_care') visible.add('bowel_care_status');

  const painYes = visible.has('pain_code') && draft.pain_code === 'yes';
  const urineChanged = visible.has('urine_change_details') && draft.urine_change_details.length > 0;
  if (painYes || urineChanged) visible.add('concern_codes');
  return visible;
}

// Hidden fields are cleared, not just hidden (SPEC §6). Two passes because
// clearing one field (pain) can hide another (concern).
export function normalize(draft) {
  let result = draft;
  for (let pass = 0; pass < 2; pass++) {
    const visible = visibleFields(result);
    const next = { ...result };
    for (const [field, empty] of Object.entries(CLEARED)) {
      if (!visible.has(field)) next[field] = structuredClone(empty);
    }
    result = next;
  }
  return result;
}

export function painRequired(draft) {
  const event = draft.event_code;
  if (URINE_EVENTS.has(event)) return true;
  return event === 'attempt_no_output' && draft.attempt_target === 'urinate';
}

// Returns { field: message } for every required answer still missing.
export function validate(draft) {
  const errors = {};
  const visible = visibleFields(draft);
  if (!draft.occurred_at || Number.isNaN(Date.parse(draft.occurred_at))) {
    errors.occurred_at = 'Enter when this happened.';
  }
  if (!draft.site_code) errors.site_code = 'Choose where.';
  if (!draft.event_code) errors.event_code = 'Choose what happened.';
  if (visible.has('pain_code') && painRequired(draft) && !draft.pain_code) {
    errors.pain_code = 'Choose Yes, No, or Unsure.';
  }
  if (visible.has('urine_change_code') && !draft.urine_change_code) {
    errors.urine_change_code = 'Choose one.';
  }
  if (visible.has('urine_change_details') && draft.urine_change_details.length === 0) {
    errors.urine_change_details = 'Choose at least one change.';
  }
  if (visible.has('bristol_type') && draft.bristol_type === null) {
    errors.bristol_type = 'Choose a type, or Unable to tell.';
  }
  if (visible.has('attempt_target') && !draft.attempt_target) {
    errors.attempt_target = 'Choose one.';
  }
  if (visible.has('bowel_care_status') && !draft.bowel_care_status) {
    errors.bowel_care_status = 'Choose one.';
  }
  return errors;
}

// Shared with the handoff forms; re-exported so existing imports keep working.
export { isFutureTime } from './time.js';

// SPEC §7.1: shown, never blocking.
export function showsConcernReminder(draft) {
  const visible = visibleFields(draft);
  if (visible.has('pain_code') && draft.pain_code === 'yes') return true;
  if (visible.has('urine_change_details') && draft.urine_change_details.includes('pink_red')) return true;
  if (draft.event_code === 'attempt_no_output') return true;
  return visible.has('concern_codes') && draft.concern_codes.some((code) => code !== NO_CONCERN);
}

// "No concern identified" is exclusive with the other concern codes.
export function toggleConcern(codes, code) {
  if (codes.includes(code)) return codes.filter((c) => c !== code);
  if (code === NO_CONCERN) return [NO_CONCERN];
  return [...codes.filter((c) => c !== NO_CONCERN), code];
}

export function toggleDetail(details, code) {
  return details.includes(code) ? details.filter((c) => c !== code) : [...details, code];
}

function blankToNull(text) {
  const trimmed = (text ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function toRecord(draft, nowIso) {
  const record = normalize(draft);
  return {
    ...record,
    schema_version: SCHEMA_VERSION,
    created_at: record.created_at ?? nowIso,
    updated_at: nowIso,
    urine_change_note: blankToNull(record.urine_change_note),
    initials: blankToNull(record.initials),
    notes: blankToNull(record.notes),
  };
}
