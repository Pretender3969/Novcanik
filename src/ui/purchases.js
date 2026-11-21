// Kupovina: stavke meseca po danima, filter po kategoriji, izmena i brisanje.
import { monthKey } from '../totals.js';
import { formatRSD } from '../format.js';
import { h, dayLabel, qtyLabel } from './dom.js';

let openId = null;
let confirmDelete = null;

export function renderPurchases(ctx) {
  const { state } = ctx;
  const items = ctx.items;
  const cats = ctx.categories;
  const catOf = (p) => items[p.itemId]?.categoryId ?? 'ostalo';
  const month = state.rows.purchases.filter((p) => monthKey(p.date) === state.month);
  const present = [...new Set(month.map(catOf))];
  const shown = month.filter((p) => !state.filter || catOf(p) === state.filter);
  const total = shown.reduce((s, p) => s + Number(p.total || 0), 0);

  if (!month.length) {
    return h('div', { class: 'empty' }, h('p', {}, 'Ovog meseca nema kupovina. Dodaj ih na Početnoj, kroz brzi unos.'));
  }

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter po kategoriji' },
    h('button', { type: 'button', 'aria-pressed': String(!state.filter), onclick: () => ctx.setFilter(null) }, 'Sve'),
    present.map((id) => h('button', { type: 'button', 'aria-pressed': String(state.filter === id), onclick: () => ctx.setFilter(id) },
      cats[id]?.name ?? 'Ostalo')));

  const days = {};
  for (const p of shown) (days[p.date] ??= []).push(p);
  const groups = Object.keys(days).sort().reverse().map((d) => h('section', { class: 'panel' },
    h('h2', { class: 'day' }, dayLabel(d), h('span', { class: 'num' }, formatRSD(days[d].reduce((s, p) => s + Number(p.total || 0), 0)))),
    h('ul', { class: 'list' }, days[d].map((p) => row(ctx, p)))));

  return h('div', { class: 'stack' },
    chips,
    h('p', { class: 'sum' }, `${shown.length} stavki · `, h('strong', {}, `${formatRSD(total)} RSD`)),
    groups);
}

function row(ctx, p) {
  const { state } = ctx;
  if (openId !== p.id) {
    return h('li', { class: 'tap', tabindex: '0', onclick: () => { openId = p.id; confirmDelete = null; ctx.render(); },
      onkeydown: (e) => { if (e.key === 'Enter') { openId = p.id; ctx.render(); } } },
    h('span', {}, p.name, h('small', {}, qtyLabel(p.qty, p.unit), p.source === 'glas' ? ' · glasom' : '')),
    h('span', { class: 'num' }, formatRSD(p.total)));
  }
  const draft = { ...p };
  const save = () => ctx.run(async () => {
    const { id, ...body } = draft;
    await state.store.put('purchases', id, { ...body, qty: Number(body.qty) || 0, total: Number(body.total) || 0 });
    openId = null;
  }, 'Izmena sačuvana');
  return h('li', { class: 'editor' },
    h('strong', {}, p.name),
    h('div', { class: 'row nums' },
      h('input', { id: `e-${p.id}-qty`, type: 'number', step: 'any', inputmode: 'decimal', value: p.qty, 'aria-label': 'Količina', oninput: (e) => { draft.qty = e.target.value; } }),
      h('span', { class: 'unit' }, p.unit),
      h('label', { class: 'money' },
        h('input', { id: `e-${p.id}-total`, type: 'number', step: 'any', inputmode: 'decimal', value: p.total, 'aria-label': 'Ukupno', oninput: (e) => { draft.total = e.target.value; } }),
        h('span', {}, 'RSD'))),
    h('input', { id: `e-${p.id}-date`, type: 'date', value: p.date, 'aria-label': 'Datum', oninput: (e) => { draft.date = e.target.value || p.date; } }),
    h('div', { class: 'entry-actions' },
      confirmDelete === p.id
        ? h('button', { type: 'button', class: 'danger', onclick: () => ctx.run(async () => { await state.store.remove('purchases', p.id); openId = null; }, 'Stavka obrisana') }, 'Da, obriši')
        : h('button', { type: 'button', class: 'ghost', onclick: () => { confirmDelete = p.id; ctx.render(); } }, 'Obriši'),
      h('button', { type: 'button', class: 'ghost', onclick: () => { openId = null; ctx.render(); } }, 'Zatvori'),
      h('button', { type: 'button', class: 'primary', onclick: save }, 'Sačuvaj')));
}
