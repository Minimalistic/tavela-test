// Records as words: the answer labels the detail view shows, and (session 5)
// the PDF/CSV export will reuse. Pure: no DOM, so node:test covers it.
import {
  EVENTS, PAIN, URINE_CHANGE, URINE_DETAILS, BRISTOL, BM_AMOUNT, ATTEMPT_TARGET,
  BOWEL_CARE_STATUS, CONCERNS, labelFor,
} from './bathroom.js';
import { QUESTIONS, SUMMARY_TYPES, TEXT_LABELS, BEHAVIORS } from './handoff.js';
import { formatDateTime } from './time.js';

// A kind this version doesn't know can only come from a newer one (read-only
// mode): saves and restores refuse it. It gets a plain name, never its code.
export const NEWER_ENTRY = 'Entry from a newer version';

export function entryTitle(record) {
  const [options, code] = record.summary_type ? [SUMMARY_TYPES, record.summary_type] : [EVENTS, record.event_code];
  return options.some((option) => option.code === code) ? labelFor(options, code) : NEWER_ENTRY;
}

// For list previews and the detail view.
export function behaviorSummary(record) {
  if (record.behavior_state === 'none_observed') return 'None observed';
  if (record.behavior_state === 'not_observed') return 'Not observed';
  return record.behavior_codes
    .map((code) => code === 'other' && record.behavior_other_note
      ? `Other (${record.behavior_other_note})`
      : labelFor(BEHAVIORS, code))
    .join(', ');
}

function bathroomRows(record, name) {
  return [
    ['What happened', labelFor(EVENTS, record.event_code)],
    ['Tried to', record.attempt_target && labelFor(ATTEMPT_TARGET, record.attempt_target)],
    [`${name} said "ow" or showed discomfort`, record.pain_code && labelFor(PAIN, record.pain_code)],
    ['Change in urine', record.urine_change_code && labelFor(URINE_CHANGE, record.urine_change_code)],
    ['What changed', record.urine_change_details.map((c) => labelFor(URINE_DETAILS, c)).join(', ')],
    ['About the change', record.urine_change_note],
    ['Bristol type', record.bristol_type !== null && labelFor(BRISTOL, record.bristol_type)],
    ['BM amount', record.bm_amount && labelFor(BM_AMOUNT, record.bm_amount)],
    ['Flush-care status', record.bowel_care_status && labelFor(BOWEL_CARE_STATUS, record.bowel_care_status)],
    ['Concern reported', record.concern_codes.map((c) => labelFor(CONCERNS, c)).join(', ')],
    ['Notable', record.notes],
  ];
}

function handoffRows(record, name) {
  // An Update type from a newer version has no questions here; its note
  // still shows.
  if (!QUESTIONS[record.summary_type]) return [['Note', record.handoff_note]];
  return [
    ...QUESTIONS[record.summary_type].map((question) => [
      question.legend(name),
      question.field === 'behaviors' ? behaviorSummary(record) : labelFor(question.options, record[question.field]),
    ]),
    [TEXT_LABELS[record.summary_type].handoff_note, record.handoff_note],
  ];
}

// [label, value] pairs for a record's answers; a falsy value means "not asked".
export function answerRows(record, name) {
  return record.summary_type ? handoffRows(record, name) : bathroomRows(record, name);
}
