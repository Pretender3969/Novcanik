// Sloj podataka nad claude.ai `db`: kolekcije na vrhu baze, jedan snapshot po kolekciji.

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function createStore(db) {
  const channels = new Map(); // name → {rows, meta, listeners:Set, errorListeners:Set, unsub}

  function channel(name) {
    let ch = channels.get(name);
    if (ch) return ch;
    ch = { rows: null, meta: null, error: null, listeners: new Set(), errorListeners: new Set() };
    channels.set(name, ch);
    ch.unsub = db.collection(name).onSnapshot(
      (snap) => {
        ch.rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        ch.meta = snap.metadata;
        ch.listeners.forEach((fn) => fn(ch.rows, ch.meta));
      },
      (err) => {
        ch.error = err;
        ch.errorListeners.forEach((fn) => fn(err));
      },
    );
    return ch;
  }

  return {
    subscribe(name, cb, onError) {
      const ch = channel(name);
      ch.listeners.add(cb);
      if (onError) ch.errorListeners.add(onError);
      if (ch.rows) cb(ch.rows, ch.meta);
      if (ch.error && onError) onError(ch.error);
      return () => { ch.listeners.delete(cb); if (onError) ch.errorListeners.delete(onError); };
    },
    async add(name, row) {
      const id = newId();
      await db.collection(name).doc(id).set(row);
      return id;
    },
    async put(name, id, row) {
      await db.collection(name).doc(id).set(row);
    },
    async remove(name, id) {
      await db.collection(name).doc(id).delete();
    },
  };
}

export async function ensureMonthPayments(store, bills, payments, month) {
  const have = new Set(payments.filter((p) => p.month === month).map((p) => p.billId));
  let created = 0;
  for (const b of bills) {
    if (!b.active || have.has(b.id)) continue;
    await store.put('payments', `${month}_${b.id}`,
      { month, billId: b.id, name: b.name, amount: b.amount, paid: false, paidDate: null });
    created++;
  }
  return created;
}
