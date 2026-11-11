// CSV export (docs/SPEC.md §12, ACCEPTANCE.md "CSV export"). Pure functions:
// records in, file text out. Two files, one row per record, each coded answer
// as its stable code and the words people read.
import {
  EVENTS, PAIN, URINE_CHANGE, URINE_DETAILS, BRISTOL, BM_AMOUNT, ATTEMPT_TARGET,
  BOWEL_CARE_STATUS, CONCERNS,
} from './bathroom.js';
import { QUESTIONS, SUMMARY_TYPES, BEHAVIORS, BEHAVIOR_STATES } from './handoff.js';
import { filterEntries } from './entries.js';
import { localDate } from './time.js';

// Excel, Numbers and Sheets all read a leading `=`, `+`, `-` or `@` (and a
// tab or return before one) as a formula. A note typed that way must stay
// text, so it gets the leading apostrophe spreadsheets treat as "this is text".
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// UTF-8 byte-order mark so Excel reads accents and arrows right; CRLF per RFC 4180.
export function toCsv(rows) {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// "Type 4: Smooth, soft log", "3: Typical or mixed", "Pee". Null when unasked.
function words(options, code) {
  if (code === null || code === undefined) return null;
  const option = options.find((o) => o.code === code);
  if (!option) return String(code);
  return option.description ? `${option.label}: ${option.description}` : option.label;
}

const LIST_JOIN = '; ';
const listCodes = (codes) => (codes?.length ? codes.join(LIST_JOIN) : null);
const listWords = (options, codes) => (codes?.length ? codes.map((c) => words(options, c)).join(LIST_JOIN) : null);

const pad = (n) => String(n).padStart(2, '0');
// 24-hour local time, so a spreadsheet sorts it as text without AM/PM trouble.
function localTime(iso) {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Columns every row starts and ends with.
const LEAD = ['tracker_id', 'id', 'date', 'time', 'occurred_at', 'site_code', 'site'];
const TAIL = ['initials', 'created_at', 'updated_at', 'voided_at', 'void_reason'];

function leadCells(record, ctx) {
  return [ctx.datasetId, record.id, localDate(record.occurred_at), localTime(record.occurred_at),
    record.occurred_at, record.site_code, ctx.siteLabels[record.site_code] ?? record.site_code];
}
const tailCells = (record) => [record.initials, record.created_at, record.updated_at, record.voided_at, record.void_reason];

// [header, header, getter] for each coded bathroom answer.
const BATHROOM_ANSWERS = [
  ['event_code', 'event', (r) => r.event_code, (r) => words(EVENTS, r.event_code)],
  ['attempt_code', 'attempt', (r) => r.attempt_target, (r) => words(ATTEMPT_TARGET, r.attempt_target)],
  ['pain_code', 'pain', (r) => r.pain_code, (r) => words(PAIN, r.pain_code)],
  ['urine_change_code', 'urine_change', (r) => r.urine_change_code, (r) => words(URINE_CHANGE, r.urine_change_code)],
  ['urine_detail_codes', 'urine_details', (r) => listCodes(r.urine_change_details), (r) => listWords(URINE_DETAILS, r.urine_change_details)],
  ['bristol_code', 'bristol', (r) => r.bristol_type, (r) => words(BRISTOL, r.bristol_type)],
  ['bm_amount_code', 'bm_amount', (r) => r.bm_amount, (r) => words(BM_AMOUNT, r.bm_amount)],
  ['bowel_care_code', 'bowel_care', (r) => r.bowel_care_status, (r) => words(BOWEL_CARE_STATUS, r.bowel_care_status)],
  ['concern_codes', 'concerns', (r) => listCodes(r.concern_codes), (r) => listWords(CONCERNS, r.concern_codes)],
];

export const BATHROOM_HEADER = [
  ...LEAD,
  ...BATHROOM_ANSWERS.flatMap(([code, label]) => [code, label]),
  'urine_change_note', 'notes',
  ...TAIL,
];

function bathroomRow(record, ctx) {
  return [
    ...leadCells(record, ctx),
    ...BATHROOM_ANSWERS.flatMap(([, , code, label]) => [code(record), label(record)]),
    record.urine_change_note, record.notes,
    ...tailCells(record),
  ];
}

// Every question either Update asks, in form order, each once. A question the
// row's Update doesn't ask is left blank.
const HANDOFF_QUESTIONS = [];
for (const type of SUMMARY_TYPES) {
  for (const question of QUESTIONS[type.code]) {
    if (question.field !== 'behaviors' && !HANDOFF_QUESTIONS.some((q) => q.field === question.field)) {
      HANDOFF_QUESTIONS.push(question);
    }
  }
}
const codeHeader = (field) => (field.endsWith('_code') ? field : `${field}_code`);
const labelHeader = (field) => field.replace(/_code$/, '');

export const HANDOFF_HEADER = [
  ...LEAD.slice(0, 2), 'type_code', 'type', ...LEAD.slice(2),
  ...HANDOFF_QUESTIONS.flatMap(({ field }) => [codeHeader(field), labelHeader(field)]),
  'behavior_state', 'behavior_codes', 'behaviors', 'behavior_other_note',
  'handoff_note', 'positive_note',
  ...TAIL,
];

function behaviorWords(record) {
  if (record.behavior_state === 'some') return listWords(BEHAVIORS, record.behavior_codes);
  return BEHAVIOR_STATES.find((s) => s.code === record.behavior_state)?.label ?? null;
}

function handoffRow(record, ctx) {
  const lead = leadCells(record, ctx);
  // The handoff's own date_local is the date it's "for"; it matches occurred_at's day.
  lead[2] = record.date_local;
  return [
    ...lead.slice(0, 2), record.summary_type, words(SUMMARY_TYPES, record.summary_type), ...lead.slice(2),
    ...HANDOFF_QUESTIONS.flatMap(({ field, options }) => (Object.hasOwn(record, field)
      ? [record[field], words(options, record[field])]
      : [null, null])),
    record.behavior_state, listCodes(record.behavior_codes), behaviorWords(record), record.behavior_other_note,
    record.handoff_note, record.positive_note,
    ...tailCells(record),
  ];
}

// The entries a window holds: same filter as Reports and Records, oldest
// first (spreadsheets read top-down).
export function exportEntries(records, { from, to, site = null, includeVoided = false }) {
  return filterEntries(records, { from, to, site, showVoided: includeVoided }).reverse();
}

export function csvFilename({ datasetId, kind, from, to, demo = false }) {
  return `${demo ? 'DEMO_' : ''}${datasetId}_${kind}_${from}_to_${to}.csv`;
}

// The print job's title, which a "Save as PDF" uses as the file name (SPEC
// §12's filename rule: never a name, only the Tracker ID and dates).
export function reportTitle({ datasetId, from, to, demo = false }) {
  return `${demo ? 'DEMO_' : ''}${datasetId}_report_${from}_to_${to}`;
}

// Returns { files: [{ filename, text, rows }], entries } for one window.
// Both files are always made, so a team's folder has a matching pair even
// when one kind had no entries (header only).
export function buildCsvExport({ bathroomEvents, handoffs, datasetId, siteLabels, from, to, site = null, includeVoided = false, demo = false }) {
  const ctx = { datasetId, siteLabels };
  const window = { from, to, site, includeVoided };
  const events = exportEntries(bathroomEvents, window);
  const updates = exportEntries(handoffs, window);
  return {
    entries: events.length + updates.length,
    files: [
      { filename: csvFilename({ datasetId, kind: 'events', from, to, demo }), rows: events.length,
        text: toCsv([BATHROOM_HEADER, ...events.map((r) => bathroomRow(r, ctx))]) },
      { filename: csvFilename({ datasetId, kind: 'handoffs', from, to, demo }), rows: updates.length,
        text: toCsv([HANDOFF_HEADER, ...updates.map((r) => handoffRow(r, ctx))]) },
    ],
  };
}

// Counts for the export screen, before anything is made.
export function exportCounts({ bathroomEvents, handoffs, from, to, site = null }) {
  const count = (list, includeVoided) => exportEntries(list, { from, to, site, includeVoided }).length;
  const standing = count(bathroomEvents, false) + count(handoffs, false);
  const all = count(bathroomEvents, true) + count(handoffs, true);
  return { standing, voided: all - standing };
}
