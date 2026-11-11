import { h, icon } from '../dom.js';
import { computeCounts, presetWindow, dayDiff } from '../counts.js';
import { summaries, kindTotals, windowParts, caveatText, glanceNumbers, emptyReportText } from '../charts.js';
import { siteLabel, siteOptions } from '../settings.js';
import { plural } from '../words.js';
import { isDevHost } from '../hosts.js';
import { devTools } from './records.js';
import { timelineCard, seeThem, chevron } from './timeline.js';
import { reportTitle } from '../csv-export.js';
import { recordExport } from '../export-log.js';
import { formatDateTime, toOffsetIso } from '../time.js';
import { annotationsInWindow } from '../annotations.js';
import { notesCard } from './notes.js';

const PRESETS = [7, 30, 90];
// A custom range past two years would draw tens of thousands of SVG nodes.
const MAX_DAYS = 731;
// SPEC §10: the trailing 30 complete days plus today, every place.
const DEFAULT_WINDOW = { preset: 30, from: null, to: null, site: null };

// The window, said once: a bar pinned to the top while Reports scroll, with
// the presets under it. The custom range and the place sit behind "Other dates
// or place", which stays open while custom dates are in use (each date redraws
// Reports). It sits outside the presets group, which reads as "Show the last".
function windowBar(app, state, range, parts) {
  const open = !parts || state.preset === null;
  // Kept on the app object (memory only), like the Records filters: it
  // survives a trip to Records and back, and never reaches the URL.
  const apply = (changes, event) => {
    app.reportWindow = { ...state, ...changes };
    app.show('reports', {}, { keepPlace: event.currentTarget.id });
  };
  const custom = (key) => (event) => apply({ preset: null, from: range.from, to: range.to, [key]: event.target.value || null }, event);
  const panel = h('fieldset', { class: 'filters report-change', id: 'report-change', hidden: !open },
    h('legend', { class: 'visually-hidden' }, 'Dates and place'),
    h('label', { class: 'filter', for: 'report-from' }, 'From',
      h('input', { id: 'report-from', type: 'date', value: range.from ?? '', onchange: custom('from') })),
    h('label', { class: 'filter', for: 'report-to' }, 'To',
      h('input', { id: 'report-to', type: 'date', value: range.to ?? '', onchange: custom('to') })),
    h('label', { class: 'filter', for: 'report-site' }, 'Where',
      h('select', { id: 'report-site', onchange: (event) => apply({ site: event.target.value || null }, event) },
        h('option', { value: '' }, 'All places'),
        siteOptions(app.settings).map((option) => h('option', { value: option.code, selected: option.code === state.site }, option.label)))));
  const change = h('button', {
    type: 'button', class: 'link report-more', 'aria-controls': 'report-change', 'aria-expanded': String(open),
    onclick: () => {
      panel.hidden = !panel.hidden;
      change.setAttribute('aria-expanded', String(!panel.hidden));
    },
  }, 'Other dates or place');
  // Only the window line is pinned, so on a phone it costs one or two lines;
  // the presets and the dates scroll away under it.
  const bar = h('p', { class: 'report-bar' },
    parts ? [h('strong', {}, parts.range), ' ', h('span', {}, parts.detail)] : h('strong', {}, 'Custom dates'));
  return [bar,
    h('div', { class: 'report-controls' },
      h('div', { class: 'presets', role: 'group', 'aria-label': 'Show the last' },
        PRESETS.map((days) => h('button', {
          type: 'button', id: `report-last-${days}`, class: `btn small${state.preset === days ? ' primary' : ' secondary'}`,
          'aria-pressed': String(state.preset === days),
          onclick: (event) => apply({ preset: days, from: null, to: null }, event),
        }, `${days} days`))),
      change,
      panel)];
}

// Printing (SPEC §12): the system print sheet prints or saves a PDF of the
// Reports on screen. These run around any print, the Print button's or the
// browser's own, while Reports is showing.
let printHooks = null;
addEventListener('beforeprint', () => printHooks?.before());
addEventListener('afterprint', () => printHooks?.after());

