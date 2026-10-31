// Rules shared by bathroom events and handoffs: which store a record lives in,
// voiding, and the Records filter (docs/SPEC.md §9). Pure functions.
import { localDate } from './time.js';

export const ENTRY_TYPES = [
  { code: 'bathroom', label: 'Bathroom Check-In' },
  { code: 'home_am', label: 'Morning Update' },
  { code: 'day_pm', label: 'Afternoon Update' },
];

export function entryType(record) {
  return record.summary_type ?? 'bathroom';
}

export function storeFor(record) {
  return record.summary_type ? 'handoffs' : 'bathroom_events';
}

// Voiding marks the record and changes nothing else: it stays in backups and
// under "Show voided", and counts skip it.
export function voidRecord(record, reason, nowIso) {
  const trimmed = (reason ?? '').trim();
  return { ...record, voided_at: nowIso, void_reason: trimmed === '' ? null : trimmed };
}

export const byOccurredDesc = (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at);

// from/to are 'YYYY-MM-DD' local dates, both inclusive; null means open-ended.
// site and type are codes; null means any.
export function filterEntries(records, { from = null, to = null, site = null, type = null, showVoided = false } = {}) {
  return records
    .filter((record) => {
      if (record.voided_at && !showVoided) return false;
      const day = localDate(record.occurred_at);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (site && record.site_code !== site) return false;
      if (type && entryType(record) !== type) return false;
      return true;
    })
    .sort(byOccurredDesc);
}

// Home's "Last logged" line: the newest check-in still standing, or null.
export function lastLogged(events) {
  return events.filter((record) => !record.voided_at).sort(byOccurredDesc)[0] ?? null;
}

// Home's "Done today" line: today's (device-local) Update of this type that
// hasn't been voided, the newest if there are several, or null.
export function doneToday(handoffs, type, now = new Date()) {
  const today = localDate(now.toISOString());
  return handoffs
    .filter((record) => record.summary_type === type && !record.voided_at && localDate(record.occurred_at) === today)
    .sort(byOccurredDesc)[0] ?? null;
}
