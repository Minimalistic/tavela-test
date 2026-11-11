import { h, icon } from '../dom.js';
import { reduceMotion } from './feedback.js';
import { ENTRY_TYPES, entryType } from '../entries.js';
import { undoVoid } from '../save.js';
import { formatTime } from '../time.js';

export const HOLD_MS = 1500;

// After a void: Records is drawn (softened) behind a card that says "Voided",
// the kind of entry and its time, never what happened (the screen is shared).
// Unlike the Saved card it has weight: for HOLD_MS nothing takes a tap, and
// then it waits for Done however long that is. No timer, no tap outside, no
// Escape. Undo is the only way back from a void, and only here (DECISIONS
// "Void card"). The void is already written, so closing the app with the card
// up leaves the entry voided.
export async function showVoidedCard(app, voided) {
  const view = document.getElementById('view');
  await app.show('records', { voided: true });

  const kind = ENTRY_TYPES.find((type) => type.code === entryType(voided)).label;
  const title = h('h2', { class: 'saved-title', id: 'voided-title', tabindex: '-1' }, 'Voided');
  const status = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  // aria-disabled, not disabled: a screen reader still finds the buttons
  // during the hold and says they're unavailable.
  const undo = h('button', { type: 'button', class: 'btn', 'aria-disabled': 'true', onclick: () => held || undoIt() }, 'Undo');
  const done = h('button', { type: 'button', class: 'btn primary', 'aria-disabled': 'true', onclick: () => held || close() }, 'Done');
  const card = h('div', { class: 'saved-card voided-card' },
    h('span', { class: 'voided-mark', 'aria-hidden': 'true' }, icon('void', 30)),
    title,
    h('p', { class: 'saved-what', id: 'voided-what' }, `${kind} · ${formatTime(voided.occurred_at)}`),
    h('p', { class: 'saved-where' }, `Kept ${app.demo ? 'in the demo data' : 'on this device'}; find it with Show voided under Filters.`),
    status,
    h('div', { class: 'voided-buttons' }, undo, done));
  const dialog = h('dialog', { class: 'saved-dialog', 'aria-labelledby': 'voided-title', 'aria-describedby': 'voided-what' },
    h('div', { class: 'saved-dim' }), card);

  let held = true;
  let busy = false;
  const holdTimer = setTimeout(() => {
    held = false;
    undo.removeAttribute('aria-disabled');
    done.removeAttribute('aria-disabled');
  }, HOLD_MS);

  // Escape never clears it. Chrome lets a second Escape through a cancelled
  // `cancel`, so the key is stopped too; if the dialog closes anyway, that
  // counts as Done rather than leaving Records blurred.
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.preventDefault(); });
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('close', () => close());

  function close() {
    clearTimeout(holdTimer);
    if (!dialog.isConnected) return;
    dialog.remove();
    view.classList.remove('saving');
    view.focus();
  }

  async function undoIt() {
    if (busy) return;
    busy = true;
    const result = await undoVoid(app.store, voided);
    busy = false;
    if (!result.ok) {
      status.className = 'save-status failed';
      status.textContent = result.message;
      return;
    }
    close();
    app.show('record', { record: result.record, notVoided: true });
  }

  view.classList.add('saving');
  document.body.append(dialog);
  dialog.showModal();
  title.focus({ preventScroll: true });
  if (!reduceMotion()) {
    card.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}
