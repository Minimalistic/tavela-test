import { h, svgTree } from '../dom.js';
import { plural } from '../words.js';
import { timelineRows } from '../charts.js';
import { rowDrawing, dayCenter, dayAt, shortDate } from '../chart-draw.js';
import { dayDetail, dayFacts, NONE } from '../day-detail.js';
import { localDate } from '../time.js';
import { annotationMarks, annotationsOnDay, annotationLine, annotationDates } from '../annotations.js';
import { createDayTab } from './day-tab.js';

// "When": one timeline, a thin row per series on one date axis, drawn at the
// screen's own width so it never scrolls sideways. Each row's name and total
// sit above its line. Today is picked on arrival; a tap anywhere picks a day,
// and the drag tab under the axis moves along it. For screen readers and
// keyboards the rows are one slider over the days (arrow keys, Home, End),
// whose value text is the day in words; the drawings are aria-hidden.
// The words a linked number adds for screen readers; the chevron is for eyes.
export const seeThem = (count) => h('span', { class: 'visually-hidden' }, count === 1 ? ', see it' : ', see them');
export const chevron = () => h('span', { class: 'chev', 'aria-hidden': 'true' }, '›');

// openMatch(match, id): a row total that counts entries opens them in
// Records. The slider's children are read as one control, so those totals
// are buttons in a layer laid over the rows, not inside them.
// The timeline's width on paper, in CSS pixels; print CSS matches it. Fits
// Letter and A4 at the browser's default margins.
export const PRINT_WIDTH = 640;

// notes: the notes pinned to dates (annotations) that touch the window. Each
// marks a "Notes" lane above the rows, a diamond for a day or a bracket for a
// range, with a dashed line down through every row. Shape and the lane's
// label carry it, never colour; the words are in the picked day and the list.
// Marks are placed in percentages, so they hold on any width and on paper.
function notesLane(notes, days) {
  const n = days.length;
  const lane = h('div', { class: 'tl-notes', 'aria-hidden': 'true' }, h('span', { class: 'tl-notes-label' }, 'Notes'));
  const lines = [];
  const place = (element, x, w = null) => {
    element.style.setProperty('--x', `${x}%`);
    if (w !== null) element.style.setProperty('--w', `${w}%`);
    return element;
  };
  for (const mark of annotationMarks(notes, days)) {
    const left = (mark.from / n) * 100;
    const width = ((mark.to - mark.from + 1) / n) * 100;
    if (mark.range) {
      const open = `${mark.openStart ? ' open-start' : ''}${mark.openEnd ? ' open-end' : ''}`;
      lane.append(place(h('i', { class: `tl-note-range${open}` }), left, width));
      lines.push(place(h('i', { class: `tl-note-span${open}`, 'aria-hidden': 'true' }), left, width));
    } else {
      lane.append(place(h('i', { class: 'tl-note-day' }), left + width / 2));
      lines.push(place(h('i', { class: 'tl-note-line', 'aria-hidden': 'true' }), left + width / 2));
    }
  }
  return lines.length ? { lane, lines } : { lane: null, lines: [] };
}

