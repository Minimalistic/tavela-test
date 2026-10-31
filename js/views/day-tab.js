import { h } from '../dom.js';
import { dayAt, tabPlacement } from '../chart-draw.js';

const TAB_WIDTH = 44;

// A tab under the picked day that can be pressed and slid along the date
// axis, snapping to each day: finer than a fingertip on a phone, where a 90-day
// timeline gives each day a few pixels. Only the tab takes the finger
// (touch-action: none); the rest of the page still scrolls. It's a pointer
// helper only: the timeline stays the one slider for keyboards and screen
// readers, so the tab is aria-hidden and never focused.
// surface: the element whose width the days span; select(i) picks a day.
export function createDayTab({ surface, count, select }) {
  const tab = h('div', { class: 'day-tab', 'aria-hidden': 'true', hidden: true }, h('span', { class: 'day-tab-grip' }));
  const track = h('div', { class: 'day-track' }, tab);
  let index = -1;
  let dragging = false;

  function place() {
    if (index < 0) return;
    const { left, pointer } = tabPlacement(index, count, surface.getBoundingClientRect().width, TAB_WIDTH);
    tab.style.setProperty('--tab-left', `${left}px`);
    tab.style.setProperty('--tab-pointer', `${pointer}px`);
  }

  // Called by the timeline whenever a day is picked, however it was picked.
  function show(next) {
    index = next;
    tab.hidden = false;
    place();
  }

  function pickAt(clientX) {
    const box = surface.getBoundingClientRect();
    const next = dayAt(clientX - box.left, count, box.width);
    if (next !== index) select(next);
  }

  function release() {
    dragging = false;
    tab.classList.remove('dragging');
  }

  tab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    tab.setPointerCapture(event.pointerId);
    tab.classList.add('dragging');
    dragging = true;
  });
  tab.addEventListener('pointermove', (event) => { if (dragging) pickAt(event.clientX); });
  tab.addEventListener('pointerup', release);
  tab.addEventListener('pointercancel', release);
  // A tap on the tab isn't a tap on a day.
  tab.addEventListener('click', (event) => event.stopPropagation());

  return { track, show, place };
}