// What paper needs that the screen says elsewhere (SPEC §12's summary list):
// shown only in print.
function printHead({ trackerId, demo, range, place, n }) {
  const generated = h('dd', {});
  const fact = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
  const head = h('div', { class: 'print-head' },
    h('p', { class: 'print-title' }, 'Handstead report', demo ? ' · demo data, fictional' : ''),
    h('dl', { class: 'print-facts' },
      fact('Dates', range),
      fact('Place', place ?? 'All places'),
      fact('Tracker ID', trackerId ?? 'Not set'),
      fact('Entries', `${plural(n, 'entry', 'entries')}, voided ones left out`),
      h('dt', {}, 'Generated'), generated));
  head.stamp = () => { generated.textContent = formatDateTime(toOffsetIso(new Date())); };
  return head;
}

// Asked when the print sheet closes: the browser can't tell a print from a
// cancel, so only a yes goes into the export history (ACCEPTANCE "print").
function printAsk(app, entry) {
  const panel = h('div', { class: 'void-panel calm print-ask', hidden: true });
  // Focus moves here with the answer, so a keyboard keeps its place.
  const status = h('p', { class: 'save-status', role: 'status', 'aria-live': 'polite', tabindex: '-1' });
  // Drawn fresh for every print, so a second print on the same Reports asks
  // again; the buttons lock on the first tap, so a print is logged once.
  panel.show = () => {
    const question = h('h2', { tabindex: '-1' }, 'Did it print or save as a PDF?');
    const done = (text, failed = false) => {
      status.className = failed ? 'save-status failed' : 'save-status';
      status.textContent = text;
      panel.replaceChildren(status);
      status.focus();
    };
    const yes = h('button', {
      type: 'button', class: 'btn primary',
      onclick: async () => {
        yes.disabled = true;
        no.disabled = true;
        try {
          await recordExport(app.store, { at: toOffsetIso(new Date()), kind: 'print', ...entry });
          done('✓ Added to the export history.');
        } catch (err) {
          console.error('Handstead: recording the print failed:', err?.name ?? 'unknown error');
          done('The print is fine, but it wasn\'t added to the export history.', true);
        }
      },
    }, 'Yes, it printed');
    const no = h('button', { type: 'button', class: 'btn', onclick: () => done('Nothing was added to the export history.') }, 'No');
    panel.replaceChildren(question,
      h('p', { class: 'hint' }, 'A yes is added to the export history, like a CSV export.'),
      h('div', { class: 'ask-buttons start' }, yes, no));
    panel.hidden = false;
    question.focus();
  };
  return panel;
}

// A tapped total opens Records with only the entries it counted. Where
// Reports was is kept on the app (memory only), so Back lands there again.
function opener(app, state, range) {
  return (match, id) => {
    app.recordFilters = { from: range.from, to: range.to, site: state.site, type: null, match, showVoided: false };
    app.reportReturn = { id, y: window.scrollY };
    app.show('records');
  };
}

const linked = (item) => Boolean(item.match) && item.count > 0;

function glanceTiles(counts, open) {
  return h('div', { class: 'report-glance' }, glanceNumbers(counts).map((tile) => {
    const { area, value, label, match, count } = tile;
    if (!linked(tile)) return h('p', { class: `glance-tile area-${area}` }, h('strong', {}, value), h('span', {}, label));
    const id = `open-glance-${match}`;
    return h('button', { type: 'button', id, class: `glance-tile linked area-${area}`, onclick: () => open(match, id) },
      h('strong', {}, h('u', {}, value), chevron()), h('span', {}, label, seeThem(count)));
  }));
}

