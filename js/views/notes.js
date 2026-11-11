import { h, ask } from '../dom.js';
import {
  newAnnotationDraft, validate, toAnnotation, annotationDates,
  ANNOTATION_TEXT_LIMIT, ANNOTATION_INITIALS_LIMIT,
} from '../annotations.js';
import { toOffsetIso } from '../time.js';
import { reduceMotion } from './feedback.js';

// Notes pinned to dates (docs/SPEC.md §11, annotations.js): the card under
// "When" on Reports, and the sheet that adds or edits one. A note is a
// reviewer's remark, not an observation: it is edited or removed outright.
//
// notes: the ones touching Reports' window, newest date first.
// pickedDay(): the day picked on the timeline, where a new note starts.
// changed(focusId): a note was saved or removed; Reports redraws in place.
// noTimeline: the window has no entries, so there is no timeline to mark.
export function notesCard(app, { notes, pickedDay, changed, noTimeline = false }) {
  // Not a named region: iPhone VoiceOver would say "Notes" for the region
  // and again for the heading inside it.
  const card = h('div', { class: 'chart-card notes-card' });
  const add = h('button', {
    type: 'button', id: 'add-note', class: 'btn small', 'aria-haspopup': 'dialog',
    onclick: () => openNoteForm(app, { host: card, opener: add, dateFrom: pickedDay(), changed }),
  }, '+ Add note');

  async function remove(note) {
    const choice = await ask({
      title: 'Remove this note?',
      body: `${annotationDates(note)}: ${note.text}`,
      buttons: [
        { label: 'Remove note', value: 'remove', kind: 'danger' },
        { label: 'Keep it', value: 'keep', kind: 'primary' },
      ],
    });
    if (choice !== 'remove') return;
    try {
      await app.store.deleteAnnotation(note.id);
    } catch (err) {
      console.error('Handstead: removing a note failed:', err?.name ?? 'unknown error');
      status.textContent = 'Not removed. Try again.';
      return;
    }
    changed('add-note');
  }

  const status = h('p', { class: 'save-status failed', role: 'status', 'aria-live': 'polite' });
  const row = (note) => {
    const editId = `edit-note-${note.id}`;
    const edit = h('button', {
      type: 'button', id: editId, class: 'link', 'aria-haspopup': 'dialog',
      onclick: () => openNoteForm(app, { host: card, opener: edit, note, changed }),
    }, 'Edit', h('span', { class: 'visually-hidden' }, ` note, ${annotationDates(note)}`));
    return h('li', {},
      h('span', { class: 'note-when' }, annotationDates(note)),
      h('p', { class: 'note-text' }, note.text, note.initials ? h('span', { class: 'note-by' }, ` · ${note.initials}`) : null),
      h('span', { class: 'note-acts' }, edit,
        h('button', { type: 'button', class: 'link', onclick: () => remove(note) },
          'Remove', h('span', { class: 'visually-hidden' }, ` note, ${annotationDates(note)}`))));
  };

  card.append(
    h('div', { class: 'card-head' }, h('h2', { class: 'chart-title' }, 'Notes'), add),
    notes.length
      ? h('ul', { class: 'notes-list' }, notes.map(row))
      : h('p', { class: 'hint notes-none' }, 'No notes in these dates. A note marks a day or a range on the timeline, like the start of a new medication.'),
    noTimeline && notes.length
      ? h('p', { class: 'hint notes-why' }, 'These dates have no entries, so there is no timeline to mark. The notes are listed here.')
      : null,
    status);
  return card;
}

