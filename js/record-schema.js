// Checks records that come from outside the app (a restored backup) against
// the current schema, and copies them field by field. Nothing is spread from
// the file, so unknown fields, `__proto__` and the like never reach storage.
// One bad record rejects the whole restore. Pure functions.
import * as bathroom from './bathroom.js';
import * as handoff from './handoff.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { DATASET_ID_PATTERN } from './dataset.js';
import { CURRENT_SCHEMA_VERSION } from './migrations.js';

// Caps applied after decryption, so a small file of dense JSON can't flood
// the device's storage either.
export const MAX_RECORDS = 100_000;

export class InvalidRecord extends Error {
  constructor(field) {
    // The field name only: never the value (SPEC §3).
    super(`Invalid field: ${field}`);
    this.name = 'InvalidRecord';
    this.field = field;
  }
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_LOCAL = /^\d{4}-\d{2}-\d{2}$/;

const fail = (field) => { throw new InvalidRecord(field); };
const codesOf = (options) => options.map((option) => option.code);
const SITE_CODES = Object.keys(DEFAULT_SETTINGS.site_labels);

// Each check returns the value to store or throws.
const exactly = (expected) => (value, field) => (value === expected ? value : fail(field));
const id = (value, field) => (typeof value === 'string' && UUID.test(value) ? value : fail(field));
const iso = (value, field) =>
  (typeof value === 'string' && ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value)) ? value : fail(field));
const oneOf = (codes) => (value, field) => (codes.includes(value) ? value : fail(field));
const nullable = (check) => (value, field) => (value === null ? null : check(value, field));
// Optional text: null or a non-blank string within the form's limit. Never ''.
const text = (max) => (value, field) =>
  (value === null || (typeof value === 'string' && value.trim() !== '' && value.length <= max) ? value : fail(field));
const codeList = (codes) => (value, field) => {
  if (!Array.isArray(value) || value.length > codes.length || new Set(value).size !== value.length) fail(field);
  return value.map((code) => (codes.includes(code) ? code : fail(field)));
};

// Same limits as the form inputs.
const COMMON = {
  id,
  occurred_at: iso,
  created_at: iso,
  updated_at: iso,
  site_code: oneOf(SITE_CODES),
  initials: text(8),
  voided_at: nullable(iso),
  void_reason: text(200),
};

const BATHROOM_FIELDS = {
  ...COMMON,
  schema_version: exactly(bathroom.SCHEMA_VERSION),
  event_code: oneOf(codesOf(bathroom.EVENTS)),
  pain_code: nullable(oneOf(codesOf(bathroom.PAIN))),
  urine_change_code: nullable(oneOf(codesOf(bathroom.URINE_CHANGE))),
  urine_change_details: codeList(codesOf(bathroom.URINE_DETAILS)),
  urine_change_note: text(200),
  bristol_type: nullable(oneOf(codesOf(bathroom.BRISTOL))),
  bm_amount: nullable(oneOf(codesOf(bathroom.BM_AMOUNT))),
  attempt_target: nullable(oneOf(codesOf(bathroom.ATTEMPT_TARGET))),
  bowel_care_status: nullable(oneOf(codesOf(bathroom.BOWEL_CARE_STATUS))),
  concern_codes: codeList(codesOf(bathroom.CONCERNS)),
  notes: text(500),
};

function handoffFields(type) {
  const fields = {
    ...COMMON,
    schema_version: exactly(handoff.SCHEMA_VERSION),
    summary_type: exactly(type),
    date_local: (value, field) => (typeof value === 'string' && DATE_LOCAL.test(value) ? value : fail(field)),
    handoff_note: text(500),
    positive_note: text(500),
  };
  for (const question of handoff.QUESTIONS[type]) {
    if (question.field === 'behaviors') {
      fields.behavior_codes = codeList(codesOf(handoff.BEHAVIORS));
      fields.behavior_state = nullable(oneOf(['some', ...codesOf(handoff.BEHAVIOR_STATES)]));
      fields.behavior_other_note = text(200);
    } else {
      fields[question.field] = oneOf(codesOf(question.options));
    }
  }
  return fields;
}

const HANDOFF_FIELDS = Object.fromEntries(
  handoff.SUMMARY_TYPES.map(({ code }) => [code, handoffFields(code)]));

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function copyFields(raw, fields) {
  if (!isPlainObject(raw)) fail('record');
  const record = {};
  for (const [field, check] of Object.entries(fields)) {
    if (!Object.hasOwn(raw, field)) fail(field);
    record[field] = check(raw[field], field);
  }
  return record;
}

// The stored copy must also obey the form's rules: everything required is
// answered and nothing hidden carries a value.
export function sanitizeBathroomEvent(raw) {
  const record = copyFields(raw, BATHROOM_FIELDS);
  const errors = Object.keys(bathroom.validate(record));
  if (errors.length > 0) fail(errors[0]);
  const normalized = bathroom.normalize(record);
  for (const field of Object.keys(record)) {
    if (JSON.stringify(normalized[field]) !== JSON.stringify(record[field])) fail(field);
  }
  if (record.concern_codes.includes(bathroom.NO_CONCERN) && record.concern_codes.length > 1) fail('concern_codes');
  return record;
}

export function sanitizeHandoff(raw) {
  if (!isPlainObject(raw) || !Object.hasOwn(HANDOFF_FIELDS, raw.summary_type)) fail('summary_type');
  const record = copyFields(raw, HANDOFF_FIELDS[raw.summary_type]);
  const errors = Object.keys(handoff.validate(record));
  if (errors.length > 0) fail(errors[0]);
  if (record.behavior_other_note !== null && !record.behavior_codes.includes('other')) fail('behavior_other_note');
  return record;
}

function sanitizeList(list, sanitize, field) {
  if (!Array.isArray(list) || list.length > MAX_RECORDS) fail(field);
  const records = list.map((record, index) => {
    try {
      return sanitize(record);
    } catch (err) {
      if (err instanceof InvalidRecord) throw new InvalidRecord(`${field} #${index + 1}: ${err.field}`);
      throw err;
    }
  });
  if (new Set(records.map((record) => record.id)).size !== records.length) fail(`${field}.id`);
  return records;
}

// data is a migrated backup payload. Returns a clean copy or throws
// InvalidRecord.
export function sanitizeBackupData(data) {
  if (!isPlainObject(data)) fail('payload');
  if (data.schema_version !== CURRENT_SCHEMA_VERSION) fail('schema_version');
  if (typeof data.dataset_id !== 'string' || !DATASET_ID_PATTERN.test(data.dataset_id)) fail('dataset_id');
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    dataset_id: data.dataset_id,
    bathroom_events: sanitizeList(data.bathroom_events, sanitizeBathroomEvent, 'bathroom_events'),
    handoffs: sanitizeList(data.handoffs, sanitizeHandoff, 'handoffs'),
  };
}
