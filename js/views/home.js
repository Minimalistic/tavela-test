import { h, icon } from '../dom.js';
import { SUMMARY_TYPES } from '../handoff.js';
import { handoffIcon } from '../areas.js';
import { lastLogged, doneToday } from '../entries.js';
import { formatTime, timeAgo } from '../time.js';

// Bathroom Check-In is the anytime capture, so it leads; the two Updates are
// once-a-day handoffs and sit together under their own heading (DECISIONS
// 10-20). Tablets: Check-In beside the handoff pair. Phones: stacked.
const tile = ({ area, iconName, label, sub, done = null, onclick, big = false }) =>
  h('button', { type: 'button', class: `home-tile area-${area}${big ? ' home-tile-big' : ''}`, onclick },
    icon(iconName, big ? 44 : 30),
    h('span', { class: 'home-tile-text' },
      h('span', { class: 'home-tile-label' }, label),
      h('span', { class: 'home-tile-sub' }, sub),
      done ? h('span', { class: 'home-tile-done' }, done) : null));

// Time only, never what happened: Home is on a shared screen.
const lastLoggedText = (record) => {
  const ago = timeAgo(record.occurred_at);
  return `Last logged ${formatTime(record.occurred_at)}${ago ? ` · ${ago}` : ''}`;
};

export async function renderHome(app) {
  const [events, handoffs] = await Promise.all([app.store.getAll('bathroom_events'), app.store.getAll('handoffs')]);
  const last = lastLogged(events);
  const doneLine = (type) => {
    const record = doneToday(handoffs, type);
    return record ? `Done today · ${formatTime(record.occurred_at)}` : null;
  };
  const lastLine = last ? h('p', { class: 'home-last' }, lastLoggedText(last)) : null;
  // Kept current while Home is open; stops once Home is replaced.
  if (lastLine) {
    const tick = setInterval(() => {
      if (!lastLine.isConnected) clearInterval(tick);
      else lastLine.textContent = lastLoggedText(last);
    }, 30000);
  }
  return h('section', { class: 'home' },
    h('div', { class: 'home-main' },
      h('div', { class: 'home-checkin' }, tile({
        // A non-breaking hyphen (U+2011) keeps "Check-In" whole on a phone.
        area: 'bathroom', iconName: 'checkin', label: 'Bathroom Check\u2011In', sub: 'Any time, as it happens', big: true,
        onclick: () => app.show('checkin'),
      }), lastLine),
      h('div', { class: 'home-handoffs area-handoff', role: 'group', 'aria-labelledby': 'handoffs-label' },
        h('p', { class: 'home-group-label', id: 'handoffs-label' }, icon('handoffs', 18), ' Handoffs · once a day'),
        SUMMARY_TYPES.map(({ code, label, direction }) => tile({
          area: 'handoff', iconName: handoffIcon(code), label, sub: direction,
          done: doneLine(code),
          onclick: () => app.show('handoff', { type: code }),
        })))),
    h('div', { class: 'home-secondary' },
      h('button', { type: 'button', class: 'btn secondary', onclick: () => app.show('reports') }, icon('reports'), ' Reports & Records'),
      // Hidden in demo mode, so demo data can't leave in a backup (SPEC §16).
      app.demo ? null : h('button', { type: 'button', class: 'btn secondary area-backup', onclick: () => app.show('backup') }, icon('backup'), ' Backup & Restore')));
}
