// IndexedDB wrapper. Every write resolves only on transaction complete with
// strict durability, which is what lets the UI say "Saved".

const DB_VERSION = 1;

// The database keeps the app's first name (DECISIONS "Name"); renaming it
// would leave every device's entries behind.
export function openDb(name = 'tendwell') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Handoffs store exists now so session 2 needs no version bump.
      db.createObjectStore('bathroom_events', { keyPath: 'id' });
      db.createObjectStore('handoffs', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database upgrade blocked by another open Tavela window'));
  });
}

// Resolves once the database is gone. If another window still has it open,
// the browser finishes the delete when that window lets go; this doesn't wait.
export function deleteDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn(`Tavela: delete of ${name} is waiting for another window to close it`);
      resolve();
    };
  });
}

function finish(tx, result) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export function createStore(db) {
  return {
    put(storeName, value) {
      const tx = db.transaction(storeName, 'readwrite', { durability: 'strict' });
      tx.objectStore(storeName).put(value);
      return finish(tx);
    },
    get(storeName, key) {
      const tx = db.transaction(storeName, 'readonly');
      return finish(tx, tx.objectStore(storeName).get(key));
    },
    getAll(storeName) {
      const tx = db.transaction(storeName, 'readonly');
      return finish(tx, tx.objectStore(storeName).getAll());
    },
    // One transaction, so a clear either fully happens or not at all.
    clearAll() {
      const names = [...db.objectStoreNames];
      const tx = db.transaction(names, 'readwrite', { durability: 'strict' });
      for (const name of names) tx.objectStore(name).clear();
      return finish(tx);
    },
    // Restore and migrations: every record and meta change in one transaction,
    // so a failure partway (a full disk, a bad record) leaves nothing changed.
    // replace clears both record stores first; other meta keys are kept.
    writeAll({ replace, bathroom_events: events, handoffs, meta }) {
      const tx = db.transaction(['bathroom_events', 'handoffs', 'meta'], 'readwrite', { durability: 'strict' });
      const done = finish(tx);
      try {
        if (replace) {
          tx.objectStore('bathroom_events').clear();
          tx.objectStore('handoffs').clear();
        }
        for (const record of events) tx.objectStore('bathroom_events').put(record);
        for (const record of handoffs) tx.objectStore('handoffs').put(record);
        for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
      } catch (err) {
        // put() throws synchronously on a bad record; abort undoes the clear.
        tx.abort();
        done.catch(() => {});
        return Promise.reject(err);
      }
      return done;
    },
    async getMeta(key) {
      return (await this.get('meta', key))?.value ?? null;
    },
    setMeta(key, value) {
      return this.put('meta', { key, value });
    },
    close() {
      db.close();
    },
  };
}
