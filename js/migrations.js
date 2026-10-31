// Schema migrations (docs/SPEC.md §15.3). Restoring a backup and upgrading the
// data on this device run the same chain, in order, from the data's version to
// the current one. Migrations are never deleted.
import { BackupError } from './backup.js';

export const CURRENT_SCHEMA_VERSION = 1;

// MIGRATIONS[n] turns version-n data into version n+1. Data is
// { schema_version, dataset_id, bathroom_events, handoffs }. A migration can
// meet a hostile backup, so it must not trust the shape it's given;
// record-schema.js validates whatever it returns.
const MIGRATIONS = {};

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

// Brings this device's stored data up to the current version. Version 1 needs
// no change beyond recording the version. A failure leaves the data as it was
// (one transaction).
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
  }, migrations, current);
  await store.writeAll({
    replace: true,
    bathroom_events: data.bathroom_events,
    handoffs: data.handoffs,
    meta: { schema_version: current },
  });
}
