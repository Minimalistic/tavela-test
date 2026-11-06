// An unsaved Check-In or Update kept on the device, so it survives the app
// being closed behind the caregiver's back (ACCEPTANCE "Unsaved entry
// survives the app closing"). One at a time, in the open store's meta. It
// is never in a backup or CSV: those read only the record stores. Pure.
import { SUMMARY_TYPES } from './handoff.js';
import { sanitizeBathroomDraft, sanitizeHandoffDraft, InvalidRecord } from './record-schema.js';
import { formatTime, formatDay, isSameLocalDay } from './time.js';

export const DRAFT_KEY = 'unsaved_draft';
const KINDS = new Set(['bathroom', 'handoff']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const isIso = (value) => typeof value === 'string' && ISO.test(value) && !Number.isNaN(Date.parse(value));

// What gets stored. baseUpdatedAt is the saved entry's updated_at when an
// edit began; resuming checks it still matches.
export function makeDraft({ kind, editing, baseUpdatedAt = null, startedAt, data }) {
  return {
    kind,
    editing: Boolean(editing),
    base_updated_at: editing ? baseUpdatedAt : null,
    started_at: startedAt,
    data: structuredClone(data),
  };
}

// A stored draft is read like a restored file: checked, and copied field by
// field. Null when there's none; { ok: false } when it can't be reopened
// (an older version's, or damaged).
export function readDraft(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidRecord('draft');
    if (!KINDS.has(raw.kind)) throw new InvalidRecord('kind');
    if (typeof raw.editing !== 'boolean') throw new InvalidRecord('editing');
    if (!isIso(raw.started_at)) throw new InvalidRecord('started_at');
    if (raw.editing ? !isIso(raw.base_updated_at) : raw.base_updated_at !== null) throw new InvalidRecord('base_updated_at');
    const data = raw.kind === 'bathroom' ? sanitizeBathroomDraft(raw.data) : sanitizeHandoffDraft(raw.data);
    return {
      ok: true,
      draft: { kind: raw.kind, editing: raw.editing, base_updated_at: raw.base_updated_at, started_at: raw.started_at, data },
    };
  } catch (err) {
    if (err instanceof InvalidRecord) return { ok: false, field: err.field };
    throw err;
  }
}

// Which store and screen the draft belongs to.
export const storeFor = (draft) => (draft.kind === 'bathroom' ? 'bathroom_events' : 'handoffs');
export const viewFor = (draft) => (draft.kind === 'bathroom' ? 'checkin' : 'handoff');

export function formName(draft) {
  if (draft.kind === 'bathroom') return 'Check-In';
  return SUMMARY_TYPES.find((type) => type.code === draft.data.summary_type)?.label ?? 'Update';
}

// "8:26 PM" today, "yesterday, 8:26 PM", then "Mon, Nov 2, 8:26 PM".
export function whenStarted(iso, now = new Date()) {
  const date = new Date(iso);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameLocalDay(date, now)) return formatTime(iso);
  if (isSameLocalDay(date, yesterday)) return `yesterday, ${formatTime(iso)}`;
  return `${formatDay(iso)}, ${formatTime(iso)}`;
}

// Home's card: the kind of form and when, never what was answered (Home is
// a shared screen). Older than today asks for a look before saving.
export function draftCard(draft, now = new Date()) {
  const name = formName(draft);
  const article = /^[AEIOU]/.test(name) ? 'an' : 'a';
  const title = draft.editing
    ? `Unsaved changes to ${article} ${name}, from ${whenStarted(draft.started_at, now)}`
    : `Unsaved ${name} from ${whenStarted(draft.started_at, now)}`;
  const stale = !isSameLocalDay(new Date(draft.started_at), now);
  return { title, note: stale ? 'Check it before saving.' : null };
}

// Whether two entries hold the same answers, whatever order their fields are
// in: a draft comes back from storage in the schema's field order, not the
// order the saved entry was written in.
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// An edit only resumes onto the entry as it was when the edit began.
export function editStillApplies(draft, record) {
  return Boolean(record)
    && record.id === draft.data.id
    && record.updated_at === draft.base_updated_at
    && record.voided_at === null;
}

// Why a draft can't be resumed, or null. saved is the stored entry with the
// draft's id, if any. A new entry whose id is already saved was saved before
// the draft could be removed (the app closed in between): resuming it would
// overwrite that entry and any edit since.
export function resumeProblem(draft, saved) {
  if (draft.editing) return editStillApplies(draft, saved) ? null : EDIT_CHANGED;
  return saved ? ALREADY_SAVED : null;
}

export const ALREADY_SAVED = 'This entry was already saved, so the unsaved copy was removed.';
export const DRAFT_UNREADABLE = 'An unsaved entry was found but couldn’t be reopened, so it was removed.';
export const EDIT_CHANGED = 'This entry was changed since, so these unsaved edits can’t be applied. They were removed.';
