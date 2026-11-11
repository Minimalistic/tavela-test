// Service worker registration and test-build updates. The gated, backup-first
// update flow (SPEC §14) will live here too.
import { h } from './dom.js';
import { APP_VERSION } from './backup.js';
import { isDevHost } from './hosts.js';

// Registers the service worker, and shows "Updated to …" after a test build
// reloaded into a new version.
export function startUpdates(app) {
  showUpdatedNote();
  if ('serviceWorker' in navigator) {
    const hadVersion = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => { if (isDevHost(location.hostname)) applyTestUpdates(app, registration, hadVersion); })
      .catch((err) => console.error('Handstead: offline support failed to install:', err?.name ?? 'unknown error'));
  }
}

// Test builds (localhost, the tailnet, tavela-test.marsh.city) take a new version as soon as it's
// downloaded, so a phone doesn't need every Handstead window closed to see a
// change. Real builds keep the browser's default wait until the gated update
// flow (SPEC §14, still to come), which never activates a version silently.
let updateReady = false;
const UPDATED_KEY = 'handstead-updated';

function applyTestUpdates(app, registration, hadVersion) {
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
    reloadForUpdate(app);
  });
  // A phone resuming a tab doesn't load anything, so look for a new version.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {});
  });
}

// Reloads into the new version unless that would lose something: a form
// still open (its leave guard is set) or a dialog up, such as the Saved card.
// Returns true when it reloads.
export function reloadForUpdate(app) {
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
  const note = h('p', { class: 'toast update-note', role: 'status' }, `Updated to Handstead ${APP_VERSION}.`);
  document.body.append(note);
  setTimeout(() => note.remove(), 4000);
}
