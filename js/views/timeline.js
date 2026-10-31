import { h, svgTree } from '../dom.js';
import { timelineRows } from '../charts.js';
import { rowDrawing, dayCenter, dayAt, shortDate } from '../chart-draw.js';
import { dayDetail, dayFacts, NONE } from '../day-detail.js';
import { localDate } from '../time.js';
import { createDayTab } from './day-tab.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const MORE_LABEL = '+ 3 more rows';

// "When": one timeline, a thin row per series on one date axis, drawn at the
// screen's own width so it never scrolls sideways. Each row's name and total
// sit above its line. Today is picked on arrival; a tap anywhere picks a day,
// and the drag tab under the axis moves along it. For screen readers and
// keyboards the rows are one slider over the days (arrow keys, Home, End),
// whose value text is the day in words; the drawings are aria-hidden.
export function timelineCard(counts, openDay) {
  const { days } = counts.window;
  const n = days.length;
  const tracks = timelineRows(counts).map((row) => {
    const slot = h('div', { class: 'track-slot' });
    const element = h('div', { class: `track area-${row.area}`, hidden: Boolean(row.more) },
      h('p', { class: 'track-label' }, h('span', {}, row.label), h('span', { class: 'track-total' }, row.total)),
      slot);
    return { row, element, slot };
  });
  const band = h('div', { class: 'tl-band', 'aria-hidden': 'true' });
  const cursor = h('div', { class: 'tl-cursor', 'aria-hidden': 'true' });
  let index = n - 1;
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
  }, tracks.map((track) => track.element), band, cursor);
  const axis = h('div', { class: 'tl-axis', 'aria-hidden': 'true' });
  const tab = createDayTab({ surface: frame, count: n, select });
  const more = h('button', {
    type: 'button', class: 'link tl-more', 'aria-expanded': 'false',
    onclick: () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Fewer rows' : MORE_LABEL;
      for (const track of tracks) if (track.row.more) track.element.hidden = !open;
      draw();
    },
  }, MORE_LABEL);
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

  function draw() {
    const width = frame.clientWidth;
    if (!width) return;
    for (const track of tracks) {
      if (!track.element.hidden) track.slot.replaceChildren(svgTree(rowDrawing(track.row, width)));
    }
    drawAxis(width);
    placeCursor();
  }

  function select(next) {
    index = Math.max(0, Math.min(n - 1, next));
    const day = days[index];
    const { title, lines } = dayDetail(counts, day);
    const records = counts.entries.filter((record) => localDate(record.occurred_at) === day).length;
    frame.setAttribute('aria-valuenow', String(index + 1));
    frame.setAttribute('aria-valuetext', `${title}. ${lines.join(' ')}`);
    detail.replaceChildren(
      h('div', { class: 'day-head' },
        h('h3', {}, title),
        h('button', { type: 'button', class: 'link', onclick: () => openDay(day) },
          plural(records, 'record', 'records'), h('span', { 'aria-hidden': 'true' }, ' ›'))),
      h('dl', { class: 'day-facts' }, dayFacts(counts, day).map(({ area, label, value, note }) =>
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
  return h('section', { class: 'chart-card timeline-card', 'aria-labelledby': 'when-title' },
    h('div', { class: 'card-head' },
      h('h2', { id: 'when-title', class: 'chart-title' }, 'When'),
      h('p', { class: 'hint' }, 'Tap a day, or drag the tab.')),
    frame, axis, tab.track, more, detail);
}