// The add and edit sheet: a modal <dialog> from the bottom, like the
// Check-In's note sheet (tray.js), so Reports stays where it was behind it.
// Nothing is filled in but the day (shown, changeable); initials start empty.
function openNoteForm(app, { host, opener, note = null, dateFrom = null, changed }) {
  let draft;
  if (note) draft = structuredClone(note);
  else draft = newAnnotationDraft({ id: crypto.randomUUID(), dateFrom });
  const update = (changes) => { draft = { ...draft, ...changes }; };

  const input = (field, props) => {
    const element = h(props.rows ? 'textarea' : 'input', {
      id: `note-${field}`, name: field, autocomplete: 'off', 'aria-describedby': `note-${field}-error`, ...props,
      oninput: (event) => update({ [field]: event.target.value }),
    });
    element.value = draft[field] ?? '';
    return element;
  };
  const fields = {
    text: input('text', { rows: 3, maxlength: ANNOTATION_TEXT_LIMIT, autocapitalize: 'sentences' }),
    date_from: input('date_from', { type: 'date' }),
    date_to: input('date_to', { type: 'date' }),
    initials: input('initials', { type: 'text', maxlength: ANNOTATION_INITIALS_LIMIT, autocapitalize: 'characters' }),
  };
  const errors = Object.fromEntries(Object.keys(fields).map((field) =>
    [field, h('p', { class: 'note-error', id: `note-${field}-error` })]));
  const group = (field, label, hint = null) => h('div', { class: `note-field note-field-${field}` },
    h('label', { for: `note-${field}` }, label, hint ? h('span', { class: 'note-optional' }, ` ${hint}`) : null),
    fields[field], errors[field]);

  const status = h('p', { class: 'save-status failed', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn primary' }, note ? 'Save changes' : 'Save note');
  const form = h('form', {
    class: 'sheet-panel note-form', novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      const problems = validate(draft);
      for (const field of Object.keys(fields)) {
        errors[field].textContent = problems[field] ?? '';
        fields[field].setAttribute('aria-invalid', String(Boolean(problems[field])));
      }
      const first = Object.keys(fields).find((field) => problems[field]);
      if (first) {
        fields[first].focus();
        return;
      }
      save.disabled = true;
      try {
        await app.store.put('annotations', toAnnotation(draft, toOffsetIso(new Date())));
      } catch (err) {
        // The name only: what a note says never reaches the console.
        console.error('Handstead: saving a note failed:', err?.name ?? 'unknown error');
        status.textContent = 'Not saved. Nothing was changed. Try again.';
        save.disabled = false;
        return;
      }
      close(() => changed(note ? opener.id : 'add-note'));
    },
  },
  h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
  h('h2', { id: 'note-title' }, note ? 'Edit note' : 'Add a note'),
  h('p', { class: 'hint sheet-hint' }, 'Pinned to a day, or a range of days. It shows on the timeline, in backups and in exports.'),
  group('text', 'Note'),
  h('div', { class: 'note-days' },
    group('date_from', 'Day'),
    group('date_to', 'Last day', '(optional, for a range)')),
  group('initials', 'Initials', '(optional)'),
  status,
  h('div', { class: 'sheet-actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'),
    save));
  const dialog = h('dialog', { class: 'sheet note-sheet', 'aria-labelledby': 'note-title' }, form);

  // Lifted above an on-screen keyboard, as tray.js does for its sheet.
  const lift = () => {
    const vv = window.visualViewport;
    // The screen changed under an open sheet (Back): stop listening.
    if (!dialog.isConnected) {
      vv?.removeEventListener('resize', lift);
      vv?.removeEventListener('scroll', lift);
      return;
    }
    const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    dialog.style.setProperty('--keyboard', `${covered}px`);
  };
  window.visualViewport?.addEventListener('resize', lift);
  window.visualViewport?.addEventListener('scroll', lift);

  let closing = false;
  function close(after = () => opener.focus()) {
    if (closing) return;
    closing = true;
    window.visualViewport?.removeEventListener('resize', lift);
    window.visualViewport?.removeEventListener('scroll', lift);
    const done = () => {
      dialog.close();
      dialog.remove();
      after();
    };
    if (reduceMotion()) return done();
    form.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }],
      { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished.then(done, done);
  }
  // Escape closes; a tap outside doesn't, so a stray touch can't lose what
  // was typed (the Check-In's sheet keeps its text, this one would not).
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });

  // Inside Reports, so it leaves with the screen if the screen changes.
  host.append(dialog);
  lift();
  dialog.showModal();
  fields.text.focus({ preventScroll: true });
  if (!reduceMotion()) {
    form.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}
