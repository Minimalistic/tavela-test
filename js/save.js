import * as bathroom from './bathroom.js';
import * as handoff from './handoff.js';
import { storeFor, voidRecord, updateOnDate } from './entries.js';
import { toOffsetIso, formatDay } from './time.js';
import { CONNECTION_LOST } from './db.js';

export const NOT_SAVED = 'Not saved. Your entry is still here. Try Save again.';
export const NOT_VOIDED = 'Not saved. The entry was not voided. Try again.';
// The store already reopened once and failed again, so Save won't work until
// the app restarts. Closing loses the form, hence "note it down".
export const STORAGE_LOST = 'Not saved. Tavela lost its connection to storage on this device. ' +
  'Your entry is still here: note it down, then close Tavela fully and open it again.';

function failed(storeName, err, failMessage) {
  // Error name only: record contents never go to the console (SPEC §3).
  console.error(`Tavela: ${storeName} write failed:`, err?.name ?? 'unknown error');
  return { ok: false, message: CONNECTION_LOST.has(err?.name) ? STORAGE_LOST : failMessage };
}

// "Saved" only after the store confirms a durable write (SPEC §2.4). Drafts and
// records are never mutated, so a failure leaves the form, and the stored
// record, exactly as they were. Writing by record id makes a repeated tap
// (or an edit) overwrite, never duplicate.
async function write(store, record, failMessage) {
  try {
    await store.put(storeFor(record), record);
    return { ok: true, record };
  } catch (err) {
    return failed(storeFor(record), err, failMessage);
  }
}

export const alreadyLogged = (record) => {
  const { label } = handoff.SUMMARY_TYPES.find((type) => type.code === record.summary_type);
  return `There's already a ${label} for ${formatDay(record.occurred_at)}.`;
};

export async function saveBathroomEvent(store, draft, now = new Date()) {
  const errors = bathroom.validate(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return write(store, bathroom.toRecord(draft, toOffsetIso(now)), NOT_SAVED);
}

// A second Update of the same kind on one date is refused, writing nothing;
// `taken` is the one already there, so the form can offer to open it. Read
// and write aren't one transaction: one device, one person typing.
export async function saveHandoff(store, draft, now = new Date()) {
  const errors = handoff.validate(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const record = handoff.toRecord(draft, toOffsetIso(now));
  let taken;
  try {
    taken = updateOnDate(await store.getAll('handoffs'), record);
  } catch (err) {
    return failed('handoffs', err, NOT_SAVED);
  }
  if (taken) return { ok: false, taken, message: alreadyLogged(taken) };
  return write(store, record, NOT_SAVED);
}

export function saveVoid(store, record, reason, now = new Date()) {
  return write(store, voidRecord(record, reason, toOffsetIso(now)), NOT_VOIDED);
}
