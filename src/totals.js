// Mesečni zbirovi: uvek se računaju iz stavki, nikad se ne čuvaju.

export function monthKey(date) {
  if (typeof date === 'string') return date.slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const round2 = (n) => Math.round(n * 100) / 100;

export function monthSummary(month, d) {
  const purchases = (d.purchases ?? []).filter((p) => monthKey(p.date) === month);
  const payments = (d.payments ?? []).filter((p) => p.month === month);
  const income = (d.income ?? []).filter((i) => monthKey(i.date) === month);

  const byCategory = {};
  for (const p of purchases) {
    const cat = d.items?.[p.itemId]?.categoryId ?? 'ostalo';
    byCategory[cat] = round2((byCategory[cat] ?? 0) + Number(p.total || 0));
  }
  const sum = (arr, f) => round2(arr.reduce((s, x) => s + Number(f(x) || 0), 0));
  const unpaid = payments.filter((p) => !p.paid);
  const s = {
    income: sum(income, (i) => i.amount),
    bills: sum(payments, (p) => p.amount),
    billsUnpaid: sum(unpaid, (p) => p.amount),
    unpaidCount: unpaid.length,
    purchases: sum(purchases, (p) => p.total),
    byCategory,
  };
  s.balance = round2(s.income - s.bills - s.purchases);
  return s;
}
