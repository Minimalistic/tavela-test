// Demo mode (docs/SPEC.md §16): generated fictional data in its own IndexedDB
// database. The real database is touched only to read and write one flag in
// meta, so a reload stays in demo mode. Backups read records and dataset_id
// only, so the flag never leaves the device.
import { generateDemoData, DEMO_SEED } from './demo-data.js';
import { toOffsetIso } from './time.js';

export const DEMO_DB = 'tendwell-demo';
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
    meta: { demo_days: days, demo_created_at: toOffsetIso(now) },
  });
  await realStore.setMeta(DEMO_FLAG, true);
  return data.bathroom_events.length + data.handoffs.length;
}

// Clears the flag before dropping the demo database: if the drop fails, the
// app is still back on real data, and the next demo replaces the leftovers.
export async function leaveDemo({ realStore, dropDemo }) {
  await realStore.setMeta(DEMO_FLAG, false);
  await dropDemo();
}
