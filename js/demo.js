// Demo mode (docs/SPEC.md §16): generated fictional data in its own IndexedDB
// database. The real database is touched only to read and write one flag in
// meta, so a reload stays in demo mode. Backups read records and dataset_id
// only, so the flag never leaves the device.
import { generateDemoData, DEMO_SEED, DEMO_DAYS } from './demo-data.js';
import { toOffsetIso } from './time.js';
import { CURRENT_SCHEMA_VERSION } from './migrations.js';

export const DEMO_DB = 'handstead-demo';
export const DEMO_FLAG = 'demo_active';

export async function isDemoActive(realStore) {
  return (await realStore.getMeta(DEMO_FLAG)) === true;
}

// Fills the demo database first and sets the flag last, so a failure partway
// leaves the app in real mode with nothing changed there.
export async function startDemo({ realStore, demoStore, days, now = new Date(), seed = DEMO_SEED }) {
  const data = generateDemoData({ days, seed, now });
  await demoStore.writeAll({
    replace: true,
    bathroom_events: data.bathroom_events,
    handoffs: data.handoffs,
    annotations: data.annotations,
    meta: { demo_days: days, demo_created_at: toOffsetIso(now), schema_version: CURRENT_SCHEMA_VERSION },
  });
  await realStore.setMeta(DEMO_FLAG, true);
  return data.bathroom_events.length + data.handoffs.length;
}

// The dev-host "Clear all data" while in demo mode: empties the demo database
// but keeps it marked as this version's, so the next launch finds it current
// and leaves it empty.
export async function clearDemo(demoStore) {
  const days = await demoStore.getMeta('demo_days');
  await demoStore.clearAll();
  await demoStore.writeAll({
    replace: false, bathroom_events: [], handoffs: [], annotations: [],
    meta: { demo_days: days, schema_version: CURRENT_SCHEMA_VERSION },
  });
}

// The demo database is never migrated (DECISIONS "Schema bumps and the demo
// database"). One made by an older version, or one that never recorded its
// version, is made again for the same number of days, so demo mode never
// shows old-shape data. Anything added while in demo mode goes with it.
export async function refreshStaleDemo({ realStore, demoStore, now = new Date() }) {
  if ((await demoStore.getMeta('schema_version')) === CURRENT_SCHEMA_VERSION) return false;
  const days = await demoStore.getMeta('demo_days');
  await startDemo({ realStore, demoStore, days: DEMO_DAYS.includes(days) ? days : DEMO_DAYS[0], now });
  return true;
}

// Clears the flag before dropping the demo database: if the drop fails, the
// app is still back on real data, and the next demo replaces the leftovers.
export async function leaveDemo({ realStore, dropDemo }) {
  await realStore.setMeta(DEMO_FLAG, false);
  await dropDemo();
}
