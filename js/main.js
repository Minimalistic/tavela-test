import { h, ask } from './dom.js';
import { openDb, createStore, deleteDb } from './db.js';
import { storageRiskLine, storageRiskBanner } from './storage-risk.js';
import { tapFeedback, pressSettled } from './views/feedback.js';
import { entryFor, planNavigation, windowParams } from './nav.js';
import { WIDE_QUERY, splitRecords } from './layout.js';
import { DEMO_DB, isDemoActive, startDemo, leaveDemo, refreshStaleDemo, clearDemo } from './demo.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { renderHome } from './views/home.js';
import { renderCheckin } from './views/checkin.js';
import { renderHandoff } from './views/handoff.js';
import { renderRecords } from './views/records.js';
import { renderRecord } from './views/record.js';
import { renderReports } from './views/reports.js';
import { renderBackup, renderCreateBackup } from './views/backup.js';
import { renderRestore } from './views/restore.js';
import { renderExport } from './views/export.js';
import { checkBeforeForm } from './views/drafts.js';
import { followSystemTextSize } from './text-size.js';
import { ensureDatasetId } from './dataset.js';
import { migrateLocalData } from './migrations.js';
import { BackupError, APP_VERSION } from './backup.js';
import { formatDateTime } from './time.js';
import { isDevHost } from './hosts.js';
import { startUpdates, reloadForUpdate } from './updates.js';

// Bumped by every app.show; see the press wait there.
let showTicket = 0;

const VIEWS = {
  home: renderHome,
  checkin: renderCheckin,
  handoff: renderHandoff,
  records: renderRecords,
  reports: renderReports,
  // On a wide screen an entry opens on the right of Records instead of on
  // its own screen (ACCEPTANCE "Records side by side").
  record: (app, params) => (app.isSplit() ? renderRecords(app, { selected: params.record, saved: params.saved }) : renderRecord(app, params)),
  backup: renderBackup,
  'backup-create': renderCreateBackup,
  restore: renderRestore,
  export: renderExport,
};

const BACKUP_VIEWS = new Set(['backup', 'backup-create', 'restore']);
const FORM_VIEWS = new Set(['checkin', 'handoff']);

