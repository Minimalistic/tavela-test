// Records as words: the answer labels the detail view shows, and (session 5)
// the PDF/CSV export will reuse. Pure: no DOM, so node:test covers it.
import {
  EVENTS, PAIN, URINE_CHANGE, URINE_DETAILS, BRISTOL, BM_AMOUNT, ATTEMPT_TARGET,
  BOWEL_CARE_STATUS, CONCERNS, labelFor,
} from './bathroom.js';
import { QUESTIONS, SUMMARY_TYPES, TEXT_LABELS, BEHAVIORS } from './handoff.js';
import { formatDateTime } from './time.js';

export function entryTitle(record) {
  return record.summary_type
    ? labelFor(SUMMARY_TYPES, record.summary_type)
    : labelFor(EVENTS, record.event_code);
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

// Records says this after a void, since the entry leaves the list (review
// backlog: voiding used to land on Records with no word of what happened).
export function voidedNotice(record) {
  return `Voided: ${entryTitle(record)}, ${formatDateTime(record.occurred_at)}. It's kept on this device; find it with Show voided under Filters.`;
}
