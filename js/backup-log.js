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

export const BACKUP_REMINDER_DAYS = 7; // SPEC §21 default; settings take it over at first-run setup.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Whole device-local calendar days from one instant's date to another's.
function calendarDaysBetween(from, to) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / MS_PER_DAY);
}

// SPEC §6: a non-blocking reminder when a backup is overdue. Only a confirmed
// backup counts (last_backup_at). A time that can't be read, or one in the
// future, counts as due: an unknown backup is not a fresh one.
// Returns { due: false } or { due: true, never: boolean, daysAgo: number|null }.
export function backupDue({ lastBackupAt, entryCount, now = new Date(), days = BACKUP_REMINDER_DAYS }) {
  if (!(entryCount > 0)) return { due: false };
  if (!lastBackupAt) return { due: true, never: true, daysAgo: null };
  const last = new Date(lastBackupAt);
  if (Number.isNaN(last.getTime()) || last > now) return { due: true, never: false, daysAgo: null };
  const daysAgo = calendarDaysBetween(last, now);
  return daysAgo >= days ? { due: true, never: false, daysAgo } : { due: false };
}

export function backupReminderText({ never, daysAgo }) {
  if (never) return 'No backup yet. Entries live only on this device.';
  if (daysAgo === null) return 'The last backup time can\'t be read. Back up to be safe.';
  return `Last backup ${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago.`;
}
