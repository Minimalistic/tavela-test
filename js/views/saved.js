import { h } from '../dom.js';
import { ENTRY_TYPES, entryType } from '../entries.js';
import { formatTime } from '../time.js';

const HOLD_MS = 10000;
const DISSOLVE_MS = 1400;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// After a new entry saves: the form softens and dims behind a card with ✓,
// "Saved", and the kind of entry and its time, never what happened (the
// screen is shared). It stays about 10 seconds, or until Done or a tap
// outside, then dissolves: Home is drawn underneath first (still blurred, so
// the swap doesn't show), the card drifts up and thins out, and the blur and
// dim lift off a clean Home. A modal <dialog>, so nothing behind it takes a
// tap while it's up.
export function showSavedCard(app, record) {
  const view = document.getElementById('view');
  const kind = ENTRY_TYPES.find((type) => type.code === entryType(record)).label;
  const title = h('h2', { class: 'saved-title', id: 'saved-title', tabindex: '-1' }, 'Saved');
  const card = h('div', { class: 'saved-card', role: 'status' },
    h('span', { class: 'saved-mark', 'aria-hidden': 'true' }, '✓'),
    title,
    h('p', { class: 'saved-what' }, `${kind} · ${formatTime(record.occurred_at)}`),
    app.demo ? h('p', { class: 'saved-where' }, 'Saved to the demo data') : null,
    h('button', { type: 'button', class: 'btn primary', onclick: () => dismiss() }, 'Done'));
  const dim = h('div', { class: 'saved-dim' });
  const dialog = h('dialog', { class: 'saved-dialog', 'aria-labelledby': 'saved-title' }, dim, card);

  let leaving = false;
  const timer = setTimeout(() => dismiss(), HOLD_MS);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); dismiss(); }); // Escape
  dim.addEventListener('click', () => dismiss());

  async function dismiss() {
    if (leaving) return;
    leaving = true;
    clearTimeout(timer);
    const finish = () => {
      dialog.close();
      dialog.remove();
      view.classList.remove('saving');
      view.focus();
    };
    try {
      await app.show('home');
    } catch (err) {
      // Never leave the card stuck over the app; the form stays behind it.
      console.warn('Tavela: could not draw Home after saving:', err?.name ?? 'unknown error');
      return finish();
    }
    if (reduceMotion()) return finish();
    const ease = { duration: DISSOLVE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' };
    const moves = [
      card.animate([
        { opacity: 1, filter: 'blur(0px)', transform: 'none' },
        { opacity: 0.55, filter: 'blur(3px)', transform: 'translateY(-8px) scale(1.02)', offset: 0.45 },
        { opacity: 0, filter: 'blur(14px)', transform: 'translateY(-22px) scale(1.07)' },
      ], ease),
      dim.animate([{ opacity: 1 }, { opacity: 0 }], ease),
      view.animate([{ filter: 'blur(2.5px)' }, { filter: 'blur(0px)' }], ease),
    ];
    Promise.all(moves.map((move) => move.finished)).then(() => {
      finish();
      for (const move of moves) move.cancel();
    }, finish);
  }

  view.classList.add('saving');
  document.body.append(dialog);
  dialog.showModal();
  title.focus({ preventScroll: true });
  if (!reduceMotion()) {
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    card.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}
