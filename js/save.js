import * as bathroom from './bathroom.js';
import * as handoff from './handoff.js';
import { storeFor, voidRecord } from './entries.js';
import { toOffsetIso } from './time.js';

export const NOT_SAVED = 'Not saved. Your entry is still here. Try Save again.';
export const NOT_VOIDED = 'Not saved. The entry was not voided. Try again.';

// "Saved" only after the store confirms a durable write (SPEC §2.4). Drafts and
// records are never mutated, so a failure leaves the form, and the stored
// record, exactly as they were. Writing by record id makes a repeated tap
// (or an edit) overwrite, never duplicate.
async function write(store, record, failMessage) {
  try {
    await store.put(storeFor(record), record);
    return { ok: true, record };
  } catch (err) {
    // Error name only: record contents never go to the console (SPEC §3).
    console.error(`Tavela: ${storeFor(record)} write failed:`, err?.name ?? 'unknown error');
    return { ok: false, message: failMessage };
  }
}

export async function saveBathroomEvent(store, draft, now = new Date()) {
  const errors = bathroom.validate(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return write(store, bathroom.toRecord(draft, toOffsetIso(now)), NOT_SAVED);
}

export async function saveHandoff(store, draft, now = new Date()) {
  const errors = handoff.validate(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return write(store, handoff.toRecord(draft, toOffsetIso(now)), NOT_SAVED);
}

export function saveVoid(store, record, reason, now = new Date()) {
  return write(store, voidRecord(record, reason, toOffsetIso(now)), NOT_VOIDED);
}
