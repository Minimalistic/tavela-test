import { h, ask } from './dom.js';
import { openDb, createStore, deleteDb } from './db.js';
import { storageRiskLine } from './storage-risk.js';
import { tapFeedback, pressSettled } from './views/feedback.js';
import { entryFor, planNavigation } from './nav.js';
import { DEMO_DB, isDemoActive, startDemo, leaveDemo } from './demo.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { renderHome } from './views/home.js';
import { renderCheckin } from './views/checkin.js';
import { renderHandoff } from './views/handoff.js';
import { renderRecords } from './views/records.js';
import { renderRecord } from './views/record.js';
import { renderReports } from './views/reports.js';
import { renderBackup, renderCreateBackup } from './views/backup.js';
import { renderRestore } from './views/restore.js';
import { ensureDatasetId } from './dataset.js';
import { migrateLocalData } from './migrations.js';
import { BackupError } from './backup.js';
import { formatDateTime } from './time.js';
import { isDevHost } from './dev-seed.js';

// Bumped by every app.show; see the press wait there.
let showTicket = 0;

const VIEWS = {
  home: renderHome,
  checkin: renderCheckin,
  handoff: renderHandoff,
  records: renderRecords,
  reports: renderReports,
  record: renderRecord,
  backup: renderBackup,
  'backup-create': renderCreateBackup,
  restore: renderRestore,
};

const BACKUP_VIEWS = new Set(['backup', 'backup-create', 'restore']);

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
  reportWindow: null,
  refreshFooter: () => renderFooter(),
  // The dev-host "Clear all data". Clearing empties meta too, so the real
  // store gets back what boot gives it (schema version, a new Tracker ID);
  // without them the next backup fails its own check.
  async clearData() {
    await app.store.clearAll();
    if (!app.demo) {
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
  // (overtaken, switching, or reloading for an update).
  async show(name, params = {}, { fromHistory = false } = {}) {
    if (app.switching) return;
    // A second tap during the press wait replaces the first: only the
    // newest request goes on to draw a screen.
    const ticket = ++showTicket;
    await pressSettled();
    if (ticket !== showTicket) return;
    if (app.leaveGuard && !(await app.leaveGuard())) return 'stayed';
    app.leaveGuard = null;
    // A test build that updated while a form was open switches over now.
    if (reloadForUpdate()) return;
    // Demo data must never go into a backup or be restored over (SPEC §16).
    if (app.demo && BACKUP_VIEWS.has(name)) name = 'home';
    const main = document.getElementById('view');
    let view;
    try {
      view = await VIEWS[name](app, params);
    } catch (err) {
      // A screen that throws would otherwise leave the old one frozen with no
      // word of what happened. Saved data isn't touched by drawing a screen.
      console.error(`Tavela: could not open ${name}:`, err?.name ?? 'unknown error');
      view = h('section', {},
        h('p', { class: 'save-status failed', role: 'alert' },
          'This screen could not open. Your saved entries are not affected. Go back Home and try again; if it keeps happening, close the app fully and open it again.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.show('home') }, 'Home'));
    }
    main.replaceChildren(view);
    trackCovers();
    document.getElementById('home-link').hidden = name === 'home';
    window.scrollTo(0, 0);
    // preventScroll: focusing <main> would scroll it to the top edge, under
    // the header (and the demo banner), undoing the scrollTo above.
    main.focus({ preventScroll: true });
    if (!fromHistory) recordStep(name, params);
    return 'shown';
  },
};

// The app's own view of its history steps: stack[depth] is the current one.
// A step the app goes back to itself fires a popstate it must not redraw for.
const nav = { stack: [entryFor('home')], depth: 0, ignorePops: 0 };
const stateOf = (entry, depth) => ({ tavela: 1, depth, view: entry.view, params: entry.params });

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
  const params = {};
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

async function onHistoryStep(event) {
  if (nav.ignorePops > 0) {
    nav.ignorePops--;
    return;
  }
  const state = event.state?.tavela && VIEWS[event.state.view] ? event.state : stateOf(entryFor('home'), 0);
  const from = nav.depth;
  const params = await paramsFrom(state.params);
  const [view, shownParams] = params ? [state.view, params] : ['records', {}];
  const result = await app.show(view, shownParams, { fromHistory: true });
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
  const top = height(document.getElementById('demo-banner')) + height(document.querySelector('.report-bar'));
  const root = document.documentElement.style;
  root.setProperty('--cover-top', `${top}px`);
  root.setProperty('--cover-bottom', `${height(document.querySelector('.save-bar'))}px`);
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
    console.warn('Tavela: storage.persisted() failed:', err?.name ?? 'unknown error');
  }
  const line = storageRiskLine({ installed, persisted, demo: app.demo });
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
    console.warn('Tavela: storage.persist() failed:', err?.name ?? 'unknown error');
  }
}

async function boot() {
  // Shown before anything can fail, and never dismissible: it is what keeps
  // real people's details out of a public test build.
  document.getElementById('test-build').hidden = !isDevHost(location.hostname);
  tapFeedback(document);
  // Whatever step the page loads on becomes Home, the first step.
  history.replaceState(stateOf(nav.stack[0], 0), '');
  // Every screen scrolls itself to the top (app.show). Telling the browser so
  // stops Safari's swipe-back holding its snapshot while it waits to restore
  // a scroll position (Jason, 10-31: the screen took a long time to appear;
  // Tavela itself draws it in under 15ms).
  history.scrollRestoration = 'manual';
  window.addEventListener('popstate', onHistoryStep);
  document.getElementById('home-link').addEventListener('click', () => app.show('home'));
  document.getElementById('brand-home').addEventListener('click', () => app.show('home'));
  document.getElementById('leave-demo').addEventListener('click', () => app.leaveDemo().catch((err) => {
    console.error('Tavela: leaving demo failed:', err?.name ?? 'unknown error');
  }));
  try {
    app.realStore = createStore(await openDb(), () => openDb());
    app.store = app.realStore;
  } catch (err) {
    console.error('Tavela: could not open storage:', err?.name ?? 'unknown error');
    document.getElementById('view').replaceChildren(h('p', { class: 'save-status failed' },
      'Tavela could not open its storage on this device. Nothing can be saved right now. Close the app fully and open it again.'));
    return;
  }
  try {
    await migrateLocalData(app.realStore);
    await ensureDatasetId(app.realStore);
  } catch (err) {
    // Nothing was changed (one transaction). Stop rather than write over data
    // this version doesn't understand.
    console.error('Tavela: could not prepare stored data:', err?.name ?? 'unknown error');
    document.getElementById('view').replaceChildren(h('p', { class: 'save-status failed' },
      err instanceof BackupError && err.code === 'newer'
        ? 'The data on this device was saved by a newer version of Tavela. Nothing was changed. Update the app to keep using it.'
        : 'Tavela could not prepare its data on this device. Nothing was changed. Close the app fully and open it again.'));
    return;
  }
  try {
    if (await isDemoActive(app.realStore)) useDemo(await openDemoStore());
  } catch (err) {
    // Fall back to real data, with no banner, which is the truth.
    console.error('Tavela: could not open demo storage:', err?.name ?? 'unknown error');
  }
  await requestPersistence();
  await renderFooter();
  await app.show('home');

  showUpdatedNote();
  if ('serviceWorker' in navigator) {
    const hadVersion = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => { if (isDevHost(location.hostname)) applyTestUpdates(registration, hadVersion); })
      .catch((err) => console.error('Tavela: offline support failed to install:', err?.name ?? 'unknown error'));
  }
}