// Navigation is in-memory, not URL-based: no record ids or data ever land in
// the address bar (SPEC §3). Each screen is also a browser history step
// (nav.js), so Safari's back and forward work; the URL never changes.
const app = {
  // store is what every view reads and writes: the demo database while demo
  // mode is on, the real one otherwise. realStore is always the real one.
  store: null,
  realStore: null,
  demo: false,
  settings: DEFAULT_SETTINGS,
  leaveGuard: null,
  recordFilters: null,
  // The entry open on the right of Records on a wide screen (memory only).
  recordPicked: null,
  // The screen showing now, and whether it was drawn for a history step.
  current: null,
  navFromHistory: false,
  isSplit: () => splitRecords({
    wide: window.matchMedia?.(WIDE_QUERY).matches,
    bigText: document.documentElement.classList.contains('big-text'),
  }),
  reportWindow: null,
  // { id, y }: the Reports total tapped and where the page was, for Back.
  reportReturn: null,
  // The day picked on Reports' timeline, kept across a note's save or removal.
  reportPick: null,
  refreshFooter: () => renderFooter(),
  // The dev-host "Clear all data". Clearing empties meta too, so the real
  // store gets back what boot gives it (schema version, a new Tracker ID);
  // without them the next backup fails its own check.
  async clearData() {
    if (app.demo) {
      await clearDemo(app.store);
    } else {
      await app.store.clearAll();
      await migrateLocalData(app.realStore);
      await ensureDatasetId(app.realStore);
    }
    await renderFooter();
  },
  // True while the app moves between real and demo storage. Navigation waits,
  // so no form can open holding the store that is about to be swapped out.
  switching: false,
  async startDemo(days, view = 'records') {
    if (app.switching) return;
    app.switching = true;
    try {
      const demoStore = app.demo ? app.store : await openDemoStore();
      try {
        await startDemo({ realStore: app.realStore, demoStore, days });
      } catch (err) {
        if (!app.demo) demoStore.close();
        throw err;
      }
      useDemo(demoStore);
    } finally {
      app.switching = false;
    }
    await renderFooter();
    await app.show(view);
  },
  async leaveDemo() {
    if (app.switching) return;
    const guard = app.leaveGuard;
    if (guard && !(await guard())) return;
    const choice = await ask({
      title: 'Leave demo mode?',
      body: 'The demo entries, and anything added while in demo mode, will be deleted. Real entries on this device are not touched.',
      buttons: [
        { label: 'Leave demo', value: 'leave', kind: 'danger' },
        { label: 'Stay in demo', value: 'stay', kind: 'primary' },
      ],
    });
    // Staying keeps the open form's unsaved-changes check.
    if (choice !== 'leave') return;
    app.leaveGuard = null;
    app.switching = true;
    const demoStore = app.store;
    try {
      await leaveDemo({
        realStore: app.realStore,
        // Back on real data before the delete, so a failed delete can't
        // leave the app pointed at a closed demo database.
        dropDemo: async () => {
          useReal();
          demoStore.close();
          await deleteDb(DEMO_DB);
        },
      });
    } finally {
      app.switching = false;
      await renderFooter();
      await app.show('home');
    }
  },
  // Returns 'shown', 'stayed' (the leave check kept a form open) or nothing
  // (overtaken, switching, or reloading for an update). keepPlace is a
  // control's id: a filter redrawing its own screen keeps the scroll and puts
  // focus back on that control instead of the heading, so a keyboard or
  // VoiceOver user picking From then To isn't sent to the top between them.
  async show(name, params = {}, { fromHistory = false, keepPlace = null } = {}) {
    if (app.switching) return;
    // A second tap during the press wait replaces the first: only the
    // newest request goes on to draw a screen.
    const ticket = ++showTicket;
    await pressSettled();
    if (ticket !== showTicket) return;
    if (app.leaveGuard && !(await app.leaveGuard())) return 'stayed';
    app.leaveGuard = null;
    // A test build that updated while a form was open switches over now.
    if (reloadForUpdate(app)) return;
    // Demo data must never go into a backup or be restored over (SPEC §16).
    if (app.demo && BACKUP_VIEWS.has(name)) name = 'home';
    // An unsaved entry kept on the device is never replaced without a choice.
    if (FORM_VIEWS.has(name) && !params.resume) {
      const gate = await checkBeforeForm(app, () => ticket === showTicket);
      if (ticket !== showTicket) return;
      if (gate.resume) ({ name, params } = gate.resume);
      else if (!gate.go) return;
    }
    const main = document.getElementById('view');
    app.navFromHistory = fromHistory;
    let view;
    try {
      view = await VIEWS[name](app, params);
    } catch (err) {
      // A screen that throws would otherwise leave the old one frozen with no
      // word of what happened. Saved data isn't touched by drawing a screen.
      console.error(`Handstead: could not open ${name}:`, err?.name ?? 'unknown error');
      view = h('section', {},
        h('p', { class: 'save-status failed', role: 'alert' },
          'This screen could not open. Your saved entries are not affected. Go back Home and try again; if it keeps happening, close the app fully and open it again.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.show('home') }, 'Home'));
    }
    main.replaceChildren(view);
    app.current = { name, params };
    trackCovers();
    document.getElementById('home-link').hidden = name === 'home';
    // A control the redraw hid or removed (a closed panel, Clear filters)
    // can't take focus; then it's the usual top and heading.
    document.getElementById(keepPlace ?? '')?.focus({ preventScroll: true });
    if (keepPlace && document.activeElement?.id === keepPlace) {
      if (!fromHistory) recordStep(name, params);
      return 'shown';
    }
    window.scrollTo(0, 0);
    // Focus the screen's heading so VoiceOver says which screen this is; an
    // unnamed <main> is read as just "main". preventScroll: focusing would
    // scroll it to the top edge, under the header (and the demo banner),
    // undoing the scrollTo above.
    const heading = view.querySelector('h1');
    if (heading) heading.tabIndex = -1;
    (heading ?? main).focus({ preventScroll: true });
    if (!fromHistory) recordStep(name, params);
    return 'shown';
  },
};

// The app's own view of its history steps: stack[depth] is the current one.
// A step the app goes back to itself fires a popstate it must not redraw for.
const nav = { stack: [entryFor('home')], depth: 0, ignorePops: 0 };
const stateOf = (entry, depth) => ({ handstead: 1, depth, view: entry.view, params: entry.params });

function recordStep(name, params) {
  const target = entryFor(name, params);
  const plan = planNavigation(nav.stack, nav.depth, target);
  if (plan.stay) return;
  if (plan.go) {
    nav.ignorePops++;
    nav.depth += plan.go;
    nav.stack.length = nav.depth + 1;
    history.go(plan.go);
    return;
  }
  nav.depth++;
  nav.stack[nav.depth] = target;
  nav.stack.length = nav.depth + 1;
  history.pushState(stateOf(target, nav.depth), '');
}

const RECORD_STORES = new Set(['bathroom_events', 'handoffs']);

// A history step back into params a screen can draw. Null when its entry is
// gone (voided entries stay; cleared or demo data can go).
async function paramsFrom(kept = {}) {
  const params = { ...windowParams(kept) };
  if (kept.type) params.type = kept.type;
  if (kept.verifyOnly) params.verifyOnly = true;
  if (kept.pickDate) params.pickDate = true;
  if (kept.recordId) {
    if (!RECORD_STORES.has(kept.recordStore)) return null;
    const record = await app.store.get(kept.recordStore, kept.recordId).catch(() => null);
    if (!record) return null;
    params.record = record;
  }
  return params;
}

// Turning an iPad redraws Records for the new width, without a history step.
// Going narrow with an entry picked shows that entry on its own screen, so
// the reader keeps their place (ACCEPTANCE "Records side by side").
async function relayoutRecords() {
  const current = app.current;
  if (!current || (current.name !== 'records' && current.name !== 'record')) return;
  if (!app.isSplit() && current.name === 'records' && app.recordPicked) {
    await app.show('record', { record: app.recordPicked });
    return;
  }
  // Records' one-off notice (an entry voided) isn't said again.
  await app.show(current.name, current.name === 'records' ? {} : current.params, { fromHistory: true });
}

async function onHistoryStep(event) {
  if (nav.ignorePops > 0) {
    nav.ignorePops--;
    return;
  }
  const state = event.state?.handstead && VIEWS[event.state.view] ? event.state : stateOf(entryFor('home'), 0);
  const from = nav.depth;
  const params = await paramsFrom(state.params);
  const [view, shownParams] = params ? [state.view, params] : ['records', {}];
  // Back to Reports after a tapped total: the same spot, focus on that total.
  const back = view === 'reports' ? app.reportReturn : null;
  const result = await app.show(view, shownParams, { fromHistory: true, keepPlace: back?.id ?? null });
  if (back && result === 'shown') {
    // Two frames: the timeline draws its rows once it's laid out, and until
    // then the page is too short to scroll that far.
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, back.y)));
  }
  if (result === 'stayed') {
    // The form stays open, so put history back where the form is.
    nav.ignorePops++;
    history.go(from - state.depth);
    return;
  }
  // The browser has moved to this step whether or not it was drawn (a newer
  // tap or swipe can overtake it), so the app's count always follows it.
  nav.depth = state.depth;
  nav.stack[nav.depth] = entryFor(view, shownParams);
  nav.stack.length = nav.depth + 1;
  if (result === 'shown' && !params) history.replaceState(stateOf(nav.stack[nav.depth], nav.depth), '');
}

