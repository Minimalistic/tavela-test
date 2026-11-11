// Rules shared by bathroom events and handoffs: which store a record lives in,
// voiding, and the Records filter (docs/SPEC.md §9). Pure functions.
import { localDate, isFutureTime } from './time.js';
import { matchRule } from './matches.js';

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

// The one way back from a void: Undo on the card shown right after it
// (DECISIONS "Void card"). Voiding left everything else alone, so clearing
// the two fields is the entry exactly as it was.
export function unvoidRecord(record) {
  return { ...record, voided_at: null, void_reason: null };
}

export const byOccurredDesc = (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at);

// from/to are 'YYYY-MM-DD' local dates, both inclusive; null means open-ended.
// site and type are codes; null means any. match is a matches.js key: only
// the entries a Reports count counted (a tapped total).
export function filterEntries(records, { from = null, to = null, site = null, type = null, match = null, showVoided = false } = {}) {
  const rule = match === null ? null : matchRule(match);
  // An unknown key must not quietly widen the list to everything.
  if (match !== null && !rule) throw new RangeError('Unknown match');
  return records
    .filter((record) => {
      if (record.voided_at && !showVoided) return false;
      const day = localDate(record.occurred_at);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (site && record.site_code !== site) return false;
      if (type && entryType(record) !== type) return false;
      if (rule && !rule.test(record)) return false;
      return true;
    })
    .sort(byOccurredDesc);
}

// Home's "Last logged" line: the newest check-in still standing, or null. A
// mistyped future time is skipped, as the BM gap does, so it can't pose as
// today's latest and hide the real one.
export function lastLogged(events, now = new Date()) {
  return events
    .filter((record) => !record.voided_at && !isFutureTime(record.occurred_at, now))
    .sort(byOccurredDesc)[0] ?? null;
}

// Home's "Done today" line: today's (device-local) Update of this type that
// hasn't been voided, the newest if there are several, or null.
export function doneToday(handoffs, type, now = new Date()) {
  const today = localDate(now.toISOString());
  return handoffs
    .filter((record) => record.summary_type === type && !record.voided_at && localDate(record.occurred_at) === today)
    .sort(byOccurredDesc)[0] ?? null;
}

// One Update of each kind per date (DECISIONS "One Update a day"): the
// standing Update of the same kind already on this record's (device-local)
// date, or null. Voided ones don't count, and an edit never counts against
// itself. Restored data can hold two on a date; this only guards saving.
export function updateOnDate(handoffs, record) {
  const day = localDate(record.occurred_at);
  return handoffs.find((other) => other.id !== record.id && other.summary_type === record.summary_type
    && !other.voided_at && localDate(other.occurred_at) === day) ?? null;
}

// Records grouped under one heading per local day, keeping the list's order
// (newest first): [{ day: 'YYYY-MM-DD', records }].
export function groupByDay(records) {
  const groups = [];
  for (const record of records) {
    const day = localDate(record.occurred_at);
    if (groups.at(-1)?.day !== day) groups.push({ day, records: [] });
    groups.at(-1).records.push(record);
  }
  return groups;
}

// Records shows about this many entries at a time, in whole days.
export const RECORDS_BATCH = 50;

// Where the next batch of days ends (exclusive), starting at day index
// `start` of groupByDay's list: whole days, at least one, until about `size`
// entries. Records shows days [0, end) and offers "Show earlier" for the rest.
export function batchEnd(groups, start = 0, size = RECORDS_BATCH) {
  let end = start;
  let entries = 0;
  while (end < groups.length && (end === start || entries < size)) {
    entries += groups[end].records.length;
    end += 1;
  }
  return end;
}

// The folded Records filters, said in one line: "Sep 30 – Oct 30 · Day
// program · Morning Update · with voided". Null when nothing is filtered.
export function filterSummary({ from, to, site, type, match = null, showVoided }, { siteLabel, typeLabel, shortDate }) {
  const dates = from && to ? `${shortDate(from)} – ${shortDate(to)}`
    : from ? `From ${shortDate(from)}`
    : to ? `Up to ${shortDate(to)}`
    : null;
  const parts = [dates, site ? siteLabel(site) : null, type ? typeLabel(type) : null,
    match ? matchRule(match)?.label : null, showVoided ? 'with voided' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
