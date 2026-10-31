import { h, icon } from '../dom.js';
import { computeCounts, presetWindow, dayDiff } from '../counts.js';
import { summaries, kindTotals, windowParts, caveatText, glanceNumbers } from '../charts.js';
import { siteOptions } from '../settings.js';
import { isDevHost } from '../dev-seed.js';
import { devTools } from './records.js';
import { timelineCard } from './timeline.js';

const PRESETS = [7, 30, 90];
// A custom range past two years would draw tens of thousands of SVG nodes.
const MAX_DAYS = 731;
// SPEC §10: the trailing 30 complete days plus today, every place.
const DEFAULT_WINDOW = { preset: 30, from: null, to: null, site: null };

// The window, said once: a bar pinned to the top while Reports scroll, with
// the presets under it. The custom range and the place sit behind "Change",
// which stays open while custom dates are in use (each date redraws Reports).
function windowBar(app, state, range, parts) {
  const open = !parts || state.preset === null;
  // Kept on the app object (memory only), like the Records filters: it
  // survives a trip to Records and back, and never reaches the URL.
  const apply = (changes) => {
    app.reportWindow = { ...state, ...changes };
    app.show('reports');
  };
  const custom = (key) => (event) => apply({ preset: null, from: range.from, to: range.to, [key]: event.target.value || null });
  const panel = h('fieldset', { class: 'filters report-change', id: 'report-change', hidden: !open },
    h('legend', { class: 'visually-hidden' }, 'Dates and place'),
    h('label', { class: 'filter', for: 'report-from' }, 'From',
      h('input', { id: 'report-from', type: 'date', value: range.from ?? '', onchange: custom('from') })),
    h('label', { class: 'filter', for: 'report-to' }, 'To',
      h('input', { id: 'report-to', type: 'date', value: range.to ?? '', onchange: custom('to') })),
    h('label', { class: 'filter', for: 'report-site' }, 'Where',
      h('select', { id: 'report-site', onchange: (event) => apply({ site: event.target.value || null }) },
        h('option', { value: '' }, 'All places'),
        siteOptions(app.settings).map((option) => h('option', { value: option.code, selected: option.code === state.site }, option.label)))));
  const change = h('button', {
    type: 'button', class: 'btn small secondary', 'aria-controls': 'report-change', 'aria-expanded': String(open),
    onclick: () => {
      panel.hidden = !panel.hidden;
      change.setAttribute('aria-expanded', String(!panel.hidden));
    },
  }, 'Change');
  // Only the window line is pinned, so on a phone it costs one or two lines;
  // the presets and the dates scroll away under it.
  const bar = h('p', { class: 'report-bar' },
    parts ? [h('strong', {}, parts.range), ' ', h('span', {}, parts.detail)] : h('strong', {}, 'Custom dates'));
  pinUnderBanner(bar);
  return [bar,
    h('div', { class: 'report-controls' },
      h('div', { class: 'presets', role: 'group', 'aria-label': 'Show the last' },
        PRESETS.map((days) => h('button', {
          type: 'button', class: `btn small${state.preset === days ? ' primary' : ' secondary'}`,
          'aria-pressed': String(state.preset === days),
          onclick: () => apply({ preset: days, from: null, to: null }),
        }, `${days} days`)),
        change),
      panel)];
}

// The demo banner is pinned to the top too; the bar sits just under it. One
// observer for the life of the app, pointed at whichever bar is current, so
// redrawing Reports never piles up observers holding old bars.
let pinnedBar = null;
let bannerObserver = null;
function placePinnedBar() {
  const banner = document.getElementById('demo-banner');
  pinnedBar?.style.setProperty('--pin-top', `${banner.hidden ? 0 : banner.offsetHeight}px`);
}
function pinUnderBanner(bar) {
  const banner = document.getElementById('demo-banner');
  if (!banner) return;
  pinnedBar = bar;
  placePinnedBar();
  if (!bannerObserver) {
    bannerObserver = new ResizeObserver(placePinnedBar);
    bannerObserver.observe(banner);
  }
}

