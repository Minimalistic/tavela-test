import { h, icon } from '../dom.js';
import { buildCsvExport, exportCounts } from '../csv-export.js';
import { recordExport, lastExportedThrough } from '../export-log.js';
import { toOffsetIso } from '../time.js';
import { deliver } from './backup.js';

// Export CSV (docs/SPEC.md §12). Opened from Reports with Reports' window;
// moves behind the reviewer PIN with Reports in session 6.

const dayWords = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function renderExport(app, { from, to, site = null } = {}) {
  const title = h('h1', { class: 'form-title' }, icon('download', 30), 'Export CSV');
  if (!from || !to) {
    return h('section', { class: 'export' }, title,
      h('p', { class: 'save-status failed', role: 'status' }, 'Open Export from Reports, with dates chosen there.'));
  }
  const bathroomEvents = await app.store.getAll('bathroom_events');
  const handoffs = await app.store.getAll('handoffs');
  // The Tracker ID is the device's, demo mode or not; demo files say DEMO_.
  const datasetId = await app.realStore.getMeta('dataset_id');
  const log = (await app.store.getMeta('export_log')) ?? [];
  const through = lastExportedThrough(log);
  const window = { from, to, site };
  const counts = exportCounts({ bathroomEvents, handoffs, ...window });
  const placeWords = site ? `${app.settings.site_labels[site] ?? site} only` : 'all places';
  const back = h('button', { type: 'button', class: 'btn', onclick: () => app.show('reports') }, 'Back to Reports');

  const lead = [
    title,
    h('p', {}, 'Two spreadsheet files, one for Bathroom Check-Ins and one for Updates, that open in Excel, Numbers or Google Sheets. No passphrase is needed to read them, so handle them like any paper record.'),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Dates'), h('dd', {}, `${dayWords(from)} – ${dayWords(to)}, ${placeWords}`),
      h('dt', {}, 'Last export'), h('dd', {}, through ? `Exported through ${dayWords(through)}` : 'No exports yet')),
  ];

  if (counts.standing + counts.voided === 0) {
    return h('section', { class: 'export' }, lead,
      h('p', { class: 'report-empty', role: 'status' }, 'No entries in these dates, so there is nothing to export.'),
      h('div', { class: 'detail-actions' }, back));
  }

  const status = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite' });
  const fail = (message) => { status.className = 'save-status failed'; status.textContent = message; };
  const note = (message) => { status.className = 'save-status'; status.textContent = message; };

  const includeVoided = h('input', { type: 'checkbox', onchange: () => update() });
  const voidedChoice = counts.voided > 0
    ? h('label', { class: 'filter-check' }, includeVoided, `Include voided entries (${counts.voided})`)
    : null;
  const total = h('p', { class: 'export-total' });
  const saveButton = h('button', { type: 'button', class: 'btn primary big', onclick: save }, 'Save CSV Files');

  function selected() {
    return includeVoided.checked ? counts.standing + counts.voided : counts.standing;
  }
  function update() {
    const n = selected();
    total.textContent = n === 0
      ? 'No entries to export unless voided ones are included.'
      : `${plural(n, 'entry', 'entries')} will be exported.`;
    saveButton.hidden = n === 0;
    note('');
  }

  async function save() {
    const voided = includeVoided.checked;
    const built = buildCsvExport({
      bathroomEvents, handoffs, datasetId, siteLabels: app.settings.site_labels,
      ...window, includeVoided: voided, demo: app.demo,
    });
    const files = built.files.map((file) => new File([file.text], file.filename, { type: 'text/csv' }));
    saveButton.disabled = true;
    try {
      if (!(await deliver(files))) {
        note('Not saved. Tap Save CSV Files to try again.');
        return;
      }
    } catch (err) {
      console.error('Handstead: sharing the export failed:', err?.name ?? 'unknown error');
      fail('The files could not be shared. Tap Save CSV Files to try again.');
      return;
    } finally {
      saveButton.disabled = false;
    }
    try {
      await recordExport(app.store, {
        at: toOffsetIso(new Date()), kind: 'csv', from, to, site, entries: built.entries, voided,
      });
    } catch (err) {
      console.error('Handstead: recording the export failed:', err?.name ?? 'unknown error');
      fail('The files were saved, but the export wasn\'t added to the history.');
      return;
    }
    note(`✓ Saved ${built.files.map((file) => file.filename).join(' and ')}`);
  }

  update();
  return h('section', { class: 'export' }, lead,
    voidedChoice,
    total,
    // SPEC §12: shown before the share sheet opens, every time.
    h('p', { class: 'share-warning' }, 'Email and text messages may not be secure for health information. Follow your organization\'s sharing rules.'),
    h('div', { class: 'detail-actions' }, saveButton, back),
    status);
}
