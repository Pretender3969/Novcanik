// Mesečni izveštaj hrane: koliko je novca otišlo na namirnice i gde je završilo
// (skuvano po receptima, bačeno, ostalo: pojedeno bez recepta, još na polici ili nezabeleženo).
import { monthKey } from './totals.js';
import { unitPrice } from './kitchen.js';
import { monthsBack } from './analysis.js';

const r2 = (n) => Math.round(n * 100) / 100;

function valueOf(lines, date, purchases) {
  return lines.reduce((s, x) => s + (Number(x.qty) || 0) * (unitPrice(x.itemId, purchases, date) ?? 0), 0);
}

function totals(month, { purchases, items, categories, cooking, stockAdjust }) {
  const food = new Set(categories.filter((c) => c.trackStock).map((c) => c.id));
  const foodItems = new Set(items.filter((i) => food.has(i.categoryId)).map((i) => i.id));
  const bought = purchases
    .filter((p) => monthKey(p.date) === month && foodItems.has(p.itemId))
    .reduce((s, p) => s + (Number(p.total) || 0), 0);
  const cooks = cooking.filter((c) => monthKey(c.date) === month);
  const cooked = cooks.reduce((s, c) => s + valueOf(c.consumption ?? [], c.date, purchases), 0);
  const wasted = (stockAdjust ?? [])
    .filter((a) => a.reason === 'baceno' && monthKey(a.date) === month)
    .reduce((s, a) => s + valueOf([{ itemId: a.itemId, qty: a.delta }], a.date, purchases), 0);
  return { bought: r2(bought), cooked: r2(cooked), wasted: r2(wasted), cooks };
}

export function foodReport(month, data) {
  const { bought, cooked, wasted, cooks } = totals(month, data);
  const dishes = new Map();
  let servings = 0;
  for (const c of cooks) {
    const d = dishes.get(c.recipeName) ?? { name: c.recipeName, times: 0, servings: 0, cost: 0 };
    d.times++;
    d.servings += Number(c.servings) || 0;
    d.cost += valueOf(c.consumption ?? [], c.date, data.purchases);
    dishes.set(c.recipeName, d);
    servings += Number(c.servings) || 0;
  }
  return {
    bought,
    cooked,
    wasted,
    rest: r2(Math.max(0, bought - cooked - wasted)),
    cookedShare: bought ? r2(cooked / bought) : 0,
    servings,
    perServing: servings ? r2(cooked / servings) : 0,
    dishes: [...dishes.values()]
      .map((d) => ({ ...d, cost: r2(d.cost), perServing: d.servings ? r2(d.cost / d.servings) : 0 }))
      .sort((a, b) => b.times - a.times || b.cost - a.cost),
  };
}

export function foodTrend(month, n, data) {
  return monthsBack(month, n).map((m) => {
    const { bought, cooked, wasted } = totals(m, data);
    return { month: m, bought, cooked, wasted };
  });
}
