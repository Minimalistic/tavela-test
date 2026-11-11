// Schema migrations (docs/SPEC.md §15.3). Restoring a backup and upgrading the
// data on this device run the same chain, in order, from the data's version to
// the current one. Migrations are never deleted.
import { BackupError } from './backup.js';

export const CURRENT_SCHEMA_VERSION = 2;

// The version stamped on each entry and Update: the dataset version at which
// their shape last changed. Version 2 added notes (annotations) beside them
// and left them as they were, so they still say 1 and no migration rewrites
// them.
export const RECORD_SCHEMA_VERSION = 1;

// MIGRATIONS[n] turns version-n data into version n+1. Data is
// { schema_version, dataset_id, bathroom_events, handoffs, annotations }
// (annotations from version 2). A migration can meet a hostile backup, so it
// must not trust the shape it's given: it copies the keys it knows and
// record-schema.js validates whatever it returns.
const MIGRATIONS = {
  // 1 → 2: notes pinned to dates (SPEC §11). Entries and Updates pass through
  // untouched; version-1 data has no notes, whatever the file claims.
  1: (data) => ({
    dataset_id: data.dataset_id,
    bathroom_events: data.bathroom_events,
    handoffs: data.handoffs,
    annotations: [],
  }),
};

export function migrate(data, migrations = MIGRATIONS, current = CURRENT_SCHEMA_VERSION) {
  let version = data.schema_version;
  if (version > current) throw new BackupError('newer');
  let result = data;
  while (version < current) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema version ${version}`);
    result = { ...step(result), schema_version: version + 1 };
    version += 1;
  }
  return result;
}

// Brings this device's stored data up to the current version, through the same
// chain a restore uses. A failure leaves the data as it was (one transaction).
export async function migrateLocalData(store, migrations = MIGRATIONS, current = CURRENT_SCHEMA_VERSION) {
  const recorded = await store.getMeta('schema_version');
  // Data saved before versions were recorded is version 1.
  const stored = recorded ?? 1;
  if (stored > current) throw new BackupError('newer');
  if (stored === current) {
    if (recorded === null) await store.setMeta('schema_version', current);
    return;
  }
  const data = migrate({
    schema_version: stored,
    dataset_id: await store.getMeta('dataset_id'),
    bathroom_events: await store.getAll('bathroom_events'),
    handoffs: await store.getAll('handoffs'),
    // Version 1 had no notes; from 2 on they are part of the data.
    ...(stored >= 2 ? { annotations: await store.getAll('annotations') } : {}),
  }, migrations, current);
  await store.writeAll({
    replace: true,
    bathroom_events: data.bathroom_events,
    handoffs: data.handoffs,
    // No fallback: a migration that loses the notes is refused by writeAll,
    // not written as "no notes".
    annotations: data.annotations,
    meta: { schema_version: current },
  });
}
