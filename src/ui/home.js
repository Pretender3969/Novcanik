// Početna: saldo meseca, raspodela po kategorijama, poslednje stavke.
import { monthSummary, monthKey } from '../totals.js';
import { formatRSD } from '../format.js';
import { h, monthLabel, qtyLabel } from './dom.js';

export function renderHome(ctx) {
  const { state } = ctx;
  const items = ctx.items;
  const cats = ctx.categories;
  const s = monthSummary(state.month, { ...state.rows, items });
  const empty = !s.income && !s.purchases;

  const balance = h('section', { class: 'balance', 'aria-label': 'Saldo meseca' },
    h('p', { class: 'eyebrow' }, `Saldo · ${monthLabel(state.month)}`),
    h('p', { class: `big ${s.balance < 0 ? 'neg' : 'pos'}` }, formatRSD(s.balance), h('small', {}, ' RSD')),
    h('dl', { class: 'ledger' },
      h('dt', {}, 'Prihodi'), h('dd', {}, formatRSD(s.income)),
      h('dt', {}, 'Računi', s.unpaidCount ? h('span', { class: 'pill warn' }, `${s.unpaidCount} neplać.`) : null),
      h('dd', {}, `− ${formatRSD(s.bills)}`),
      h('dt', {}, 'Kupovina'), h('dd', {}, `− ${formatRSD(s.purchases)}`)));

  if (empty) {
    const months = [...new Set([
      ...state.rows.purchases.map((p) => monthKey(p.date)),
      ...state.rows.income.map((i) => monthKey(i.date)),
    ])].sort();
    const last = months.filter((m) => m < state.month).pop();
    return h('div', { class: 'stack' }, balance,
      h('div', { class: 'empty' },
        h('p', {}, `Za ${monthLabel(state.month)} još nema unosa. Upiši prvu kupovinu gore, npr. „hleb 80“.`),
        last && h('button', { type: 'button', class: 'link', onclick: () => ctx.setMonth(last) }, `Otvori ${monthLabel(last)} →`)));
  }

  const byCat = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  const max = byCat[0]?.[1] || 1;
  const catBlock = byCat.length > 0 && h('section', { class: 'panel' },
    h('h2', {}, 'Na šta ide kupovina'),
    h('ul', { class: 'bars' }, byCat.map(([id, v]) => {
      const c = cats[id];
      return h('li', { onclick: () => { ctx.setFilter(id); ctx.setTab('kupovina'); } },
        h('span', { class: 'bar-label' }, c?.name ?? 'Ostalo', c?.vice ? h('span', { class: 'pill vice' }, 'porok') : null),
        h('span', { class: 'bar-val' }, formatRSD(v)),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${(v / max) * 100}%`, background: c?.color ?? 'var(--muted)' } })));
    })));

  const recent = state.rows.purchases.filter((p) => monthKey(p.date) === state.month)
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 6);
  const recentBlock = recent.length > 0 && h('section', { class: 'panel' },
    h('h2', {}, 'Poslednje unete'),
    h('ul', { class: 'list' }, recent.map((p) => h('li', {},
      h('span', {}, p.name, h('small', {}, qtyLabel(p.qty, p.unit))),
      h('span', { class: 'num' }, formatRSD(p.total))))),
    h('button', { type: 'button', class: 'link', onclick: () => ctx.setTab('kupovina') }, 'Sve kupovine →'));

  return h('div', { class: 'stack' }, balance, catBlock, recentBlock);
}
