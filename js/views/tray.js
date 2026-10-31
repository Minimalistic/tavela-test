import { h } from '../dom.js';

const SLIDE_MS = 260;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Optional extras (a note, initials) live on the raised tray above Save
// instead of in the form. Each opens a sheet that slides up with Done; the
// tray button says when it's filled. The sheet is a modal <dialog>, so focus
// stays inside it, Escape closes it and the form behind is inert.
// items: [{ field, title, open, filled(value), hint, multiline, maxlength }]
export function createTray({ getDraft, update, items }) {
  const buttons = items.map((item) => h('button', {
    type: 'button', class: 'tray-btn', 'aria-haspopup': 'dialog',
    onclick: (event) => openSheet(item, event.currentTarget),
  }));
  const element = h('div', { class: 'tray', role: 'group', 'aria-label': 'Optional' }, buttons);

  function sync() {
    items.forEach((item, index) => {
      const value = getDraft()[item.field]?.trim();
      buttons[index].textContent = value ? item.filled(value) : item.open;
      buttons[index].classList.toggle('has', Boolean(value));
    });
  }

  function openSheet(item, opener) {
    const field = h(item.multiline ? 'textarea' : 'input', {
      id: `sheet-${item.field}`, name: item.field, maxlength: item.maxlength, rows: item.multiline ? 4 : null,
      type: item.multiline ? null : 'text', autocomplete: 'off',
      autocapitalize: item.field === 'initials' ? 'characters' : 'sentences',
      'aria-labelledby': 'sheet-title', 'aria-describedby': 'sheet-hint',
      oninput: (event) => update({ [item.field]: event.target.value }),
      // Return in a one-line sheet means Done, never Save (the form blocks it too).
      onkeydown: item.multiline ? null : (event) => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); close(); } },
    });
    field.value = getDraft()[item.field] ?? '';
    // A button instead of a drag corner: a small target that's easy to miss on a tablet.
    const room = item.multiline ? h('button', {
      type: 'button', class: 'btn small secondary sheet-size', 'aria-controls': field.id, 'aria-expanded': 'false',
      onclick: () => {
        const big = room.getAttribute('aria-expanded') !== 'true';
        room.setAttribute('aria-expanded', String(big));
        room.textContent = big ? 'Less room' : 'More room';
        field.rows = big ? 10 : 4;
        field.focus({ preventScroll: true });
      },
    }, 'More room') : null;
    const panel = h('div', { class: 'sheet-panel' },
      h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
      h('h2', { id: 'sheet-title' }, item.title),
      h('p', { class: 'hint sheet-hint', id: 'sheet-hint' }, item.hint),
      field,
      h('div', { class: 'sheet-actions' }, room,
        h('button', { type: 'button', class: 'btn primary', onclick: () => close() }, 'Done')));
    const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title' }, panel);

    // On a phone the keyboard covers the bottom of the screen; lift the sheet
    // above it (visualViewport is the part still showing). CSSOM, not markup.
    const lift = () => {
      const vv = window.visualViewport;
      const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      dialog.style.setProperty('--keyboard', `${covered}px`);
    };
    window.visualViewport?.addEventListener('resize', lift);
    window.visualViewport?.addEventListener('scroll', lift);

    let closing = false;
    function close() {
      if (closing) return;
      closing = true;
      window.visualViewport?.removeEventListener('resize', lift);
      window.visualViewport?.removeEventListener('scroll', lift);
      const done = () => {
        dialog.close();
        dialog.remove();
        sync();
        opener.focus();
      };
      if (reduceMotion()) return done();
      panel.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }],
        { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished.then(done, done);
    }
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); }); // Escape
    // A tap on the backdrop lands on the dialog itself, outside the panel.
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });

    // Inside the form, so it leaves with the form if the screen changes.
    opener.closest('form').append(dialog);
    lift();
    dialog.showModal();
    field.focus({ preventScroll: true });
    if (!reduceMotion()) {
      panel.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
  }

  return { element, sync };
}
