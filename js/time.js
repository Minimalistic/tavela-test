// One local timezone and one date/time format everywhere (SPEC §19).

const pad = (n) => String(n).padStart(2, '0');

// "2026-10-20T18:05:00-05:00": local wall time plus the offset in effect then.
export function toOffsetIso(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Whole minutes only: seconds are dropped so the saved time matches what the
// datetime input shows.
export function minutesAgo(minutes, now = new Date()) {
  const when = new Date(now.getTime() - minutes * 60 * 1000);
  when.setSeconds(0, 0);
  return when;
}

// "2026-10-20": the device-local calendar date of an instant.
export function localDate(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isFutureTime(occurredAt, now = new Date()) {
  const graceMs = 2 * 60 * 1000;
  return Date.parse(occurredAt) > now.getTime() + graceMs;
}

// Value for <input type="datetime-local">.
export function toInputValue(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The input gives local wall time with no zone; new Date() reads it as local.
export function fromInputValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : toOffsetIso(date);
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(iso) {
  const date = new Date(iso);
  const day = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return `${day} · ${formatTime(iso)}`;
}

// "just now", "12 min ago", "3 hr ago", "2 days ago". Null for a time still
// ahead (a future time can be saved, with a warning).
export function timeAgo(iso, now = new Date()) {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60000);
  if (minutes < 0) return null;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