export function timelineCard(counts, openDay, openMatch, { notes = [], startDay = null } = {}) {
  const { days } = counts.window;
  const n = days.length;
  const marks = notesLane(notes, days);
  const rows = timelineRows(counts);
  const moreLabel = `+ ${plural(rows.filter((row) => row.more).length, 'more row')}`;
  const tracks = rows.map((row) => {
    const slot = h('div', { class: 'track-slot' });
    const linked = Boolean(row.match) && row.count > 0;
    const total = h('span', { class: `track-total${linked ? ' under-link' : ''}` }, row.total);
    const element = h('div', { class: `track area-${row.area}`, hidden: Boolean(row.more) },
      h('p', { class: 'track-label' }, h('span', {}, row.label), total),
      slot);
    const id = `open-tl-${row.match}`;
    const link = linked
      ? h('button', {
        type: 'button', id, class: `tl-link area-${row.area}`, hidden: Boolean(row.more),
        onclick: () => openMatch(row.match, id),
      }, h('span', { class: 'visually-hidden' }, `${row.label}: `), h('span', { class: 'tl-chip' }, h('u', {}, row.total), chevron()), seeThem(row.count))
      : null;
    return { row, element, slot, total, link };
  });
  const links = h('div', { class: 'tl-links' }, tracks.map((track) => track.link));
  const band = h('div', { class: 'tl-band', 'aria-hidden': 'true' });
  const cursor = h('div', { class: 'tl-cursor', 'aria-hidden': 'true' });
  // Today on arrival; the day that was picked when a note changed under it.
  let index = days.includes(startDay) ? days.indexOf(startDay) : n - 1;
  const frame = h('div', {
    class: 'timeline', tabindex: '0', role: 'slider', 'aria-label': 'Timeline, day by day',
    'aria-valuemin': '1', 'aria-valuemax': String(n),
    onclick: (event) => {
      const box = frame.getBoundingClientRect();
      select(dayAt(event.clientX - box.left, n, box.width));
    },
    onkeydown: (event) => {
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
      const jump = { Home: 0, End: n - 1 }[event.key];
      if (step === undefined && jump === undefined) return;
      event.preventDefault();
      select(jump ?? index + step);
    },
  }, marks.lane, tracks.map((track) => track.element), marks.lines, band, cursor);
  const axis = h('div', { class: 'tl-axis', 'aria-hidden': 'true' });
  const tab = createDayTab({ surface: frame, count: n, select });
  const more = h('button', {
    type: 'button', class: 'link tl-more', 'aria-expanded': 'false',
    onclick: () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Fewer rows' : moreLabel;
      showMore(open);
      draw();
    },
  }, moreLabel);
  function showMore(open) {
    for (const track of tracks) {
      if (!track.row.more) continue;
      track.element.hidden = !open;
      if (track.link) track.link.hidden = !open;
    }
  }
  const detail = h('div', { class: 'day-detail' });

  // Dates under the rows, counted back from the last day so it's always named.
  function drawAxis(width) {
    const step = n <= 14 ? 1 : n <= 45 ? 7 : n <= 120 ? 14 : 30;
    const labels = [];
    for (let i = n - 1; i >= 0; i -= step) {
      const label = h('span', {}, shortDate(days[i]));
      label.style.setProperty('--x', `${Math.max(22, Math.min(width - 22, dayCenter(i, n, width)))}px`);
      labels.push(label);
    }
    axis.replaceChildren(...labels);
  }

  function placeCursor() {
    const width = frame.clientWidth;
    if (!width) return;
    band.style.setProperty('--x', `${(width / n) * index}px`);
    band.style.setProperty('--w', `${Math.max(width / n, 3)}px`);
    cursor.style.setProperty('--x', `${dayCenter(index, n, width)}px`);
    tab.show(index);
  }

  // On paper the rows are drawn for the page (print CSS sets the same
  // width), not for the screen the Print button was tapped on.
  let printing = false;
  function draw() {
    const width = printing ? PRINT_WIDTH : frame.clientWidth;
    if (!width) return;
    for (const track of tracks) {
      if (!track.element.hidden) track.slot.replaceChildren(svgTree(rowDrawing(track.row, width)));
    }
    drawAxis(width);
    placeLinks();
    placeCursor();
  }

  // Each link sits exactly over its row's total, which stays in place
  // (unseen) so the label line keeps its shape.
  function placeLinks() {
    const box = frame.getBoundingClientRect();
    for (const track of tracks) {
      if (!track.link || track.element.hidden) continue;
      const at = track.total.getBoundingClientRect();
      track.link.style.setProperty('--y', `${at.top - box.top + at.height / 2}px`);
    }
  }

  function select(next) {
    index = Math.max(0, Math.min(n - 1, next));
    const day = days[index];
    const { title, lines } = dayDetail(counts, day);
    const dayNotes = annotationsOnDay(notes, day);
    const records = counts.entries.filter((record) => localDate(record.occurred_at) === day).length;
    frame.setAttribute('aria-valuenow', String(index + 1));
    // A marked day names its note first, before the counts.
    frame.setAttribute('aria-valuetext', `${title}. ${[...dayNotes.map(annotationLine), ...lines].join(' ')}`);
    detail.replaceChildren(
      h('div', { class: 'day-head' },
        h('h3', {}, title),
        h('button', { type: 'button', class: 'link', onclick: () => openDay(day) },
          plural(records, 'record', 'records'), h('span', { 'aria-hidden': 'true' }, ' ›'))),
      h('dl', { class: 'day-facts' },
        dayNotes.map((note) => h('div', { class: 'fact note-fact' },
          h('dt', {}, note.date_to === null ? 'Note' : `Note · ${annotationDates(note)}`),
          h('dd', {}, note.text, note.initials ? h('small', {}, ` · ${note.initials}`) : null))),
        dayFacts(counts, day).map(({ area, label, value, note }) =>
          h('div', { class: `fact area-${area}` },
            h('dt', {}, label),
            value === NONE
              ? h('dd', { class: 'none' }, h('span', { 'aria-hidden': 'true' }, NONE), h('span', { class: 'visually-hidden' }, 'none recorded'))
              : h('dd', {}, value, note ? h('small', {}, ` · ${note}`) : null)))));
    placeCursor();
  }

  select(index);
  // Draws once the card is on the page, and again whenever its width changes.
  new ResizeObserver(draw).observe(frame);
  // Not named regions (here or the other Reports cards): iPhone VoiceOver
  // would say the name for the region and again for the heading inside it.
  const card = h('div', { class: 'chart-card timeline-card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'chart-title' }, 'When'),
      h('p', { class: 'hint' }, 'Tap a day, or drag the tab.')),
    h('div', { class: 'timeline-wrap' }, frame, links), axis, tab.track, more, detail);
  // Reports calls this around printing: every row, drawn for the page; then
  // back to the screen as it was.
  card.forPrint = (on) => {
    printing = on;
    showMore(on || more.getAttribute('aria-expanded') === 'true');
    draw();
  };
  card.pickedDay = () => days[index];
  return card;
}
