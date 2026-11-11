import { h, ask, icon } from '../dom.js';
import { entryTitle, voidedNotice } from '../record-text.js';
import { ENTRY_TYPES, filterEntries, groupByDay, filterSummary, batchEnd } from '../entries.js';
import { matchRule } from '../matches.js';
import { siteLabel, siteOptions } from '../settings.js';
import { plural } from '../words.js';
import { formatTime, dayHeading } from '../time.js';
import { shortDate } from '../chart-draw.js';
import { isDevHost } from '../hosts.js';
import { DEMO_DAYS } from '../demo-data.js';
import { entryArea, entryIcon } from '../areas.js';
import { openEntry } from '../layout.js';
import { renderRecord } from './record.js';

const NO_FILTERS = { from: null, to: null, site: null, type: null, match: null, showVoided: false };

function preview(kind, label, text) {
  return h('span', { class: `record-note record-${kind}` },
    icon(kind), ' ', h('span', { class: 'record-note-tag' }, `${label}: `), text);
}

// `view` is where to land after making or clearing data.
export function devTools(app, total, view = 'records') {
  const status = h('p', { class: 'save-status', role: 'status' });
  const fail = (message) => (err) => {
    console.error(`Handstead: ${message}:`, err?.name ?? 'unknown error');
    status.className = 'save-status failed';
    status.textContent = message === 'demo failed' ? 'Demo data was not created.' : 'Nothing was cleared.';
  };
  const where = app.demo ? 'demo storage' : 'this browser\'s Handstead storage';
  // Folded to one line so it doesn't crowd the screen it sits on; open on an
  // empty device, where demo data is the first thing a tester wants.
  return h('details', { class: 'dev-tools', open: total === 0 },
    h('summary', {}, 'Test tools'),
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
          body: `This deletes all ${plural(total, 'entry', 'entries')} and the remembered settings in ${where}. It can't be undone.`,
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
      : 'Test builds only. Demo data is fictional and kept in its own storage, apart from real entries. "Clear all data" empties this browser\'s Handstead storage.'),
    status);
}

function filterBar(app, filters) {
  // Filters live on the app object (memory only), so they survive opening an
  // entry and coming back, and never reach the URL.
  const apply = (changes, event) => {
    app.recordFilters = { ...filters, ...changes };
    app.show('records', {}, { keepPlace: event.currentTarget.id });
  };
  const select = (id, label, options, value, key) => h('label', { class: 'filter', for: id }, label,
    h('select', { id, onchange: (event) => apply({ [key]: event.target.value || null }, event) },
      h('option', { value: '' }, 'All'),
      options.map((option) => h('option', { value: option.code, selected: option.code === value }, option.label))));
  const date = (id, label, value, key) => h('label', { class: 'filter', for: id }, label,
    h('input', { id, type: 'date', value: value ?? '', onchange: (event) => apply({ [key]: event.target.value || null }, event) }));

  const active = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const said = filterSummary(filters, {
    siteLabel: (code) => siteLabel(app.settings, code),
    typeLabel: (code) => ENTRY_TYPES.find((t) => t.code === code)?.label ?? code,
    shortDate,
  });
  // Folded to one line that says what's filtered, so the list starts near the
  // top of a phone screen; a tap opens the controls. Each change redraws
  // Records, so whether it's open is kept on the app (memory only).
  const fold = h('details', {
    class: 'filters-fold', open: app.recordFiltersOpen === true,
    ontoggle: (event) => { app.recordFiltersOpen = event.target.open; },
  },
    h('summary', { id: 'filters-summary' }, h('span', { class: 'filters-label' }, 'Filters'), ' ', h('span', { class: 'filters-said' }, said ?? 'None')),
    h('fieldset', { class: 'filters' },
    h('legend', { class: 'visually-hidden' }, 'Filter entries'),
    date('filter-from', 'From', filters.from, 'from'),
    date('filter-to', 'To', filters.to, 'to'),
    select('filter-site', 'Where', siteOptions(app.settings), filters.site, 'site'),
    select('filter-type', 'Type', ENTRY_TYPES, filters.type, 'type'),
    h('label', { class: 'filter filter-check' },
      h('input', { id: 'filter-voided', type: 'checkbox', checked: filters.showVoided, onchange: (event) => apply({ showVoided: event.target.checked }, event) }),
      ' Show voided'),
    active ? h('button', { type: 'button', class: 'btn small', onclick: (event) => apply(NO_FILTERS, event) }, 'Clear filters') : null));
  // A tapped Reports total narrows the list to what it counted. There's no
  // control for it in the filters, so it's said, and removable, in view.
  if (!filters.match) return fold;
  return [fold, h('p', { class: 'filter-match' },
    'Only ', h('strong', {}, matchRule(filters.match)?.label ?? filters.match), ' ',
    h('button', {
      type: 'button', class: 'btn small',
      onclick: () => {
        app.recordFilters = { ...filters, match: null };
        app.show('records', {}, { keepPlace: 'filters-summary' });
      },
    }, 'Show all kinds'))];
}

