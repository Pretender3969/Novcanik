// Skladište na uređaju (localStorage), isti interfejs kao createStore nad claude.ai bazom.
// Svaki dokument nosi _u (vreme izmene); brisanje ostavlja {_del:true}, da se prenese pri sinhronizaciji.

const KEY = (name) => `kt:${name}`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clean = ({ id, _u, _del, ...rest }) => rest;

export function createLocalStore(storage, { now = () => Date.now(), onChange = () => {} } = {}) {
  const cache = new Map();
  const listeners = new Map();

  function raw(name) {
    if (!cache.has(name)) {
      let data = {};
      try { data = JSON.parse(storage.getItem(KEY(name)) || '{}'); } catch {}
      cache.set(name, data);
    }
    return cache.get(name);
  }
  const rows = (name) => Object.entries(raw(name)).filter(([, d]) => !d._del).map(([id, d]) => ({ id, ...clean(d) }));
  function notify(name) {
    const r = rows(name);
    (listeners.get(name) ?? new Set()).forEach((fn) => fn(r, { fromCache: false }));
  }
  function save(name, data) {
    cache.set(name, data);
    storage.setItem(KEY(name), JSON.stringify(data));
  }
  function write(name, id, doc) {
    save(name, { ...raw(name), [id]: { ...doc, _u: now() } });
    notify(name);
    onChange(name);
  }

  return {
    subscribe(name, cb) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(cb);
      queueMicrotask(() => cb(rows(name), { fromCache: false }));
      return () => listeners.get(name).delete(cb);
    },
    async add(name, row) { const id = newId(); write(name, id, clean(row)); return id; },
    async put(name, id, row) { write(name, id, clean(row)); },
    async remove(name, id) { write(name, id, { _del: true }); },
    raw,
    replaceRaw(name, data) { save(name, data); notify(name); },
    exportAll(names) { return Object.fromEntries(names.map((n) => [n, raw(n)])); },
  };
}