function glanceTiles(counts) {
  return h('div', { class: 'report-glance' }, glanceNumbers(counts).map(({ area, value, label }) =>
    h('p', { class: `glance-tile area-${area}` }, h('strong', {}, value), h('span', {}, label))));
}

// "What kind": totals that aren't about time. Bristol types on the form's own
// 1–7 bar, each segment filled to its share; then short lists, each a label,
// a bar and a count. The bars are aria-hidden; the words and numbers carry it.
function kindsCard(counts) {
  const { bristol, groups } = kindTotals(counts);
  const most = Math.max(1, ...bristol.types.map((type) => type.count));
  const segment = ({ code, label, description, count }) => {
    const fill = h('i');
    fill.style.setProperty('--h', `${(count / most) * 100}%`);
    return h('li', { class: `kind-seg${code === 'unable' ? ' unable' : ''}` },
      h('span', { class: 'kind-seg-bar', 'aria-hidden': 'true' }, fill, h('span', {}, code === 'unable' ? 'Unable' : String(code))),
      h('span', { class: 'visually-hidden' }, description ? `${label}, ${description}: ` : `${label}: `),
      h('b', {}, String(count)));
  };
  const row = ({ label, area, count, of }, max) => {
    const fill = h('i');
    fill.style.setProperty('--w', `${(count / max) * 100}%`);
    return h('li', { class: `kind-row area-${area}${count ? '' : ' zero'}` },
      h('span', {}, label),
      h('span', { class: 'kind-bar', 'aria-hidden': 'true' }, fill),
      h('b', {}, of ? `${count} of ${of} days` : String(count)));
  };
  return h('section', { class: 'chart-card kinds-card', 'aria-labelledby': 'kinds-title' },
    h('div', { class: 'card-head' },
      h('h2', { id: 'kinds-title', class: 'chart-title' }, 'What kind'),
      h('p', { class: 'hint' }, 'Totals for these dates')),
    h('div', { class: 'kind area-bowel' },
      h('h3', {}, 'Bristol type', h('span', {}, plural(bristol.total, 'BM', 'BMs'))),
      h('ol', { class: 'kind-bristol' }, bristol.types.map(segment)),
      h('p', { class: 'kind-ends', 'aria-hidden': 'true' }, h('span', {}, 'Hard'), h('span', {}, 'Liquid'))),
    groups.map((group) => h('div', { class: 'kind' },
      h('h3', {}, group.title, h('span', {}, group.note)),
      h('ul', { class: 'kind-rows' }, group.items.map((item) => row(item, group.max))))));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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

  const siteLabel = state.site ? app.settings.site_labels[state.site] ?? state.site : null;
  const header = [
    h('h1', { class: 'form-title' }, icon('reports', 30), 'Reports'),
    isDevHost(location.hostname) ? devTools(app, records.length, 'reports') : null,
    ...windowBar(app, state, range, counts && windowParts(counts.window, siteLabel, state.preset)),
  ];
  if (!counts) {
    return h('section', { class: 'reports' }, header,
      h('p', { class: 'save-status failed', role: 'status' }, problem));
  }

  const n = counts.entries.length;
  return h('section', { class: 'reports' }, header,
    h('p', { class: 'report-caveat' }, caveatText(counts)),
    glanceTiles(counts),
    h('div', { class: 'report-links' },
      h('button', {
        type: 'button', class: 'btn',
        onclick: () => {
          app.recordFilters = { from: range.from, to: range.to, site: state.site, type: null, showVoided: false };
          app.show('records');
        },
      }, `See these ${n} ${n === 1 ? 'record' : 'records'}`),
      h('button', { type: 'button', class: 'btn secondary', onclick: () => app.show('records') }, icon('records'), ' Open Records')),
    timelineCard(counts, (day) => {
      app.recordFilters = { from: day, to: day, site: state.site, type: null, showVoided: false };
      app.show('records');
    }),
    kindsCard(counts),
    inWords(counts));
}
