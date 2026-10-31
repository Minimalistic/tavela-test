import { h, ask, icon } from '../dom.js';
import { EVENTS, labelFor } from '../bathroom.js';
import { SUMMARY_TYPES } from '../handoff.js';
import { ENTRY_TYPES, filterEntries } from '../entries.js';
import { siteOptions } from '../settings.js';
import { formatDateTime } from '../time.js';
import { isDevHost } from '../dev-seed.js';
import { DEMO_DAYS } from '../demo-data.js';
import { entryArea, entryIcon } from '../areas.js';

const NO_FILTERS = { from: null, to: null, site: null, type: null, showVoided: false };

export function entryTitle(record) {
  return record.summary_type
    ? labelFor(SUMMARY_TYPES, record.summary_type)
    : labelFor(EVENTS, record.event_code);
}

function preview(kind, label, text) {
  return h('span', { class: `record-note record-${kind}` },
    icon(kind), ' ', h('span', { class: 'record-note-tag' }, `${label}: `), text);
}

// `view` is where to land after making or clearing data.
export function devTools(app, total, view = 'records') {
  const status = h('p', { class: 'save-status', role: 'status' });
  const fail = (message) => (err) => {
    console.error(`Tavela: ${message}:`, err?.name ?? 'unknown error');
    status.className = 'save-status failed';
    status.textContent = message === 'demo failed' ? 'Demo data was not created.' : 'Nothing was cleared.';
  };
  const where = app.demo ? 'demo storage' : 'this browser\'s Tavela storage';
  return h('div', { class: 'dev-tools' },
    h('div', { class: 'demo-days', role: 'group', 'aria-labelledby': 'demo-days-label' },
      h('span', { id: 'demo-days-label' }, app.demo ? 'Start over with demo data:' : 'Explore with demo data:'),
      DEMO_DAYS.map((days) => h('button', {
        type: 'button', class: 'btn small',
        onclick: () => {
          status.className = 'save-status';
          status.textContent = 'Making demo data…';
          app.startDemo(days, view).catch(fail('demo failed'));
        },
      }, `${days} days`))),
    h('button', {
      type: 'button', class: 'btn small danger',
      onclick: async () => {
        const choice = await ask({
          title: app.demo ? 'Clear the demo data?' : 'Clear all data on this device?',
          body: `This deletes all ${total} ${total === 1 ? 'entry' : 'entries'} and the remembered settings in ${where}. It can't be undone.`,
          buttons: [
            { label: 'Clear everything', value: 'clear', kind: 'danger' },
            { label: 'Cancel', value: 'cancel', kind: 'primary' },
          ],
        });
        if (choice !== 'clear') return;
        app.clearData().then(() => app.show(view), fail('clear failed'));
      },
    }, app.demo ? 'Clear demo data' : 'Clear all data'),
    h('p', { class: 'hint' }, app.demo
      ? 'Test builds only. Demo data is fictional and kept in its own storage, apart from real entries. "Leave demo" in the yellow banner deletes it.'
      : 'Test builds only. Demo data is fictional and kept in its own storage, apart from real entries. "Clear all data" empties this browser\'s Tavela storage.'),
    status);
}

function filterBar(app, filters) {
  // Filters live on the app object (memory only), so they survive opening an
  // entry and coming back, and never reach the URL.
  const apply = (changes) => {
    app.recordFilters = { ...filters, ...changes };
    app.show('records');
  };
  const select = (id, label, options, value, key) => h('label', { class: 'filter', for: id }, label,
    h('select', { id, onchange: (event) => apply({ [key]: event.target.value || null }) },
      h('option', { value: '' }, 'All'),
      options.map((option) => h('option', { value: option.code, selected: option.code === value }, option.label))));
  const date = (id, label, value, key) => h('label', { class: 'filter', for: id }, label,
    h('input', { id, type: 'date', value: value ?? '', onchange: (event) => apply({ [key]: event.target.value || null }) }));

  const active = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  return h('fieldset', { class: 'filters' },
    h('legend', { class: 'visually-hidden' }, 'Filter entries'),
    date('filter-from', 'From', filters.from, 'from'),
    date('filter-to', 'To', filters.to, 'to'),
    select('filter-site', 'Where', siteOptions(app.settings), filters.site, 'site'),
    select('filter-type', 'Type', ENTRY_TYPES, filters.type, 'type'),
    h('label', { class: 'filter filter-check' },
      h('input', { type: 'checkbox', checked: filters.showVoided, onchange: (event) => apply({ showVoided: event.target.checked }) }),
      ' Show voided'),
    active ? h('button', { type: 'button', class: 'btn small', onclick: () => apply(NO_FILTERS) }, 'Clear filters') : null);
}

export async function renderRecords(app) {
  const all = [
    ...await app.store.getAll('bathroom_events'),
    ...await app.store.getAll('handoffs'),
  ];
  const filters = { ...NO_FILTERS, ...app.recordFilters };
  const shown = filterEntries(all, filters);
  const siteLabel = (code) => app.settings.site_labels[code] ?? code;

  return h('section', { class: 'records' },
    h('h1', {}, 'Records'),
    isDevHost(location.hostname) ? devTools(app, all.length) : null,
    filterBar(app, filters),
    h('p', { class: 'hint', role: 'status' }, `Showing ${shown.length} of ${all.length} ${all.length === 1 ? 'entry' : 'entries'} ${app.demo ? 'in the demo data' : 'on this device'}, newest first.`),
    shown.length === 0
      ? h('p', { class: 'empty' }, all.length === 0 ? 'No entries yet.' : 'No entries match these filters.')
      : h('ul', { class: 'record-list' }, shown.map((record) =>
        h('li', {},
          h('button', {
            type: 'button', class: `record-row area-${entryArea(record)}${record.voided_at ? ' voided' : ''}`,
            onclick: () => app.show('record', { record }),
          },
          h('span', { class: 'record-when' }, formatDateTime(record.occurred_at)),
          h('span', { class: 'record-what' },
            record.voided_at ? h('span', { class: 'voided-tag' }, 'Voided') : null,
            icon(entryIcon(record)), ' ', entryTitle(record)),
          h('span', { class: 'record-where' }, siteLabel(record.site_code)),
          record.positive_note ? preview('positive', 'Positive', record.positive_note) : null,
          record.notes ? preview('note', 'Note', record.notes) : null,
          record.handoff_note ? preview('note', 'Note', record.handoff_note) : null)))));
}
