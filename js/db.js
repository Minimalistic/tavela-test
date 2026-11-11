// IndexedDB wrapper. Every write resolves only on transaction complete with
// strict durability, which is what lets the UI say "Saved".

// 2 added the annotations store (schema version 2, notes pinned to dates).
export const DB_VERSION = 2;
export const UPGRADE_BLOCKED = 'UpgradeBlockedError';
const STORES = [['bathroom_events', 'id'], ['handoffs', 'id'], ['annotations', 'id'], ['meta', 'key']];

// Named after the app (DECISIONS "Storage names"). Renaming it leaves every
// device's entries behind in the old database, so only before real use.
export function openDb(name = 'handstead') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    // A new database gets every store; an older one gets only what it lacks,
    // and its entries are not touched. The upgrade is one transaction: if it
    // fails, the database stays at its old version, as it was.
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [store, keyPath] of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Named so the start screen can say which window to close (main.js).
    request.onblocked = () => reject(Object.assign(new Error('Database upgrade blocked by another open Handstead window'), { name: UPGRADE_BLOCKED }));
  });
}

// Read-only mode (DECISIONS "Read-only"): the data on this device is newer
// than this code. Opens the database at whatever version it has: no version
// is asked for, so it is never upgraded or downgraded, and if there is none,
// none is made.
export const NEWER_LAYOUT = 'NewerLayoutError';

export function openDbAsIs(name = 'handstead') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    // Only fires when the database doesn't exist; aborting leaves it that way.
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => {
      const db = request.result;
      // A newer layout that moved the entries can't be read as "no entries":
      // better to say so and show nothing.
      const missing = ['bathroom_events', 'handoffs', 'meta'].filter((store) => ![...db.objectStoreNames].includes(store));
      if (missing.length === 0) return resolve(db);
      db.close();
      reject(Object.assign(new Error('Newer database has no ' + missing.join(', ')), { name: NEWER_LAYOUT }));
    };
    request.onerror = () => reject(request.error);
  });
}

export const READ_ONLY = 'ReadOnlyError';

// The store's reads, and nothing else: every write is refused here, so a
// screen that forgot to hide a button still can't change newer data. Only
// read-only transactions are ever opened. No reopen after a dropped
// connection; the next launch opens it again.
export function createReadOnlyStore(db) {
  const refuse = () => Promise.reject(Object.assign(new Error('Storage is read-only: its data is newer than this version'), { name: READ_ONLY }));
  // async, so a connection another window closed rejects like any other
  // failed read instead of throwing past the caller's catch.
  const read = async (storeName, query) => {
    const tx = db.transaction(storeName, 'readonly');
    return finish(tx, query(tx.objectStore(storeName)));
  };
  return {
    readOnly: true,
    get: (storeName, key) => read(storeName, (objects) => objects.get(key)),
    getAll: (storeName) => read(storeName, (objects) => objects.getAll()),
    async getMeta(key) {
      return (await this.get('meta', key))?.value ?? null;
    },
    put: refuse,
    setMeta: refuse,
    clearAll: refuse,
    deleteAnnotation: refuse,
    writeAll: refuse,
    close() {
      db.close();
    },
  };
}

// Resolves once the database is gone. If another window still has it open,
// the browser finishes the delete when that window lets go; this doesn't wait.
export function deleteDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn(`Handstead: delete of ${name} is waiting for another window to close it`);
      resolve();
    };
  });
}

function finish(tx, result) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result?.result);
    // A failed request's error event reaches the transaction before it
    // aborts, while tx.error is still null; the request holds the real one.
    tx.onerror = (event) => reject(event?.target?.error ?? tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

// Errors a dropped connection gives. WebKit can lose an IndexedDB connection
// while the device sleeps ("Connection to Indexed Database server lost"):
// transaction() then throws InvalidStateError, or the transaction aborts with
// UnknownError, and every later call fails the same way.
export const CONNECTION_LOST = new Set(['InvalidStateError', 'UnknownError']);

// reopen, when given, opens the same database again. After a dropped
// connection the store reopens once and runs the operation again. That is safe
// because a failed transaction changes nothing and puts are keyed by id, so a
// retry can't duplicate. The demo store gets no reopen: another window's
// "Leave demo" closes it on purpose, and reopening would bring it back.
export function createStore(firstDb, reopen = null) {
  let db = firstDb;
  let closed = false;
  let reopening = null;

  async function run(operation) {
    const failedOn = db;
    try {
      return await operation(db);
    } catch (err) {
      if (!reopen || closed || !CONNECTION_LOST.has(err?.name)) throw err;
      console.warn('Handstead: storage connection lost, reopening:', err.name);
      // Operations failing together share one reopen.
      if (db === failedOn) {
        reopening ??= reopen().then((fresh) => {
          try { failedOn.close(); } catch { /* already gone */ }
          db = fresh;
        }).finally(() => { reopening = null; });
        await reopening;
      }
      return operation(db);
    }
  }

  return {
    put(storeName, value) {
      return run((conn) => {
        const tx = conn.transaction(storeName, 'readwrite', { durability: 'strict' });
        tx.objectStore(storeName).put(value);
        return finish(tx);
      });
    },
    get(storeName, key) {
      return run((conn) => {
        const tx = conn.transaction(storeName, 'readonly');
        return finish(tx, tx.objectStore(storeName).get(key));
      });
    },
    getAll(storeName) {
      return run((conn) => {
        const tx = conn.transaction(storeName, 'readonly');
        return finish(tx, tx.objectStore(storeName).getAll());
      });
    },
    // One transaction, so a clear either fully happens or not at all.
    clearAll() {
      return run((conn) => {
        const names = [...conn.objectStoreNames];
        const tx = conn.transaction(names, 'readwrite', { durability: 'strict' });
        for (const name of names) tx.objectStore(name).clear();
        return finish(tx);
      });
    },
    // One note gone, for good. Notes only: entries and Updates are voided,
    // never deleted, so there is no general delete.
    deleteAnnotation(id) {
      return run((conn) => {
        const tx = conn.transaction('annotations', 'readwrite', { durability: 'strict' });
        tx.objectStore('annotations').delete(id);
        return finish(tx);
      });
    },
    // Restore and migrations: every record and meta change in one transaction,
    // so a failure partway (a full disk, a bad record) leaves nothing changed.
    // replace clears the entries, Updates and notes first; other meta keys
    // are kept.
    writeAll({ replace, bathroom_events: events, handoffs, annotations, meta }) {
      // A replace that forgot the notes would silently delete them.
      if (replace && !Array.isArray(annotations)) return Promise.reject(new Error('writeAll: replace needs annotations'));
      return run((conn) => {
        const tx = conn.transaction(['bathroom_events', 'handoffs', 'annotations', 'meta'], 'readwrite', { durability: 'strict' });
        const done = finish(tx);
        try {
          if (replace) {
            tx.objectStore('bathroom_events').clear();
            tx.objectStore('handoffs').clear();
            tx.objectStore('annotations').clear();
          }
          for (const record of events) tx.objectStore('bathroom_events').put(record);
          for (const record of handoffs) tx.objectStore('handoffs').put(record);
          for (const record of annotations ?? []) tx.objectStore('annotations').put(record);
          for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
        } catch (err) {
          // put() throws synchronously on a bad record; abort undoes the clear.
          tx.abort();
          done.catch(() => {});
          return Promise.reject(err);
        }
        return done;
      });
    },
    async getMeta(key) {
      return (await this.get('meta', key))?.value ?? null;
    },
    setMeta(key, value) {
      return this.put('meta', { key, value });
    },
    close() {
      closed = true;
      db.close();
    },
  };
}
