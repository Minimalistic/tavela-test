// IndexedDB wrapper. Every write resolves only on transaction complete with
// strict durability, which is what lets the UI say "Saved".

const DB_VERSION = 1;

// Named after the app (DECISIONS "Storage names"). Renaming it leaves every
// device's entries behind in the old database, so only before real use.
export function openDb(name = 'handstead') {
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
    request.onblocked = () => reject(new Error('Database upgrade blocked by another open Handstead window'));
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
    // Restore and migrations: every record and meta change in one transaction,
    // so a failure partway (a full disk, a bad record) leaves nothing changed.
    // replace clears both record stores first; other meta keys are kept.
    writeAll({ replace, bathroom_events: events, handoffs, meta }) {
      return run((conn) => {
        const tx = conn.transaction(['bathroom_events', 'handoffs', 'meta'], 'readwrite', { durability: 'strict' });
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
