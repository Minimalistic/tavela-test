import { h, icon } from '../dom.js';
import {
  QUESTIONS, SUMMARY_TYPES, TEXT_LABELS, BEHAVIORS, newHandoffDraft, toggleBehavior, behaviorChecked, validate,
} from '../handoff.js';
import { labelFor } from '../bathroom.js';
import { saveHandoff } from '../save.js';
import { toOffsetIso } from '../time.js';
import { siteOptions } from '../settings.js';
import { createFields, blockImplicitSubmit } from './fields.js';
import { setShown, tapFeedback } from './feedback.js';
import { confirmLeave } from './leave.js';
import { showSavedCard } from './saved.js';
import { handoffIcon } from '../areas.js';
import { createTray } from './tray.js';

// Morning / Afternoon Update (SPEC §8). With `record`, edits that entry.
export async function renderHandoff(app, { type, record = null }) {
  const { store, settings } = app;
  const name = settings.display_name;
  const editing = record !== null;
  const summaryType = editing ? record.summary_type : type;
  const lastSite = editing ? null : await store.getMeta('last_site_code');
  let draft = editing
    ? structuredClone(record)
    : newHandoffDraft({ id: crypto.randomUUID(), type: summaryType, occurredAt: toOffsetIso(new Date()), siteCode: lastSite });
  const pristine = JSON.stringify(draft);
  let saving = false;

  const {
    radioGroup, checkGroup, textField, whenGroup, syncInputs,
    revealNeeds, needsShown, hideNeeds,
  } = createFields({
    getDraft: () => draft,
    update,
  });

  function update(changes) {
    draft = { ...draft, ...changes };
    sync();
  }

  const typeInfo = SUMMARY_TYPES.find((t) => t.code === summaryType);
  const labels = TEXT_LABELS[summaryType];

  const siteGroup = radioGroup('site_code', 'Where?', siteOptions(settings), { columns: 'cols-4' });
  if (lastSite) siteGroup.append(h('p', { class: 'hint' }, 'Pre-selected from the last entry. Change it if you are somewhere else.'));

  // SPEC §8, §19: the positive prompt is always visible and given room.
  const positive = textField('positive_note', `${labels.positive_note} (optional)`, {
    multiline: true, className: 'positive-group',
    hint: `Something ${name} enjoyed, did well, or a good moment worth passing on.`,
  });
  positive.querySelector('label').prepend(icon('positive'), ' ');

  const otherNote = textField('behavior_other_note', 'What was the other behavior? (optional)', { maxlength: 200 });

  const questions = QUESTIONS[summaryType].map((question) => {
    if (question.field === 'behaviors') {
      return [checkGroup('behaviors', question.legend(name), question.options, toggleBehavior, behaviorChecked), otherNote];
    }
    return radioGroup(question.field, question.legend(name), question.options, {
      columns: question.field === 'comfort' ? 'cols-3' : '',
      describe: (option) => option.description || '',
    });
  });

  const saveCount = h('span', { class: 'save-count', hidden: true });
  const saveButton = h('button', { type: 'submit', class: 'btn primary big' }, icon('save'), ' ', editing ? 'Save Changes' : 'Save Update', saveCount);
  const cancelButton = editing
    ? h('button', { type: 'button', class: 'btn big', onclick: () => app.show('record', { record }) }, 'Cancel')
    : null;
  const saveStatus = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  // Initials sit on the raised tray, as on the Check-In; the handoff note
  // stays in the form, since it's the substance of the Update.
  const tray = createTray({
    getDraft: () => draft,
    update,
    items: [{ field: 'initials', title: 'Initials', open: '+ Initials', filled: (value) => `Initials: ${value}`, maxlength: 8, hint: 'Optional.' }],
  });

  const form = h('form', { class: 'entry-form area-handoff', novalidate: true, onsubmit: onSave, onkeydown: blockImplicitSubmit },
    h('h1', { class: 'form-title area-handoff' }, icon(handoffIcon(summaryType), 30), editing ? 'Edit Existing Entry' : typeInfo.label),
    h('p', { class: 'hint form-sub' }, editing ? typeInfo.label : typeInfo.direction),
    whenGroup('When is this update for?'),
    siteGroup,
    positive,
    questions.flat(),
    textField('handoff_note', `${labels.handoff_note} (optional)`, { multiline: true }),
    h('div', { class: 'save-bar' }, tray.element, saveStatus, cancelButton, saveButton));

  tapFeedback(form);

  function sync() {
    const errors = validate(draft);
    setShown(otherNote, draft.behavior_codes.includes('other'));
    syncInputs(form, errors);
    tray.sync();
    const missing = Object.keys(errors).length;
    // Save never greys out; after an early tap it carries the count.
    saveCount.hidden = !needsShown() || missing === 0;
    saveCount.textContent = `${missing} needed`;
    if (missing === 0 && saveStatus.dataset.needs) {
      saveStatus.textContent = '';
      delete saveStatus.dataset.needs;
    }
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
    const result = await saveHandoff(store, draft);
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

// For list previews and the detail view.
export function behaviorSummary(record) {
  if (record.behavior_state === 'none_observed') return 'None observed';
  if (record.behavior_state === 'not_observed') return 'Not observed';
  return record.behavior_codes
    .map((code) => code === 'other' && record.behavior_other_note
      ? `Other (${record.behavior_other_note})`
      : labelFor(BEHAVIORS, code))
    .join(', ');
}