function recordRow(record, day, siteLabel, open) {
  return h('li', {},
    h('button', {
      type: 'button', class: `record-row area-${entryArea(record)}${record.voided_at ? ' voided' : ''}`,
      onclick: () => open(record),
    },
    // The day is in the heading above; said again, unseen, so a row heard on
    // its own still has its date.
    h('span', { class: 'record-when' }, h('span', { class: 'visually-hidden' }, `${day}, `), formatTime(record.occurred_at)),
    h('span', { class: 'record-what' },
      record.voided_at ? h('span', { class: 'voided-tag' }, 'Voided') : null,
      icon(entryIcon(record)), ' ', entryTitle(record)),
    h('span', { class: 'record-where' }, siteLabel(record.site_code)),
    record.positive_note ? preview('positive', 'Positive', record.positive_note) : null,
    record.notes ? preview('note', 'Note', record.notes) : null,
    record.handoff_note ? preview('note', 'Note', record.handoff_note) : null));
}

// selected/saved: an entry to show open (the record screen on a wide screen,
// after an edit or from Home). On a wide screen (app.isSplit) the list and
// the open entry sit side by side, like iPad Mail (ACCEPTANCE "Records side
// by side"): picking a row redraws only the right side, with no history step,
// so the list keeps its scroll and Back still leaves Records.
export async function renderRecords(app, { voided = null, selected = null, saved = false } = {}) {
  const all = [
    ...await app.store.getAll('bathroom_events'),
    ...await app.store.getAll('handoffs'),
  ];
  const filters = { ...NO_FILTERS, ...app.recordFilters };
  const shown = filterEntries(all, filters);
  const split = app.isSplit();

  // Opened afresh (Home, Reports, a filter change): the newest shows. Back
  // from an Edit form, or a turn of the iPad, keeps the one picked.
  if (selected) app.recordPicked = selected;
  else if (!app.navFromHistory || voided) app.recordPicked = null;
  const open = split ? (selected ?? openEntry(shown, app.recordPicked)) : null;

  const pane = split ? h('div', { class: 'records-pane', role: 'region', 'aria-label': 'Open entry' }) : null;
  const rows = new Map();
  function showOpen(record, { focus = false, justSaved = false } = {}) {
    for (const [id, button] of rows) button.setAttribute('aria-current', String(id === record?.id));
    pane.replaceChildren(record
      ? renderRecord(app, { record, saved: justSaved, embedded: true })
      : h('p', { class: 'empty' }, 'Pick an entry to see it here.'));
    if (focus) {
      const heading = pane.querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
  const pick = (record) => {
    if (!split) {
      app.show('record', { record });
      return;
    }
    app.recordPicked = record;
    showOpen(record, { focus: true });
  };

  const daySection = ({ day, records }) => {
    const heading = dayHeading(day);
    return h('section', { class: 'record-day', 'aria-label': heading },
      h('h2', { class: 'record-day-title' }, heading, h('span', {}, plural(records.length, 'entry', 'entries'))),
      h('ul', { class: 'record-list' }, records.map((record) => {
        const row = recordRow(record, heading, (code) => siteLabel(app.settings, code), pick);
        rows.set(record.id, row.querySelector('button'));
        return row;
      })));
  };

  // A screen's worth of days at a time (ACCEPTANCE "Show earlier"). How many
  // are shown is kept on the app while the filters stay the same, so opening
  // an entry and coming back keeps them; new filters start from the newest.
  const groups = groupByDay(shown);
  const filtersKey = JSON.stringify(filters);
  if (app.recordsShown?.filtersKey !== filtersKey) app.recordsShown = { filtersKey, days: 0 };
  let days = Math.min(groups.length, Math.max(app.recordsShown.days, batchEnd(groups)));
  app.recordsShown.days = days;
  const left = () => groups.slice(days).reduce((sum, group) => sum + group.records.length, 0);
  const more = h('button', {
    type: 'button', class: 'btn show-earlier',
    onclick: () => {
      const next = batchEnd(groups, days);
      const added = groups.slice(days, next).map(daySection);
      days = next;
      app.recordsShown.days = days;
      more.before(...added);
      // Focus the first day just shown; the page stays where it was.
      const heading = added[0].querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      syncMore();
    },
  });
  function syncMore() {
    more.hidden = days >= groups.length;
    more.textContent = `Show earlier · ${left()} more`;
  }
  syncMore();
  const list = shown.length === 0
    ? h('p', { class: 'empty' }, all.length === 0 ? 'No entries yet.' : 'No entries match these filters.')
    : [...groups.slice(0, days).map(daySection), more];
  if (split) showOpen(open, { justSaved: saved });

  return h('section', { class: split ? 'records split' : 'records' },
    h('h1', { class: 'form-title' }, icon('records', 30), 'Records'),
    // Transient: history steps drop it, so going back doesn't repeat it.
    voided ? h('p', { class: 'voided-notice', role: 'status' }, icon('void'), ' ', voidedNotice(voided)) : null,
    isDevHost(location.hostname) ? devTools(app, all.length) : null,
    filterBar(app, filters),
    h('p', { class: 'hint', role: 'status' }, `Showing ${shown.length} of ${plural(all.length, 'entry', 'entries')} ${app.demo ? 'in the demo data' : 'on this device'}, newest first.`),
    // List first, then the open entry: the order screen readers and the
    // keyboard follow.
    split ? h('div', { class: 'records-split' }, h('div', { class: 'records-list' }, list), pane) : list);
}
