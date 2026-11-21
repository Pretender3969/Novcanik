// Kuhinja: sastojci → artikli, potrošnja pri kuvanju, cena jela i polica (procena zaliha).
import { matchItem } from './parser.js';

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const r2 = (n) => Math.round(n * 100) / 100;

function toBase(qty, unit, base) {
  if (!unit || unit === base) return qty;
  if (unit === 'g' && base === 'kg') return qty / 1000;
  if (unit === 'ml' && base === 'l') return qty / 1000;
  if (unit === 'kg' && base === 'g') return qty * 1000;
  return null;
}

export function resolveIngredient(ing, items) {
  const item = (ing.itemId && items.find((i) => i.id === ing.itemId)) || matchItem(ing.name ?? '', items);
  if (!item) return { itemId: null, baseQty: null, problem: 'artikal' };
  const qty = Number(ing.qty);
  if (ing.qty === null || ing.qty === undefined || ing.qty === '' || !(qty > 0)) {
    return { itemId: item.id, baseQty: null, problem: 'kolicina' };
  }
  const base = toBase(qty, ing.unit, item.unit);
  if (base === null) return { itemId: item.id, baseQty: null, problem: 'jedinica' };
  return { itemId: item.id, baseQty: r4(base), problem: null };
}

export function consumptionFor(recipe, servings, items) {
  const factor = Number(servings) / Math.max(Number(recipe.servings) || 0, 1);
  const out = new Map();
  for (const ing of recipe.ingredients ?? []) {
    const r = resolveIngredient(ing, items);
    if (r.problem) continue;
    out.set(r.itemId, (out.get(r.itemId) ?? 0) + r.baseQty * factor);
  }
  return [...out].map(([itemId, qty]) => ({ itemId, qty: r4(qty) }));
}

export function unitPrice(itemId, purchases, todayISO, days = 60) {
  const mine = purchases.filter((p) => p.itemId === itemId && Number(p.qty) > 0 && Number(p.total) > 0);
  if (!mine.length) return null;
  const from = new Date(todayISO);
  from.setDate(from.getDate() - days);
  const fromISO = from.toISOString().slice(0, 10);
  const recent = mine.filter((p) => p.date >= fromISO && p.date <= todayISO);
  if (recent.length) {
    const t = recent.reduce((s, p) => s + Number(p.total), 0);
    const q = recent.reduce((s, p) => s + Number(p.qty), 0);
    return r2(t / q);
  }
  const last = [...mine].sort((a, b) => a.date.localeCompare(b.date)).pop();
  return r2(Number(last.total) / Number(last.qty));
}

export function recipeCost(recipe, items, purchases, todayISO) {
  let total = 0;
  const missing = [];
  for (const ing of recipe.ingredients ?? []) {
    const r = resolveIngredient(ing, items);
    const price = r.problem ? null : unitPrice(r.itemId, purchases, todayISO);
    if (price === null) { missing.push(ing.name); continue; }
    total += r.baseQty * price;
  }
  const servings = Math.max(Number(recipe.servings) || 0, 1);
  return { total: r2(total), perServing: r2(total / servings), missing };
}

export function shelf(items, categories, purchases, cooking, adjusts, { from = '' } = {}) {
  const inWindow = (x) => !from || (x.date ?? '') >= from;
  purchases = purchases.filter(inWindow); cooking = cooking.filter(inWindow); adjusts = adjusts.filter(inWindow);
  const tracked = new Set(categories.filter((c) => c.trackStock).map((c) => c.id));
  const rows = new Map();
  for (const it of items) {
    if (tracked.has(it.categoryId)) rows.set(it.id, { itemId: it.id, name: it.name, unit: it.unit, bought: 0, used: 0, wasted: 0, counted: 0 });
  }
  const seen = new Set();
  for (const p of purchases) {
    const r = rows.get(p.itemId);
    if (r) { r.bought += Number(p.qty) || 0; seen.add(p.itemId); }
  }
  for (const c of cooking) for (const x of c.consumption ?? []) { const r = rows.get(x.itemId); if (r) r.used += Number(x.qty) || 0; }
  for (const a of adjusts) {
    const r = rows.get(a.itemId);
    if (!r) continue;
    if (a.reason === 'baceno') r.wasted += Number(a.delta) || 0; else r.counted += Number(a.delta) || 0;
  }
  return [...rows.values()].filter((r) => seen.has(r.itemId))
    .map(({ counted, ...r }) => {
      const raw = r.bought - r.used + counted - r.wasted;
      return { ...r, bought: r4(r.bought), used: r4(r.used), wasted: r4(r.wasted), left: r4(Math.max(0, raw)), check: raw < 0 };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'sr'));
}

/** Početak prozora police: 30 dana unazad od zadatog dana (YYYY-MM-DD). */
export function shelfFrom(todayISO, days = 30) {
  const d = new Date(todayISO);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