// Sticky bars (the demo banner, Reports' pinned line, a form's Save bar) sit
// over the page. Their heights feed scroll-padding, so a field scrolled or
// tabbed into view lands clear of them (WCAG 2.4.11). Measured, because each
// wraps differently by screen width and the Save bar grows as it fills.
const coverObserver = new ResizeObserver(() => updateCovers());

function updateCovers() {
  const height = (el) => (el && !el.hidden ? el.offsetHeight : 0);
  const banner = height(document.getElementById('demo-banner'));
  const top = banner + height(document.querySelector('.report-bar'));
  const root = document.documentElement.style;
  // Reports' window line pins just under the demo banner.
  root.setProperty('--pin-top', `${banner}px`);
  root.setProperty('--cover-top', `${top}px`);
  const bar = document.querySelector('.save-bar');
  if (bar) bar.classList.toggle('save-bar-inline', bar.offsetHeight > window.innerHeight / 4);
  root.setProperty('--cover-bottom', `${bar && !bar.classList.contains('save-bar-inline') ? height(bar) : 0}px`);
}

function trackCovers() {
  coverObserver.disconnect();
  for (const el of [document.getElementById('demo-banner'), document.querySelector('.report-bar'), document.querySelector('.save-bar')]) {
    if (el) coverObserver.observe(el);
  }
  updateCovers();
}

async function openDemoStore() {
  const db = await openDb(DEMO_DB);
  // Lets another window's "Leave demo" delete it instead of waiting on us.
  db.onversionchange = () => db.close();
  return createStore(db);
}

function useDemo(demoStore) {
  app.store = demoStore;
  app.demo = true;
  document.getElementById('demo-banner').hidden = false;
}

