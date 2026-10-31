import { h, icon } from '../dom.js';
import { entryArea, entryIcon } from '../areas.js';
import {
  EVENTS, PAIN, URINE_CHANGE, URINE_DETAILS, BRISTOL, BM_AMOUNT, ATTEMPT_TARGET,
  BOWEL_CARE_STATUS, CONCERNS, labelFor,
} from '../bathroom.js';
import { QUESTIONS, TEXT_LABELS } from '../handoff.js';
import { saveVoid } from '../save.js';
import { formatDateTime, formatTime } from '../time.js';
import { entryTitle } from './records.js';
import { behaviorSummary } from './handoff.js';

function bathroomRows(record, name) {
  return [
    ['What happened', labelFor(EVENTS, record.event_code)],
    ['Tried to', record.attempt_target && labelFor(ATTEMPT_TARGET, record.attempt_target)],
    [`${name} said "ow" or showed discomfort`, record.pain_code && labelFor(PAIN, record.pain_code)],
    ['Change in urine', record.urine_change_code && labelFor(URINE_CHANGE, record.urine_change_code)],
    ['What changed', record.urine_change_details.map((c) => labelFor(URINE_DETAILS, c)).join(', ')],
    ['About the change', record.urine_change_note],
    ['Bristol type', record.bristol_type !== null && labelFor(BRISTOL, record.bristol_type)],
    ['BM amount', record.bm_amount && labelFor(BM_AMOUNT, record.bm_amount)],
    ['Flush-care status', record.bowel_care_status && labelFor(BOWEL_CARE_STATUS, record.bowel_care_status)],
    ['Concern reported', record.concern_codes.map((c) => labelFor(CONCERNS, c)).join(', ')],
    ['Notable', record.notes],
  ];
}

function handoffRows(record, name) {
  return [
    ...QUESTIONS[record.summary_type].map((question) => [
      question.legend(name),
      question.field === 'behaviors' ? behaviorSummary(record) : labelFor(question.options, record[question.field]),
    ]),
    [TEXT_LABELS[record.summary_type].handoff_note, record.handoff_note],
  ];
}

export function renderRecord(app, { record, saved = false }) {
  const name = app.settings.display_name;
  const handoff = Boolean(record.summary_type);
  const rows = [
    ['When', formatDateTime(record.occurred_at)],
    ['Where', app.settings.site_labels[record.site_code] ?? record.site_code],
    ...(handoff ? handoffRows(record, name) : bathroomRows(record, name)),
    ['Initials', record.initials],
    ['Entered', formatDateTime(record.created_at)],
    ['Last changed', record.updated_at !== record.created_at && formatDateTime(record.updated_at)],
  ].filter(([, value]) => value);

  const status = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  const editView = handoff ? 'handoff' : 'checkin';

  const reasonInput = h('textarea', { id: 'void-reason', rows: 2, maxlength: 200, autocomplete: 'off' });
  const voidPanel = h('div', { class: 'void-panel', hidden: true, role: 'group', 'aria-labelledby': 'void-title' },
    h('h2', { id: 'void-title' }, 'Void this entry?'),
    h('p', {}, 'It will be left out of the list and of counts, but kept on this device and in backups. You can still see it with "Show voided".'),
    h('label', { for: 'void-reason' }, 'Reason (optional)'),
    reasonInput,
    h('div', { class: 'ask-buttons' },
      h('button', { type: 'button', class: 'btn danger', onclick: confirmVoid }, icon('void'), ' Void entry'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { voidPanel.hidden = true; actions.hidden = false; } }, 'Cancel')));

  async function confirmVoid(event) {
    event.target.disabled = true;
    const result = await saveVoid(app.store, record, reasonInput.value);
    event.target.disabled = false;
    if (result.ok) {
      app.show('records');
      return;
    }
    status.className = 'save-status failed';
    status.textContent = result.message;
  }

  const actions = h('div', { class: 'detail-actions' },
    record.voided_at ? null : h('button', { type: 'button', class: 'btn primary', onclick: () => app.show(editView, { record }) }, icon('edit'), ' Edit'),
    record.voided_at ? null : h('button', {
      type: 'button', class: 'btn danger',
      onclick: () => { actions.hidden = true; voidPanel.hidden = false; reasonInput.focus(); },
    }, icon('void'), ' Void'),
    h('button', { type: 'button', class: 'btn', onclick: () => app.show('records') }, 'Back to records'));

  return h('section', { class: 'record-detail' },
    saved ? h('p', { class: 'saved-inline', role: 'status' }, `✓ Changes saved ${app.demo ? 'to the demo data' : 'on this device'} · ${formatTime(record.updated_at)}`) : null,
    h('h1', { class: `form-title area-${entryArea(record)}` }, icon(entryIcon(record), 30), handoff ? entryTitle(record) : 'Bathroom Check-In'),
    record.voided_at
      ? h('p', { class: 'voided-banner' },
        h('strong', {}, 'Voided '), formatDateTime(record.voided_at),
        record.void_reason ? ` · Reason: ${record.void_reason}` : '')
      : null,
    handoff && record.positive_note
      ? h('div', { class: 'positive-box' },
        h('p', { class: 'positive-title' }, icon('positive'), ' ', TEXT_LABELS[record.summary_type].positive_note),
        h('p', {}, record.positive_note))
      : null,
    h('dl', {}, rows.flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)])),
    status,
    actions,
    voidPanel);
}
