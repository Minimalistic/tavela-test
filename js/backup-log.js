// Backup history (Jason, 10-20): one line per backup someone confirmed was
// saved off this device. Kept in meta on this device only; it is not part of
// the backup file, so the v1 format stays as it is.

export const BACKUP_LOG_LIMIT = 500;

// entry: { at, filename, entries }. Newest first; the oldest drop off past
// the limit.
export function withBackupEntry(log, entry) {
  return [entry, ...(Array.isArray(log) ? log : [])].slice(0, BACKUP_LOG_LIMIT);
}

// The time and the log line are written in one transaction, so "Last backup"
// and the history never disagree.
export async function recordBackupSaved(store, entry) {
  const log = withBackupEntry(await store.getMeta('backup_log'), entry);
  await store.writeAll({
    replace: false, bathroom_events: [], handoffs: [], meta: { last_backup_at: entry.at, backup_log: log },
  });
  return log;
}
