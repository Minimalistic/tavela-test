import { h, icon } from '../dom.js';
import { SUMMARY_TYPES } from '../handoff.js';
import { handoffIcon } from '../areas.js';
import { lastLogged, doneToday } from '../entries.js';
import { formatTime, timeAgo, isSameLocalDay } from '../time.js';

// Bathroom Check-In is the anytime capture, so it leads; the two Updates are
// once-a-day handoffs and share one tinted panel, rows joined in one card, so
// they read as a pair (DECISIONS "Handoffs panel"). Tablets: Check-In beside
// the panel. Phones: stacked.
// A done Update's row opens it to read, with a check and a deeper tint
// (DECISIONS "One Update a day"; look B in design/mocks/handoff-done.html).
const tile = ({ area, iconName, label, sub, done = null, onclick, big = false }) =>
  h('button', {
    type: 'button', class: `home-tile area-${area}${big ? ' home-tile-big' : ''}${done ? ' is-done' : ''}`, onclick,
    'aria-label': done ? `${label}, done today ${done}, open it` : null,
  },
    icon(iconName, big ? 44 : 30),
    h('span', { class: 'home-tile-text' },
      h('span', { class: 'home-tile-label' }, label),
      h('span', { class: 'home-tile-sub' }, sub),
      // The save icon is Lucide's check.
      done ? h('span', { class: 'home-tile-done' }, icon('save', 18), ` Done today · ${done}`) : null));

// Time only, never what happened: Home is on a shared screen.
const lastLoggedText = (record) => {
  const ago = timeAgo(record.occurred_at);
  return `Last logged ${formatTime(record.occurred_at)}${ago ? ` · ${ago}` : ''}`;
};

export async function renderHome(app) {
  const [events, handoffs] = await Promise.all([app.store.getAll('bathroom_events'), app.store.getAll('handoffs')]);
  const last = lastLogged(events);
  const lastLine = last ? h('p', { class: 'home-last' }, lastLoggedText(last)) : null;
  const renderedAt = new Date();
  const home = h('section', { class: 'home' },
    h('div', { class: 'home-main' },
      h('div', { class: 'home-checkin' }, tile({
        // A non-breaking hyphen (U+2011) keeps "Check-In" whole on a phone.
        area: 'bathroom', iconName: 'checkin', label: 'Bathroom Check\u2011In', sub: 'Any time, as it happens', big: true,
        onclick: () => app.show('checkin'),
      }), lastLine),
      h('div', {
        class: 'home-handoffs area-handoff', role: 'group',
        'aria-labelledby': 'handoffs-label', 'aria-describedby': 'handoffs-sub',
      },
        h('div', { class: 'home-group-head' },
          h('p', { class: 'home-group-label', id: 'handoffs-label' }, icon('handoffs', 20), ' Handoffs'),
          h('p', { class: 'home-group-sub', id: 'handoffs-sub' }, 'When care changes hands')),
        h('div', { class: 'home-handoff-list' },
          SUMMARY_TYPES.map(({ code, label, direction }) => {
            const done = doneToday(handoffs, code);
            return tile({
              area: 'handoff', iconName: handoffIcon(code), label, sub: direction,
              done: done ? formatTime(done.occurred_at) : null,
              onclick: () => (done ? app.show('record', { record: done }) : app.show('handoff', { type: code })),
            });
          })))),
    h('div', { class: 'home-secondary' },
      h('button', { type: 'button', class: 'btn secondary', onclick: () => app.show('reports') }, icon('reports'), ' Reports & Records'),
      // Hidden in demo mode, so demo data can't leave in a backup (SPEC §16).
      app.demo ? null : h('button', { type: 'button', class: 'btn secondary area-backup', onclick: () => app.show('backup') }, icon('backup'), ' Backup & Restore')));
  keepCurrent(app, home, lastLine, last, renderedAt);
  return home;
}

// A shared iPad can sit on Home overnight, so "Done today" must not carry
// yesterday's Updates into the morning. The timer pauses while the device
// sleeps and catches the new day on wake; coming back to the app redraws at
// once. Both stop once Home is replaced. A dialog that is up is left alone;
// the next tick tries again.
function keepCurrent(app, home, lastLine, last, renderedAt) {
  const stop = () => {
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisible);
  };
  const redraw = () => {
    if (document.querySelector('dialog[open]')) return;
    stop();
    app.show('home');
  };
  const tick = setInterval(() => {
    if (!home.isConnected) stop();
    else if (!isSameLocalDay(renderedAt, new Date())) redraw();
    else if (lastLine) lastLine.textContent = lastLoggedText(last);
  }, 30000);
  const onVisible = () => {
    if (!home.isConnected) stop();
    else if (document.visibilityState === 'visible') redraw();
  };
  document.addEventListener('visibilitychange', onVisible);
}
