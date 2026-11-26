// Plan obroka: nedelja, spisak za kupovinu (potrebno − polica) i tekst spiska.
import { consumptionFor, resolveIngredient, unitPrice } from './kitchen.js';

const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);

export function weekStart(dateISO) {
  const d = utc(dateISO);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

export function weekDays(startISO) {
  const d = utc(startISO);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return iso(x);
  });
}

function roundUp(qty, unit) {
  if (qty <= 0) return 0;
  if (unit === 'kom') return Math.ceil(qty - 1e-9);
  const step = qty < 1 ? 20 : 10; // ispod 1 kg/l na 50 g/ml, iznad na 100 g/ml
  return Math.round(Math.ceil(qty * step - 1e-9)) / step;
}

export function shoppingList(entries, { recipes, items, shelfRows, purchases }, todayISO) {
  const byRecipe = new Map(recipes.map((r) => [r.id, r]));
  const byItem = new Map(items.map((i) => [i.id, i]));
  const left = new Map(shelfRows.map((s) => [s.itemId, s.left]));
  const need = new Map();
  const missing = [];
  const seen = new Set();
  for (const e of entries) {
    if (e.done) continue;
    const r = byRecipe.get(e.recipeId);
    if (!r) {
      const k = `${e.recipeId}|-`;
      if (!seen.has(k)) { seen.add(k); missing.push({ recipe: e.recipeName || e.recipeId, ingredient: '(recept ne postoji)', problem: 'recept' }); }
      continue;
    }
    for (const c of consumptionFor(r, e.servings, items)) need.set(c.itemId, (need.get(c.itemId) ?? 0) + c.qty);
    for (const ing of r.ingredients ?? []) {
      const p = resolveIngredient(ing, items).problem;
      const k = `${r.id}|${ing.name}`;
      if (p && !seen.has(k)) { seen.add(k); missing.push({ recipe: r.name, ingredient: ing.name, problem: p }); }
    }
  }
  let total = 0;
  let unpriced = 0;
  const lines = [...need].map(([itemId, q]) => {
    const item = byItem.get(itemId);
    const have = r4(left.get(itemId) ?? 0);
    const needQ = r4(q);
    const buy = roundUp(r4(needQ - have), item.unit);
    const price = buy > 0 ? unitPrice(itemId, purchases, todayISO) : null;
    const cost = buy === 0 ? 0 : price === null ? null : r2(buy * price);
    if (cost === null) unpriced++; else total += cost;
    return { itemId, name: item.name, unit: item.unit, need: needQ, have, buy, cost };
  });
  return { lines, total: r2(total), unpriced, missing };
}

export function formatQty(qty, unit) {
  if (unit === 'kg' && qty < 1) return `${Math.round(qty * 1000)} g`;
  if (unit === 'l' && qty < 1) return `${Math.round(qty * 1000)} ml`;
  return `${String(r2(qty)).replace('.', ',')} ${unit}`;
}

export function listText(list) {
  const rows = list.lines.filter((l) => l.buy > 0).map((l) => `- ${l.name}: ${formatQty(l.buy, l.unit)}`);
  return ['Spisak za kupovinu:', ...rows, `Procena: ${Math.round(list.total)} RSD`].join('\n');
}
