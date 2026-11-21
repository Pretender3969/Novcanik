// Analiza: trend, kandidati za izbacivanje, ušteda posle izbacivanja i sažetak za Claude.
import { monthKey } from './totals.js';
import { resolveIngredient, unitPrice } from './kitchen.js';
import { formatRSD } from './format.js';

const r2 = (n) => Math.round(n * 100) / 100;

export function monthsBack(month, n) {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${month}-${String(d.getDate()).padStart(2, '0')}`;
};

function catTotals(month, purchases, itemsById) {
  const out = new Map();
  for (const p of purchases) {
    if (monthKey(p.date) !== month) continue;
    const c = itemsById.get(p.itemId)?.categoryId ?? 'ostalo';
    out.set(c, (out.get(c) ?? 0) + (Number(p.total) || 0));
  }
  return out;
}

export function trend(month, n, { purchases, items, categories }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const vice = new Set(categories.filter((c) => c.vice).map((c) => c.id));
  return monthsBack(month, n).map((m) => {
    const t = catTotals(m, purchases, byId);
    let total = 0, v = 0;
    for (const [c, a] of t) { total += a; if (vice.has(c)) v += a; }
    return { month: m, total: r2(total), vice: r2(v) };
  });
}

export function itemSpend(month, purchases) {
  const out = new Map();
  for (const p of purchases) {
    if (monthKey(p.date) !== month || !p.itemId) continue;
    out.set(p.itemId, r2((out.get(p.itemId) ?? 0) + (Number(p.total) || 0)));
  }
  return out;
}

export function candidates(month, { purchases, items, categories, recipes, stockAdjust }) {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const open = (i) => (i?.status ?? 'normalno') === 'normalno';
  const inRecipes = new Set();
  for (const r of recipes) for (const ing of r.ingredients ?? []) {
    const id = resolveIngredient(ing, items).itemId;
    if (id) inRecipes.add(id);
  }
  const out = [];
  for (const [id, amount] of itemSpend(month, purchases)) {
    const item = byId.get(id);
    if (!item || !open(item)) continue;
    const cat = cats.get(item.categoryId);
    if (cat?.vice && amount >= 500) {
      out.push({ kind: 'porok', id, name: item.name, amount, detail: `${cat.name}, ovog meseca` });
    } else if (cat?.trackStock && amount >= 1000 && !inRecipes.has(id)) {
      out.push({ kind: 'bez-recepta', id, name: item.name, amount, detail: 'ne ulazi ni u jedan recept' });
    }
  }
  const end = lastDay(month);
  const from = new Date(end); from.setDate(from.getDate() - 60);
  const fromISO = from.toISOString().slice(0, 10);
  const wasted = new Map();
  for (const a of stockAdjust ?? []) {
    if (a.reason !== 'baceno' || a.date < fromISO || a.date > end) continue;
    wasted.set(a.itemId, (wasted.get(a.itemId) ?? 0) + (Number(a.delta) || 0));
  }
  for (const [id, qty] of wasted) {
    const item = byId.get(id);
    if (!item || !open(item) || out.some((c) => c.id === id)) continue;
    const price = unitPrice(id, purchases, end) ?? 0;
    out.push({ kind: 'baca-se', id, name: item.name, amount: r2(qty * price), detail: `bačeno ${String(r2(qty)).replace('.', ',')} ${item.unit} za 60 dana` });
  }
  const [m2, m1, m0] = monthsBack(month, 3).map((m) => catTotals(m, purchases, byId));
  for (const [c, a0] of m0) {
    const a1 = m1.get(c) ?? 0, a2 = m2.get(c) ?? 0;
    if (c === 'ostalo' || !(a2 > 0 && a1 > a2 && a0 > a1)) continue;
    out.push({ kind: 'raste', id: c, name: cats.get(c)?.name ?? c, amount: r2(a0), detail: `raste 3 meseca: ${formatRSD(a2)} → ${formatRSD(a1)} → ${formatRSD(a0)}` });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export function savings(item, purchases, todayISO) {
  const since = item.statusSince;
  if (!since) return { avgBefore: 0, spentSince: 0, saved: 0 };
  const before = monthsBack(monthKey(since), 4).slice(0, 3);
  const mine = purchases.filter((p) => p.itemId === item.id);
  const avgBefore = r2(before.reduce((s, m) => s + mine.filter((p) => monthKey(p.date) === m).reduce((t, p) => t + (Number(p.total) || 0), 0), 0) / 3);
  const spentSince = r2(mine.filter((p) => p.date >= since && p.date <= todayISO).reduce((s, p) => s + (Number(p.total) || 0), 0));
  const days = Math.max(0, Math.round((new Date(todayISO) - new Date(since)) / 86400000));
  return { avgBefore, spentSince, saved: r2(Math.max(0, avgBefore * days / 30 - spentSince)) };
}

export function summaryForClaude(month, data) {
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const t = catTotals(month, data.purchases, byId);
  const total = [...t.values()].reduce((s, a) => s + a, 0);
  const vice = [...t].filter(([c]) => cats.get(c)?.vice).reduce((s, [, a]) => s + a, 0);
  return {
    mesec: month,
    ukupno: r2(total),
    udeoPoroka: total ? r2(vice / total) : 0,
    poKategorijama: [...t].sort((a, b) => b[1] - a[1]).map(([c, a]) => ({ kategorija: cats.get(c)?.name ?? 'Ostalo', iznos: r2(a) })),
    artikli: [...itemSpend(month, data.purchases)].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([id, a]) => ({ artikal: byId.get(id)?.name ?? id, iznos: a, status: byId.get(id)?.status ?? 'normalno' })),
    kandidati: candidates(month, data).map((c) => ({ tip: c.kind, naziv: c.name, iznos: c.amount, razlog: c.detail })),
  };
}