// Test builds (localhost, the tailnet, tavela-test.marsh.city) take a new version as soon as it's
// downloaded, so a phone doesn't need every Tavela window closed to see a
// change. Real builds keep the browser's default wait until the gated update
// flow (SPEC §14, session 5), which never activates a version silently.
let updateReady = false;
const UPDATED_KEY = 'tendwell-updated';

function applyTestUpdates(registration, hadVersion) {
  const promote = (worker) => worker.postMessage('skip-waiting');
  if (registration.waiting && hadVersion) promote(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) promote(worker);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The very first install also claims the page; that isn't an update.
    if (!hadVersion) return;
    updateReady = true;
    reloadForUpdate();
  });
  // A phone resuming a tab doesn't load anything, so look for a new version.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {});
  });
}

// Reloads into the new version unless that would lose something: a form
// still open (its leave guard is set) or a dialog up, such as the Saved card.
// Returns true when it reloads.
function reloadForUpdate() {
  if (!updateReady || app.leaveGuard || document.querySelector('dialog[open]')) return false;
  try { sessionStorage.setItem(UPDATED_KEY, '1'); } catch { /* the note is a nicety */ }
  location.reload();
  return true;
}

function showUpdatedNote() {
  let updated = false;
  try {
    updated = sessionStorage.getItem(UPDATED_KEY) === '1';
    sessionStorage.removeItem(UPDATED_KEY);
  } catch { /* no note without storage */ }
  if (!updated) return;
  const note = h('p', { class: 'toast update-note', role: 'status' }, 'Updated to the newest test build.');
  document.body.append(note);
  setTimeout(() => note.remove(), 4000);
}

boot();
