import { h, icon } from '../dom.js';
import { entryArea } from '../areas.js';
import {
  FORM_EVENTS, PAIN, URINE_CHANGE, URINE_DETAILS, BRISTOL, BM_AMOUNT, ATTEMPT_TARGET,
  BOWEL_CARE_STATUS, CONCERNS, newBathroomDraft, normalize, visibleFields, validate,
  painRequired, showsConcernReminder, toggleConcern, toggleDetail,
} from '../bathroom.js';
import { saveBathroomEvent } from '../save.js';
import { toOffsetIso } from '../time.js';
import { siteOptions } from '../settings.js';
import { createFields, blockImplicitSubmit } from './fields.js';
import { setShown, tapFeedback } from './feedback.js';
import { confirmLeave } from './leave.js';
import { showSavedCard } from './saved.js';
import { createTray } from './tray.js';

// With `record`, edits that entry (same id, SPEC §9).
export async function renderCheckin(app, { record = null } = {}) {
  const { store, settings } = app;
  const name = settings.display_name;
  const editing = record !== null;
  const lastSite = editing ? null : await store.getMeta('last_site_code');
  let draft = editing
    ? structuredClone(record)
    : newBathroomDraft({ id: crypto.randomUUID(), occurredAt: toOffsetIso(new Date()), siteCode: lastSite });
  let pristine = JSON.stringify(draft);
  let saving = false;

  const {
    groups, radioGroup, scaleGroup, checkGroup, textField, whenGroup, syncInputs,
    revealNeeds, needsShown, hideNeeds,
  } = createFields({
    getDraft: () => draft,
    update,
  });

  function update(changes) {
    draft = normalize({ ...draft, ...changes });
    sync();
  }

  const siteNote = lastSite
    ? h('p', { class: 'hint' }, 'Pre-selected from the last entry. Change it if you are somewhere else.')
    : null;
  const siteGroup = radioGroup('site_code', 'Where?', siteOptions(settings), { columns: 'cols-4', area: 'handoff' });
  if (siteNote) siteGroup.append(siteNote);

  const reminder = h('div', { class: 'reminder', role: 'note', hidden: true },
    h('strong', {}, 'Reminder: '),
    `Follow ${name}'s existing nurse/medical notification plan. Saving this entry does not notify anyone.`);

  const saveCount = h('span', { class: 'save-count', hidden: true });
  const saveButton = h('button', { type: 'submit', class: 'btn primary big' }, icon('save'), ' ', editing ? 'Save Changes' : 'Save', saveCount);
  const cancelButton = editing
    ? h('button', { type: 'button', class: 'btn big', onclick: () => app.show('record', { record }) }, 'Cancel')
    : null;
  const saveStatus = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });

  const tray = createTray({
    getDraft: () => draft,
    update,
    items: [
      { field: 'notes', title: 'Note', open: '+ Add a note', filled: () => 'Note added', multiline: true, maxlength: 500,
        hint: 'Something unusual, or anything the next person should know. Optional.' },
      { field: 'initials', title: 'Initials', open: '+ Initials', filled: (value) => `Initials: ${value}`, maxlength: 8,
        hint: 'Optional.' },
    ],
  });
  // A new check-in can be cleared in one tap, with Undo; an edit keeps Cancel.
  const startOverButton = editing ? null : h('button', { type: 'button', class: 'link start-over', hidden: true, onclick: startOver }, 'Start over');

  const form = h('form', { class: 'entry-form area-bathroom', novalidate: true, onsubmit: onSave, onkeydown: blockImplicitSubmit },
    h('h1', { class: 'form-title area-bathroom' }, icon('checkin', 30), editing ? 'Edit Existing Entry' : 'New Bathroom Check-In'),
    editing ? h('p', { class: 'hint form-sub' }, 'Bathroom Check-In') : null,
    whenGroup('When did this happen?'),
    siteGroup,
    // Event codes double as icon names (areas.js).
    radioGroup('event_code', 'What happened?', FORM_EVENTS, { columns: 'cols-4', iconFor: (option) => [option.code, entryArea({ event_code: option.code })] }),
    radioGroup('attempt_target', 'Tried to…', ATTEMPT_TARGET),
    radioGroup('pain_code', `Did ${name} say "ow" or show discomfort?`, PAIN, { area: 'comfort' }),
    radioGroup('urine_change_code', 'Any change in urine?', URINE_CHANGE),
    checkGroup('urine_change_details', 'What changed?', URINE_DETAILS,
      (d, code) => ({ urine_change_details: toggleDetail(d.urine_change_details, code) })),
    textField('urine_change_note', 'About the change (optional)', { maxlength: 200 }),
    scaleGroup('bristol_type', 'Bristol stool type', BRISTOL, {
      off: ['unable'], ends: ['Hard', 'Liquid'], area: 'bowel',
      segText: (option) => String(option.code),
      name: (option) => `Type ${option.code}, ${option.description}`,
      describe: (option) => `Type ${option.code} · ${option.description}`,
    }),
    scaleGroup('bm_amount', 'BM amount (optional)', BM_AMOUNT, {
      off: ['unsure'], area: 'bowel', segText: (option) => option.label, name: (option) => option.label,
    }),
    radioGroup('bowel_care_status', 'Bowel flush-care status', BOWEL_CARE_STATUS, { area: 'bowel' }),
    checkGroup('concern_codes', 'Was a concern reported? (optional)', CONCERNS,
      (d, code) => ({ concern_codes: toggleConcern(d.concern_codes, code) })),
    reminder,
    h('div', { class: 'save-bar' }, tray.element, startOverButton, saveStatus, cancelButton, saveButton));

  tapFeedback(form);

  function sync() {
    const visible = visibleFields(draft);
    const errors = validate(draft);
    const conditional = ['attempt_target', 'pain_code', 'urine_change_code', 'urine_change_details',
      'urine_change_note', 'bristol_type', 'bm_amount', 'bowel_care_status', 'concern_codes'];
    for (const field of conditional) setShown(groups[field], visible.has(field));

    groups.pain_code.querySelector('legend').textContent =
      `Did ${name} say "ow" or show discomfort?${painRequired(draft) ? '' : ' (optional)'}`;

    syncInputs(form, errors);
    tray.sync();
    if (startOverButton) startOverButton.hidden = JSON.stringify(draft) === pristine;
    reminder.hidden = !showsConcernReminder(draft);

    const missing = Object.keys(errors).length;
    // Save never greys out; after an early tap it carries the count.
    saveCount.hidden = !needsShown() || missing === 0;
    saveCount.textContent = `${missing} needed`;
    if (missing === 0 && saveStatus.dataset.needs) {
      saveStatus.textContent = '';
      delete saveStatus.dataset.needs;
    }
  }

  let undoToast = null;
  let undoTimer = null;
  function dropUndo() {
    clearTimeout(undoTimer);
    undoToast?.remove();
    undoToast = null;
  }
  function startOver() {
    const before = { draft, pristine };
    draft = newBathroomDraft({ id: draft.id, occurredAt: toOffsetIso(new Date()), siteCode: lastSite });
    pristine = JSON.stringify(draft);
    hideNeeds();
    sync();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    dropUndo();
    const undo = h('button', {
      type: 'button',
      onclick: () => {
        ({ draft, pristine } = before);
        dropUndo();
        sync();
      },
    }, 'Undo');
    undoToast = h('div', { class: 'toast', role: 'status' }, 'Cleared', undo);
    form.append(undoToast);
    undo.focus({ preventScroll: true });
    undoTimer = setTimeout(dropUndo, 10000);
  }

  async function onSave(event) {
    event.preventDefault();
    if (saving) return;
    const missing = Object.keys(validate(draft)).length;
    if (missing > 0) {
      // Saves nothing and loses nothing: marks what's needed instead.
      revealNeeds(form, () => sync());
      saveStatus.textContent = `Not saved yet. ${missing} answer${missing === 1 ? '' : 's'} still needed.`;
      saveStatus.className = 'save-status visually-hidden';
      saveStatus.dataset.needs = 'true';
      return;
    }
    delete saveStatus.dataset.needs;
    saving = true;
    saveStatus.textContent = 'Saving…';
    saveStatus.className = 'save-status';
    sync();
    const result = await saveBathroomEvent(store, draft);
    saving = false;
    if (result.ok) {
      saveStatus.textContent = '';
      if (!editing) {
        store.setMeta('last_site_code', result.record.site_code).catch((err) =>
          console.warn('Tavela: could not remember last site:', err?.name ?? 'unknown error'));
      }
      app.leaveGuard = null;
      if (editing) app.show('record', { record: result.record, saved: true });
      else showSavedCard(app, result.record);
      return;
    }
    saveStatus.textContent = result.message ?? 'Not saved. Answer the questions marked "Needed to save".';
    saveStatus.className = 'save-status failed';
    sync();
  }

  app.leaveGuard = () => confirmLeave(JSON.stringify(draft) !== pristine, editing);

  sync();
  return form;
}