// "What kind": totals that aren't about time. Bristol types on the form's own
// 1–7 bar, each segment filled to its share; then short lists, each a label,
// a bar and a count. The bars are aria-hidden; the words and numbers carry it.
function kindsCard(counts, open) {
  const { bristol, groups } = kindTotals(counts);
  const most = Math.max(1, ...bristol.types.map((type) => type.count));
  // A linked total is the whole segment or row as one button.
  const item = (entry, className, parts) => {
    if (!linked(entry)) return h('li', {}, h('div', { class: className }, parts));
    const id = `open-kind-${entry.match.replace(':', '-')}`;
    return h('li', {}, h('button', { type: 'button', id, class: `${className} linked`, onclick: () => open(entry.match, id) },
      parts, seeThem(entry.count)));
  };
  const segment = (type) => {
    const { code, label, description, count } = type;
    const fill = h('i');
    fill.style.setProperty('--h', `${(count / most) * 100}%`);
    return item(type, `kind-seg${code === 'unable' ? ' unable' : ''}`, [
      h('span', { class: 'kind-seg-bar', 'aria-hidden': 'true' }, fill, h('span', {}, code === 'unable' ? 'Unable' : String(code))),
      h('span', { class: 'visually-hidden' }, description ? `${label}, ${description}: ` : `${label}: `),
      h('b', {}, linked(type) ? [h('u', {}, String(count)), chevron()] : String(count))]);
  };
  const row = (entry, max) => {
    const { label, area, count, of } = entry;
    const fill = h('i');
    fill.style.setProperty('--w', `${(count / max) * 100}%`);
    return item(entry, `kind-row area-${area}${count ? '' : ' zero'}`, [
      h('span', {}, label),
      h('span', { class: 'kind-bar', 'aria-hidden': 'true' }, fill),
      h('b', {}, of ? `${count} of ${of} days` : linked(entry) ? [h('u', {}, String(count)), chevron()] : String(count))]);
  };
  const note = (group) => (group.noteMatch && group.noteCount > 0
    ? h('button', {
      type: 'button', id: `open-kind-${group.noteMatch}`, class: 'link kind-note',
      onclick: () => open(group.noteMatch, `open-kind-${group.noteMatch}`),
    }, h('u', {}, group.note), chevron(), seeThem(group.noteCount))
    : h('span', {}, group.note));
  return h('div', { class: 'chart-card kinds-card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'chart-title' }, 'What kind'),
      h('p', { class: 'hint' }, 'Totals for these dates')),
    h('div', { class: 'kind area-bowel' },
      h('h3', {}, 'Bristol type', h('span', {}, plural(bristol.total, 'BM', 'BMs'))),
      h('ol', { class: 'kind-bristol' }, bristol.types.map(segment)),
      h('p', { class: 'kind-ends', 'aria-hidden': 'true' }, h('span', {}, 'Hard'), h('span', {}, 'Liquid'))),
    groups.map((group) => h('div', { class: 'kind' },
      // The note sits beside the heading, not in it: a linked one holds
      // hidden words, which iPhone VoiceOver can read as a stop of their own.
      h('div', { class: 'kind-head' }, h('h3', {}, group.title), note(group)),
      h('ul', { class: 'kind-rows' }, group.items.map((item) => row(item, group.max))))));
}

// Every sentence the charts used to carry, word for word, in one place that
// starts closed: for screen readers and anyone who wants the words.
function inWords(counts) {
  return h('details', { class: 'chart-card in-words' },
    h('summary', {}, h('h2', { class: 'chart-title' }, 'In words')),
    summaries(counts).flatMap((chart) => [
      h('h3', {}, chart.title),
      ...chart.summary.map((sentence) => h('p', { class: 'chart-summary' }, sentence)),
    ]));
}

