// Računi i prihodi za izabrani mesec, plus šabloni mesečnih računa.
import { monthKey } from '../totals.js';
import { formatRSD } from '../format.js';
import { ensureMonthPayments } from '../store.js';
import { h, today } from './dom.js';

let editId = null;

export function renderBills(ctx) {
  const { state } = ctx;
  const pays = state.rows.payments.filter((p) => p.month === state.month)
    .sort((a, b) => Number(a.paid) - Number(b.paid) || a.name.localeCompare(b.name, 'sr'));
  const income = state.rows.income.filter((i) => monthKey(i.date) === state.month);
  const sumPaid = pays.filter((p) => p.paid).reduce((s, p) => s + Number(p.amount || 0), 0);
  const sumAll = pays.reduce((s, p) => s + Number(p.amount || 0), 0);

  const billList = pays.length
    ? h('ul', { class: 'list bills' }, pays.map((p) => billRow(ctx, p)))
    : h('div', { class: 'empty' },
      h('p', {}, 'Za ovaj mesec nema računa.'),
      state.rows.bills.some((b) => b.active) && h('button', { type: 'button', class: 'ghost',
        onclick: () => ctx.run(() => ensureMonthPayments(state.store, state.rows.bills, state.rows.payments, state.month), 'Računi dodati') },
      'Dodaj račune iz šablona'));

  return h('div', { class: 'stack' },
    h('section', { class: 'panel' },
      h('h2', {}, 'Računi', h('span', { class: 'num' }, `${formatRSD(sumPaid)} / ${formatRSD(sumAll)}`)),
      h('p', { class: 'hint' }, 'Dodirni iznos da ga promeniš; dodirni kvadratić kad platiš.'),
      billList),
    incomeSection(ctx, income),
    templates(ctx));
}

function billRow(ctx, p) {
  const { state } = ctx;
  const toggle = () => ctx.run(() => state.store.put('payments', p.id, strip({ ...p, paid: !p.paid, paidDate: p.paid ? null : today() })));
  const amount = editId === p.id
    ? h('input', { id: `pay-${p.id}`, type: 'number', inputmode: 'decimal', value: p.amount, class: 'inline', 'aria-label': `Iznos ${p.name}`,
      onchange: (e) => { editId = null; ctx.run(() => state.store.put('payments', p.id, strip({ ...p, amount: Number(e.target.value) || 0 }))); },
      onblur: () => { editId = null; } })
    : h('button', { type: 'button', class: 'num amount', onclick: () => { editId = p.id; ctx.render(); queueMicrotask(() => document.getElementById(`pay-${p.id}`)?.focus()); } }, formatRSD(p.amount));
  return h('li', { class: p.paid ? 'paid' : '' },
    h('label', { class: 'check' },
      h('input', { id: `paid-${p.id}`, type: 'checkbox', checked: p.paid, onchange: toggle }),
      h('span', {}, p.name, h('small', {}, p.paid ? `plaćeno${p.paidDate ? ' ' + p.paidDate.split('-').reverse().join('.') + '.' : ''}` : 'čeka uplatu'))),
    amount);
}

const strip = ({ id, ...rest }) => rest;

function incomeSection(ctx, income) {
  const { state } = ctx;
  const sources = [...new Set(state.rows.income.map((i) => i.source))];
  const draft = { source: '', amount: '', date: state.month === monthKey(new Date()) ? today() : `${state.month}-01` };
  const total = income.reduce((s, i) => s + Number(i.amount || 0), 0);
  return h('section', { class: 'panel' },
    h('h2', {}, 'Prihodi', h('span', { class: 'num' }, formatRSD(total))),
    income.length ? h('ul', { class: 'list' }, income.map((i) => h('li', {},
      h('span', {}, i.source, h('small', {}, i.date.split('-').reverse().join('.') + '.')),
      h('span', { class: 'num' }, formatRSD(i.amount),
        h('button', { type: 'button', class: 'icon', 'aria-label': `Obriši prihod ${i.source}`, onclick: () => ctx.run(() => state.store.remove('income', i.id), 'Prihod obrisan') }, '×'))))) : h('p', { class: 'hint' }, 'Još nema prihoda za ovaj mesec.'),
    h('form', { class: 'add-income', onsubmit: (e) => {
      e.preventDefault();
      if (!draft.source.trim() || !(Number(draft.amount) > 0)) { ctx.toast('Upiši izvor i iznos prihoda.'); return; }
      ctx.run(() => state.store.add('income', { source: draft.source.trim(), amount: Number(draft.amount), date: draft.date }), 'Prihod dodat');
    } },
    h('input', { id: 'inc-source', list: 'inc-sources', placeholder: 'Izvor, npr. Plata', 'aria-label': 'Izvor prihoda', oninput: (e) => { draft.source = e.target.value; } }),
    h('datalist', { id: 'inc-sources' }, sources.map((s) => h('option', { value: s }))),
    h('div', { class: 'row nums' },
      h('label', { class: 'money' },
        h('input', { id: 'inc-amount', type: 'number', inputmode: 'decimal', placeholder: 'iznos', 'aria-label': 'Iznos prihoda', oninput: (e) => { draft.amount = e.target.value; } }),
        h('span', {}, 'RSD')),
      h('input', { id: 'inc-date', type: 'date', value: draft.date, 'aria-label': 'Datum prihoda', oninput: (e) => { draft.date = e.target.value || draft.date; } })),
    h('button', { type: 'submit', class: 'primary' }, 'Dodaj prihod')));
}

function templates(ctx) {
  const { state } = ctx;
  const bills = [...state.rows.bills].sort((a, b) => a.name.localeCompare(b.name, 'sr'));
  const draft = { name: '', amount: '' };
  return h('details', { class: 'panel' },
    h('summary', {}, `Mesečni računi (${bills.filter((b) => b.active).length} aktivnih)`),
    h('p', { class: 'hint' }, 'Aktivni računi se svakog meseca sami dodaju na listu. Iznos je predlog; menjaš ga na listi.'),
    h('ul', { class: 'list' }, bills.map((b) => h('li', {},
      h('label', { class: 'check' },
        h('input', { id: `bill-${b.id}`, type: 'checkbox', checked: b.active, onchange: () => ctx.run(() => state.store.put('bills', b.id, strip({ ...b, active: !b.active }))) }),
        h('span', {}, b.name, h('small', {}, `dospeva ${b.dueDay}. u mesecu`))),
      h('span', { class: 'num' }, formatRSD(b.amount))))),
    h('form', { class: 'add-income', onsubmit: (e) => {
      e.preventDefault();
      if (!draft.name.trim()) return;
      const id = draft.name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `racun-${Date.now()}`;
      ctx.run(() => state.store.put('bills', id, { name: draft.name.trim(), amount: Number(draft.amount) || 0, dueDay: 5, active: true }), 'Račun dodat u šablon');
    } },
    h('div', { class: 'row nums' },
      h('input', { id: 'bill-name', placeholder: 'Novi račun, npr. Vrtić', 'aria-label': 'Naziv računa', oninput: (e) => { draft.name = e.target.value; } }),
      h('label', { class: 'money' },
        h('input', { id: 'bill-amount', type: 'number', inputmode: 'decimal', placeholder: 'iznos', 'aria-label': 'Uobičajen iznos', oninput: (e) => { draft.amount = e.target.value; } }),
        h('span', {}, 'RSD'))),
    h('button', { type: 'submit', class: 'ghost' }, 'Dodaj račun')));
}
