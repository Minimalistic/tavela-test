// Export history (SPEC §12): one line per export someone saved or shared.
// Kept in meta on this device only, like the backup history; never part of a
// backup file.

export const EXPORT_LOG_LIMIT = 500;

// entry: { at, kind: 'csv', from, to, site, entries, voided }. Newest first.
export function withExportEntry(log, entry) {
  return [entry, ...(Array.isArray(log) ? log : [])].slice(0, EXPORT_LOG_LIMIT);
}

// "Last exported through": the latest end date any export covered, or null.
// An entry whose date can't be read is skipped, never trusted.
export function lastExportedThrough(log) {
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  let latest = null;
  for (const entry of Array.isArray(log) ? log : []) {
    if (typeof entry?.to === 'string' && DAY.test(entry.to) && (latest === null || entry.to > latest)) latest = entry.to;
  }
  return latest;
}

export async function recordExport(store, entry) {
  const log = withExportEntry(await store.getMeta('export_log'), entry);
  await store.setMeta('export_log', log);
  return log;
}