export async function renderReports(app) {
  const records = [
    ...await app.store.getAll('bathroom_events'),
    ...await app.store.getAll('handoffs'),
  ];
  const state = { ...DEFAULT_WINDOW, ...app.reportWindow };
  // Set when a note changes: Reports redraws on the day that was picked.
  // Taken on every draw, so it never outlives the redraw it was set for.
  const startDay = app.reportPick ?? null;
  app.reportPick = null;
  if (!app.navFromHistory) app.reportReturn = null;
  printHooks = null;
  const range = state.preset ? presetWindow(state.preset) : { from: state.from, to: state.to };

  let counts = null;
  let problem = 'Choose both dates, with From on or before To.';
  try {
    if (range.from && range.to && dayDiff(range.from, range.to) >= MAX_DAYS) problem = 'Choose a range of two years or less.';
    else counts = computeCounts(records, { ...range, site: state.site });
  } catch (err) {
    // A blank or reversed custom range: say so, draw nothing.
    if (!(err instanceof RangeError)) throw err;
  }

  const placeName = state.site ? siteLabel(app.settings, state.site) : null;
  const header = [
    h('h1', { class: 'form-title' }, icon('reports', 30), 'Reports'),
    isDevHost(location.hostname) ? devTools(app, records.length, 'reports') : null,
    ...windowBar(app, state, range, counts && windowParts(counts.window, placeName, state.preset)),
  ];
  if (!counts) {
    return h('section', { class: 'reports' }, header,
      h('p', { class: 'save-status failed', role: 'status' }, problem));
  }

  // Notes pinned to dates have no place, so the place filter leaves them be.
  const notes = annotationsInWindow(await app.store.getAll('annotations'), range.from, range.to);
  const n = counts.entries.length;
  if (n === 0) {
    // No logging shortcut here: entries start from Home (Jason, 10-31). Notes
    // still show: one can be read, added or removed with no entries to mark.
    return h('section', { class: 'reports' }, header,
      h('p', { class: 'report-empty', role: 'status' }, emptyReportText(records.length)),
      notesCard(app, {
        notes, pickedDay: () => range.to, noTimeline: true,
        changed: (focusId) => app.show('reports', {}, { keepPlace: focusId }),
      }));
  }
  const open = opener(app, state, range);
  // The Tracker ID is the device's, demo mode or not, as on CSV exports.
  const trackerId = await app.realStore.getMeta('dataset_id');
  const head = printHead({ trackerId, demo: app.demo, range: windowParts(counts.window, placeName).range, place: placeName, n });
  const ask = printAsk(app, { from: range.from, to: range.to, site: state.site, entries: n });
  const timeline = timelineCard(counts, (day) => {
    app.recordFilters = { from: day, to: day, site: state.site, type: null, match: null, showVoided: false };
    app.show('records');
  }, open, { notes, startDay });
  // A saved or removed note redraws Reports where it was: the same picked
  // day, focus on the control named, and that control at the same height on
  // the screen (the picked day's boxes above it can gain or lose a note).
  const noteChanged = async (focusId) => {
    const top = () => document.getElementById(focusId)?.getBoundingClientRect().top;
    const was = top();
    app.reportPick = timeline.pickedDay();
    await app.show('reports', {}, { keepPlace: focusId });
    // Two frames: the timeline draws its rows once it's laid out, and until
    // then the page is too short to scroll that far.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const now = top();
      if (was !== undefined && now !== undefined) window.scrollBy(0, now - was);
    }));
  };
  const screenTitle = document.title;
  // Only while this drawing of Reports is the one on the page.
  printHooks = {
    before: () => {
      if (!timeline.isConnected) return;
      document.title = reportTitle({ datasetId: trackerId ?? 'TRK-UNSET', from: range.from, to: range.to, demo: app.demo });
      head.stamp();
      timeline.forPrint(true);
    },
    after: () => {
      if (!timeline.isConnected) return;
      document.title = screenTitle;
      timeline.forPrint(false);
    },
  };
  return h('section', { class: 'reports' }, head, header,
    h('p', { class: 'report-caveat' }, caveatText(counts)),
    glanceTiles(counts, open),
    h('div', { class: 'report-links' },
      h('button', { type: 'button', id: 'open-all', class: 'btn', onclick: () => open(null, 'open-all') },
        icon('records'), n === 1 ? ' See this record' : ` See these ${n} records`),
      // Only ever from this tap: nothing prints on its own (SPEC §12).
      h('button', { type: 'button', id: 'print-report', class: 'btn', onclick: () => printReport(ask) }, 'Print'),
      h('button', {
        type: 'button', class: 'btn',
        onclick: () => app.show('export', { from: range.from, to: range.to, site: state.site }),
      }, icon('download'), ' Export CSV')),
    ask,
    timeline,
    notesCard(app, { notes, pickedDay: () => timeline.pickedDay(), changed: noteChanged }),
    kindsCard(counts, open),
    inWords(counts));
}

function printReport(ask) {
  window.print();
  ask.show();
}
