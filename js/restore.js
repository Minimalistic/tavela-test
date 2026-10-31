// Restore and verify (docs/SPEC.md §13.3, §13.4). openBackup turns an
// untrusted file into clean records; planRestore works out what a restore
// would do (the dry-run preview); applyRestore writes it in one transaction.
import { BackupError, readEnvelope, decryptPayload, encryptBackup, backupFilename } from './backup.js';
import { toOffsetIso } from './time.js';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrations.js';
import { sanitizeBackupData, InvalidRecord } from './record-schema.js';

export const NOT_RESTORED = 'Not restored. Nothing on this device was changed. Try again.';
export const CHANGED_SINCE_PREVIEW = 'Not restored: entries on this device changed since the preview. Nothing was changed. Open the backup again to see a new preview.';

// Verify Backup and Restore both use this, so a file that verifies is one
// that restores.
export async function openBackup(text, passphrase) {
  const header = readEnvelope(text);
  // Before the slow key derivation: no point asking for work we'll refuse.
  if (header.schema_version > CURRENT_SCHEMA_VERSION) throw new BackupError('newer');
  const payload = await decryptPayload(header, passphrase);
  let data;
  try {
    if (typeof payload !== 'object' || payload === null || payload.schema_version !== header.schema_version) {
      throw new BackupError('damaged');
    }
    data = sanitizeBackupData(migrate(payload));
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('invalid', err instanceof InvalidRecord ? err.field : err?.name);
  }
  if (data.dataset_id !== header.dataset_id
    || data.bathroom_events.length !== header.record_counts.bathroom_events
    || data.handoffs.length !== header.record_counts.handoffs) {
    throw new BackupError('damaged');
  }
  return { header, data };
}

export async function readLocal(store) {
  return {
    datasetId: await store.getMeta('dataset_id'),
    bathroom_events: await store.getAll('bathroom_events'),
    handoffs: await store.getAll('handoffs'),
  };
}

// Encrypts everything on this device, voided entries included, then opens the
// result the way a restore would. A backup that can't be restored is caught
// here, not on the day it's needed.
export async function createBackup(store, passphrase, now = new Date()) {
  const local = await readLocal(store);
  const text = await encryptBackup({
    data: {
      schema_version: CURRENT_SCHEMA_VERSION,
      dataset_id: local.datasetId,
      bathroom_events: local.bathroom_events,
      handoffs: local.handoffs,
    },
    passphrase,
    createdAt: toOffsetIso(now),
  });
  await openBackup(text, passphrase);
  return {
    text,
    filename: backupFilename(local.datasetId, now),
    entries: local.bathroom_events.length + local.handoffs.length,
  };
}

// When a record last changed: an edit or a void, whichever is later.
const lastChange = (record) => Math.max(
  Date.parse(record.updated_at), record.voided_at ? Date.parse(record.voided_at) : -Infinity);

function sameRecord(a, b) {
  const fields = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...fields].every((field) => JSON.stringify(a[field]) === JSON.stringify(b[field]));
}

// A merge never un-voids: if either copy is voided, the result is too.
function keepVoid(winner, other) {
  if (winner.voided_at || !other.voided_at) return winner;
  return { ...winner, voided_at: other.voided_at, void_reason: other.void_reason };
}

function mergeStore(localRecords, incomingRecords, counts, conflicts) {
  const local = new Map(localRecords.map((record) => [record.id, record]));
  const writes = [];
  for (const incoming of incomingRecords) {
    const current = local.get(incoming.id);
    if (!current) {
      counts.new += 1;
      writes.push(incoming);
    } else if (sameRecord(current, incoming)) {
      counts.duplicate += 1;
    } else if (lastChange(incoming) > lastChange(current)) {
      counts.updated += 1;
      writes.push(keepVoid(incoming, current));
    } else {
      counts.conflicting += 1;
      const kept = keepVoid(current, incoming);
      conflicts.push(kept);
      if (kept !== current) writes.push(kept);
    }
  }
  return writes;
}

// local: { datasetId, bathroom_events, handoffs } from this device.
// mode is 'replace' (this device has no entries), 'merge' (same tracker), or
// 'mismatch' (a different tracker: merging is blocked, replace only).
export function planRestore(local, data) {
  const incomingTotal = data.bathroom_events.length + data.handoffs.length;
  const localTotal = local.bathroom_events.length + local.handoffs.length;
  const counts = { new: 0, duplicate: 0, updated: 0, conflicting: 0 };
  const base = { datasetId: data.dataset_id, localTotal, incomingTotal, data };
  if (localTotal === 0) {
    return { ...base, mode: 'replace', counts: { ...counts, new: incomingTotal }, conflicts: [], writes: null };
  }
  if (local.datasetId !== data.dataset_id) {
    return { ...base, mode: 'mismatch', counts, conflicts: [], writes: null };
  }
  const conflicts = [];
  const writes = {
    bathroom_events: mergeStore(local.bathroom_events, data.bathroom_events, counts, conflicts),
    handoffs: mergeStore(local.handoffs, data.handoffs, counts, conflicts),
  };
  return { ...base, mode: 'merge', counts, conflicts, writes };
}

// how is 'merge' or 'replace'. Replacing another tracker's data needs its
// Dataset ID typed back (confirmation). Checked here, not just in the view.
export async function applyRestore(store, plan, { how, confirmation = '' }) {
  if (how !== 'merge' && how !== 'replace') throw new Error('Restore must be merge or replace');
  if (how === 'merge' && plan.mode !== 'merge') throw new Error('Merge is only allowed for the same tracker');
  if (how === 'replace' && plan.mode === 'merge') throw new Error('Replace is not offered for the same tracker');
  if (plan.mode === 'mismatch' && confirmation.trim().toUpperCase() !== plan.datasetId) {
    throw new Error('Dataset ID confirmation does not match');
  }
  // Never act on a stale preview: if this device's entries changed since it was
  // shown (another window), stop and ask for a fresh one.
  const fresh = planRestore(await readLocal(store), plan.data);
  if (fresh.mode !== plan.mode || fresh.localTotal !== plan.localTotal
    || JSON.stringify(fresh.counts) !== JSON.stringify(plan.counts)
    || JSON.stringify(fresh.writes) !== JSON.stringify(plan.writes)) {
    return { ok: false, message: CHANGED_SINCE_PREVIEW };
  }
  const write = how === 'merge'
    ? { replace: false, ...plan.writes, meta: {} }
    : {
      replace: true,
      bathroom_events: plan.data.bathroom_events,
      handoffs: plan.data.handoffs,
      meta: { dataset_id: plan.data.dataset_id, schema_version: plan.data.schema_version },
    };
  try {
    await store.writeAll(write);
    return { ok: true };
  } catch (err) {
    // Error name only: record contents never go to the console (SPEC §3).
    console.error('Tavela: restore write failed:', err?.name ?? 'unknown error');
    return { ok: false, message: NOT_RESTORED };
  }
}
