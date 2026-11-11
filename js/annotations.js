// Notes pinned to a date or a date range (docs/SPEC.md §11, "annotations"):
// a reviewer's "Started new medication", shown on the timeline and in a list.
// Pure functions: no DOM, no storage. A note is not an observation, so it has
// no void; it can be edited (updated_at) or removed outright.
//
// { id, text, date_from, date_to, initials, created_at, updated_at }
// date_from and date_to are local calendar days ('YYYY-MM-DD'); date_to is
// null for a note on one day.

export const ANNOTATION_TEXT_LIMIT = 200;
export const ANNOTATION_INITIALS_LIMIT = 8;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real calendar day, not just the right shape ('2026-02-30' is refused).
export function isDay(value) {
  const m = typeof value === 'string' ? DAY.exec(value) : null;
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
}

function blankToNull(text) {
  const trimmed = (text ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

// A blank note for the form. Only the first day is given (the day picked on
// the timeline, shown and changeable); the text and initials start empty.
export function newAnnotationDraft({ id, dateFrom = null }) {
  return { id, text: '', date_from: dateFrom, date_to: null, initials: null, created_at: null, updated_at: null };
}

// { field: message } for everything that stops a save; empty when it's fine.
export function validate(annotation) {
  const errors = {};
  const text = typeof annotation.text === 'string' ? annotation.text.trim() : '';
  if (text === '') errors.text = 'Write the note.';
  else if (text.length > ANNOTATION_TEXT_LIMIT) errors.text = `Keep the note to ${ANNOTATION_TEXT_LIMIT} characters.`;
  if (!isDay(annotation.date_from)) errors.date_from = 'Choose the day.';
  if (annotation.date_to !== null && annotation.date_to !== '') {
    if (!isDay(annotation.date_to)) errors.date_to = 'Choose the last day, or leave it empty.';
    else if (isDay(annotation.date_from) && annotation.date_to < annotation.date_from) errors.date_to = 'The last day is before the first.';
  }
  const initials = annotation.initials;
  if (initials !== null && (typeof initials !== 'string' || initials.trim().length > ANNOTATION_INITIALS_LIMIT)) {
    errors.initials = `Keep initials to ${ANNOTATION_INITIALS_LIMIT} characters.`;
  }
  return errors;
}

// The stored note. A range that ends on its first day is one day; blank
// initials are null, never ''. created_at is kept across edits.
export function toAnnotation(draft, nowIso) {
  const to = draft.date_to === '' || draft.date_to === draft.date_from ? null : draft.date_to;
  return {
    id: draft.id,
    text: draft.text.trim(),
    date_from: draft.date_from,
    date_to: to,
    initials: blankToNull(draft.initials),
    created_at: draft.created_at ?? nowIso,
    updated_at: nowIso,
  };
}

export const lastDay = (annotation) => annotation.date_to ?? annotation.date_from;

// Whether a note touches a day, or any day of a window (both ends included).
export const touchesDay = (annotation, day) => annotation.date_from <= day && day <= lastDay(annotation);
export const touchesWindow = (annotation, from, to) => annotation.date_from <= to && from <= lastDay(annotation);

// Newest date first; notes starting the same day, most recently written first.
export function sortAnnotations(annotations) {
  return [...annotations].sort((a, b) =>
    b.date_from.localeCompare(a.date_from) || Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
}

export function annotationsInWindow(annotations, from, to) {
  return sortAnnotations(annotations.filter((annotation) => touchesWindow(annotation, from, to)));
}

export function annotationsOnDay(annotations, day) {
  return sortAnnotations(annotations.filter((annotation) => touchesDay(annotation, day)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayParts = (day) => day.split('-').map(Number);

// "Oct 27, 2026", "Nov 2 – Nov 5, 2026", "Dec 30, 2026 – Jan 2, 2027". The
// year is always said: a note outlives the window it's read in.
export function annotationDates(annotation) {
  const [y1, m1, d1] = dayParts(annotation.date_from);
  if (annotation.date_to === null) return `${MONTHS[m1 - 1]} ${d1}, ${y1}`;
  const [y2, m2, d2] = dayParts(annotation.date_to);
  return `${MONTHS[m1 - 1]} ${d1}${y1 === y2 ? '' : `, ${y1}`} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
}

// A note as one spoken line for the picked day: a range says its dates, since
// the day alone doesn't show how far the note reaches.
export function annotationLine(annotation) {
  const end = /[.!?]$/.test(annotation.text) ? '' : '.';
  return annotation.date_to === null
    ? `Note: ${annotation.text}${end}`
    : `Note, ${annotationDates(annotation)}: ${annotation.text}${end}`;
}

// Where each note sits on a timeline of `days` (consecutive calendar days,
// oldest first): the first and last day it covers there, by position. A note
// that starts before or ends after the timeline is cut at the edge and says
// so (openStart, openEnd), so its bracket can be drawn open on that side.
export function annotationMarks(annotations, days) {
  const first = days[0];
  const last = days[days.length - 1];
  return annotationsInWindow(annotations, first, last).map((annotation) => {
    const end = lastDay(annotation);
    const openStart = annotation.date_from < first;
    const openEnd = end > last;
    return {
      id: annotation.id,
      range: annotation.date_to !== null,
      from: openStart ? 0 : days.indexOf(annotation.date_from),
      to: openEnd ? days.length - 1 : days.indexOf(end),
      openStart,
      openEnd,
    };
  });
}