function useReal() {
  app.store = app.realStore;
  app.demo = false;
  document.getElementById('demo-banner').hidden = true;
}

// Read fresh each time: adding to the Home Screen opens a new window, but a
// grant can arrive later in the same one.
async function renderStorageRisk() {
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  let persisted = null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch (err) {
    console.warn('Handstead: storage.persisted() failed:', err?.name ?? 'unknown error');
  }
  const state = { installed, persisted, demo: app.demo };
  const line = storageRiskLine(state);
  app.storageBanner = storageRiskBanner(state, { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
  const el = document.getElementById('storage-risk');
  el.textContent = line ?? '';
  el.hidden = !line;
}

async function renderFooter() {
  await renderStorageRisk();
  if (app.demo) {
    document.getElementById('status-line').textContent = 'Demo data · kept apart from the real entries on this device';
    return;
  }
  const lastBackup = await app.store.getMeta('last_backup_at');
  document.getElementById('status-line').textContent =
    `Stored on this device · Last backup: ${lastBackup ? formatDateTime(lastBackup) : 'Never'}`;
}

async function requestPersistence() {
  // A grant lowers eviction risk; it is never a guarantee (SPEC §3).
  if (!navigator.storage?.persist) return;
  try {
    const granted = await navigator.storage.persist();
    await app.realStore.setMeta('storage_persist_granted', granted);
  } catch (err) {
    console.warn('Handstead: storage.persist() failed:', err?.name ?? 'unknown error');
  }
}

async function boot() {
  followSystemTextSize();
  // So a tester can say which version they're on (DECISIONS "Versions").
  document.getElementById('app-version').textContent = `Handstead ${APP_VERSION}`;
  // Turning the device changes how much of the screen the Save bar covers.
  window.addEventListener('resize', updateCovers);
  // Shown before anything can fail, and never dismissible: it is what keeps
  // real people's details out of a public test build.
  document.getElementById('test-build').hidden = !isDevHost(location.hostname);
  tapFeedback(document);
  // Whatever step the page loads on becomes Home, the first step.
  history.replaceState(stateOf(nav.stack[0], 0), '');
  // Every screen scrolls itself to the top (app.show). Telling the browser so
  // stops Safari's swipe-back holding its snapshot while it waits to restore
  // a scroll position (Jason, 10-31: the screen took a long time to appear;
  // Handstead itself draws it in under 15ms).
  history.scrollRestoration = 'manual';
  window.addEventListener('popstate', onHistoryStep);
  window.matchMedia?.(WIDE_QUERY).addEventListener?.('change', relayoutRecords);
  document.getElementById('home-link').addEventListener('click', () => app.show('home'));
  document.getElementById('brand-home').addEventListener('click', () => app.show('home'));
  document.getElementById('leave-demo').addEventListener('click', () => app.leaveDemo().catch((err) => {
    console.error('Handstead: leaving demo failed:', err?.name ?? 'unknown error');
  }));
  try {
    app.realStore = createStore(await openDb(), () => openDb());
    app.store = app.realStore;
  } catch (err) {
    console.error('Handstead: could not open storage:', err?.name ?? 'unknown error');
    document.getElementById('view').replaceChildren(h('p', { class: 'save-status failed' },
      'Handstead could not open its storage on this device. Nothing can be saved right now. Close the app fully and open it again.'));
    return;
  }
  try {
    await migrateLocalData(app.realStore);
    await ensureDatasetId(app.realStore);
  } catch (err) {
    // Nothing was changed (one transaction). Stop rather than write over data
    // this version doesn't understand.
    console.error('Handstead: could not prepare stored data:', err?.name ?? 'unknown error');
    document.getElementById('view').replaceChildren(h('p', { class: 'save-status failed' },
      err instanceof BackupError && err.code === 'newer'
        ? 'The data on this device was saved by a newer version of Handstead. Nothing was changed. Update the app to keep using it.'
        : 'Handstead could not prepare its data on this device. Nothing was changed. Close the app fully and open it again.'));
    return;
  }
  try {
    if (await isDemoActive(app.realStore)) {
      const demoStore = await openDemoStore();
      // A demo database from before a schema change is made again, not shown.
      await refreshStaleDemo({ realStore: app.realStore, demoStore });
      useDemo(demoStore);
    }
  } catch (err) {
    // Fall back to real data, with no banner, which is the truth.
    console.error('Handstead: could not open demo storage:', err?.name ?? 'unknown error');
  }
  await requestPersistence();
  await renderFooter();
  await app.show('home');

  startUpdates(app);
}

boot();
