// Precaches the whole app shell so Handstead runs with no network at all.
// VERSION is APP_VERSION plus "+dev" here; tools/publish-test.sh stamps the
// commit into the published copy (0.6.0+d66fabc), so every published build
// gets a fresh cache with no hand-kept counter (DECISIONS "Versions").
//
// Real builds use the browser's default update lifecycle: a new version waits
// until every Handstead window is closed. Test builds on dev hosts take over at
// once on the page's 'skip-waiting' message (DECISIONS "Test builds update
// themselves"). The gated, backup-first update flow (SPEC §14) is still to come.
const VERSION = '0.10.0+c810b2f';
const CACHE = `handstead-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/main.js',
  './js/dom.js',
  './js/icons.js',
  './js/areas.js',
  './js/db.js',
  './js/time.js',
  './js/settings.js',
  './js/bathroom.js',
  './js/save.js',
  './js/handoff.js',
  './js/entries.js',
  './js/matches.js',
  './js/hosts.js',
  './js/updates.js',
  './js/demo-data.js',
  './js/demo.js',
  './js/counts.js',
  './js/charts.js',
  './js/day-detail.js',
  './js/chart-draw.js',
  './js/dataset.js',
  './js/draft.js',
  './js/backup.js',
  './js/migrations.js',
  './js/record-schema.js',
  './js/restore.js',
  './js/backup-log.js',
  './js/csv-export.js',
  './js/export-log.js',
  './js/annotations.js',
  './js/storage-risk.js',
  './js/text-size.js',
  './js/words.js',
  './js/layout.js',
  './js/nav.js',
  './js/views/home.js',
  './js/views/checkin.js',
  './js/views/records.js',
  './js/record-text.js',
  './js/tracker-phrase.js',
  './js/tracker-words.js',
  './js/views/reports.js',
  './js/views/day-tab.js',
  './js/views/drafts.js',
  './js/views/timeline.js',
  './js/views/fields.js',
  './js/views/feedback.js',
  './js/views/tray.js',
  './js/views/saved.js',
  './js/views/voided.js',
  './js/views/handoff.js',
  './js/views/record.js',
  './js/views/leave.js',
  './js/views/backup.js',
  './js/views/restore.js',
  './js/views/export.js',
  './js/views/notes.js',
  './icons/icon.svg',
  './icons/icon-mono.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache so a new version never precaches stale files.
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      // Also clears caches from before the storage rename (DECISIONS "Storage
      // names"), when they were called after the app's earlier names.
      if ((key.startsWith('handstead-') || key.startsWith('tavela-') || key.startsWith('tendwell-')) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Test builds only: main.js asks a waiting version to take over at once
// (applyTestUpdates). Real builds never send this, so a new version still
// waits, as SPEC §14 requires (never activated silently).
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// This Mac and the tailnet: fresh files first, so an edit shows on the next
// load without a new version; the cache still answers when offline. Not the
// public test build, which gets a stamped version per publish.
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname) || self.location.hostname.endsWith('.ts.net');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (DEV) {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        // Offline: fall through to the cache.
      }
    }
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('./index.html');
    return fetch(request);
  })());
});
