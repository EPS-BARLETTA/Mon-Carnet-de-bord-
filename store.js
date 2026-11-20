'use strict';

// Stockage du carnet dans IndexedDB (bien plus de place que localStorage sur iPad).
// Les anciennes données en localStorage sont migrées automatiquement au premier lancement.
const CarnetStore = (() => {
  const DB_NAME = 'mon-carnet-eps-donnees';
  const DB_STORE = 'donnees';
  const LEGACY_CLASSES = 'mon-carnet-eps-v1';
  const LEGACY_HOME = 'mon-carnet-eps-accueil';
  const LEGACY_MODULES = 'mon-carnet-eps-modules';
  const WRITE_DELAY = 150;
  let backend = 'indexeddb';
  let pending = {};
  let timer = null;
  let writing = Promise.resolve();
  let onError = () => {};

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Base bloquée'));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function transaction(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(DB_STORE, mode);
        const result = operation(tx.objectStore(DB_STORE));
        tx.oncomplete = () => { db.close(); resolve(result && 'result' in result ? result.result : undefined); };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || Error('Transaction annulée')); };
      } catch (error) {
        db.close();
        reject(error);
      }
    });
  }

  function readAll() {
    return transaction('readonly', store => {
      const values = {};
      for (const key of ['classes', 'home', 'modules']) {
        const request = store.get(key);
        request.onsuccess = () => { values[key] = request.result; };
      }
      return {get result() { return values; }};
    });
  }

  function writeAll(values) {
    return transaction('readwrite', store => {
      for (const [key, value] of Object.entries(values)) {
        if (value === null) store.delete(key);
        else store.put(value, key);
      }
    });
  }

  function legacy() {
    try {
      return {classes: localStorage.getItem(LEGACY_CLASSES), home: localStorage.getItem(LEGACY_HOME)};
    } catch {
      return {classes: null, home: null};
    }
  }

  async function load() {
    try {
      if (!('indexedDB' in window)) throw Error('IndexedDB absent');
      let values = await readAll();
      if (values.classes === undefined) {
        const old = legacy();
        const migrated = {classes: old.classes ?? '[]', home: old.home ?? '{}'};
        await writeAll(migrated);
        const check = await readAll();
        if (check.classes !== migrated.classes || check.home !== migrated.home) throw Error('Migration non vérifiée');
        try {
          localStorage.removeItem(LEGACY_CLASSES);
          localStorage.removeItem(LEGACY_HOME);
        } catch {}
        values = check;
      }
      navigator.storage?.persist?.().catch(() => {});
      return {classes: values.classes ?? '[]', home: values.home ?? '{}', modules: values.modules ?? '{}'};
    } catch {
      // Navigateur sans IndexedDB utilisable : on garde l'ancien fonctionnement.
      backend = 'localstorage';
      const old = legacy();
      let modulesValue = '{}';
      try { modulesValue = localStorage.getItem(LEGACY_MODULES) ?? '{}'; } catch {}
      return {classes: old.classes ?? '[]', home: old.home ?? '{}', modules: modulesValue};
    }
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    const values = pending;
    pending = {};
    if (!Object.keys(values).length) return writing;
    const job = writing.then(async () => {
      if (backend === 'localstorage') {
        for (const [key, value] of Object.entries(values)) {
          localStorage.setItem(key === 'classes' ? LEGACY_CLASSES : key === 'home' ? LEGACY_HOME : LEGACY_MODULES, value);
        }
      } else {
        await writeAll(values);
      }
    }).catch(error => {
      onError(error);
      throw error;
    });
    writing = job.catch(() => {});
    return job;
  }

  function set(key, value, immediate = false) {
    pending[key] = value;
    if (immediate) return flush();
    if (!timer) timer = setTimeout(() => flush().catch(() => {}), WRITE_DELAY);
    return Promise.resolve();
  }

  async function wipe() {
    pending = {};
    clearTimeout(timer);
    await writing.catch(() => {});
    const remove = name => new Promise(resolve => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    await remove(DB_NAME);
    await remove('mon-tableau-blanc-documents');
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('mon-carnet-eps')) localStorage.removeItem(key);
      }
    } catch {}
  }

  async function usage() {
    try {
      const {usage: used, quota} = await navigator.storage.estimate();
      return {used, quota, persisted: await navigator.storage.persisted?.()};
    } catch {
      return null;
    }
  }

  const flushSoon = () => { if (Object.keys(pending).length) flush().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSoon(); });
  window.addEventListener('pagehide', flushSoon);

  return {
    load, set, flush, wipe, usage,
    get backend() { return backend; },
    set onError(handler) { onError = handler; },
  };
})();
