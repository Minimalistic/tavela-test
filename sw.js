// Precaches the whole app shell so Tavela runs with no network at all.
// Bump VERSION whenever any file in SHELL changes; the cache name follows it.
//
// Milestone 1 uses the browser's default update lifecycle: a new version waits
// until every Tavela window is closed. The gated, backup-first update flow
// (SPEC §14) replaces this in session 5.
const VERSION = '0.5.0-v91';
// Cache, database and storage names keep the app's first name, "tendwell"
// (DECISIONS "Name"): renaming them would orphan data already on devices.
const CACHE = `tendwell-${VERSION}`;

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
  './js/dev-seed.js',
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
  './js/storage-risk.js',
  './js/text-size.js',
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
  './js/views/handoff.js',
  './js/views/record.js',
  './js/views/leave.js',
  './js/views/backup.js',
  './js/views/restore.js',
  './js/views/export.js',
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
      if (key.startsWith('tendwell-') && key !== CACHE) await caches.delete(key);
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('./index.html');
    return fetch(request);
  })());
});
