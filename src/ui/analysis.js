// Analiza: ovaj mesec, trend 6 meseci, kandidati za izbacivanje, praćeni artikli, Pitaj Claude.
import { trend, candidates, savings, summaryForClaude } from '../analysis.js';
import { monthSummary } from '../totals.js';
import { formatRSD } from '../format.js';
import { h, today, monthLabel } from './dom.js';

const SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const KIND = {
  porok: ['porok', 'vice'],
  'bez-recepta': ['ne ulazi u recepte', 'warn'],
  'baca-se': ['baca se', 'warn'],
  raste: ['kategorija raste', 'warn'],
};
const STATUS = { 'pod-lupom': 'Pod lupom', izbaciti: 'Izbačeno' };

const ui = { answer: '', asking: false, error: '', abort: null };

const data = (state) => ({
  purchases: state.rows.purchases, items: state.rows.items, categories: state.rows.categories,
  recipes: state.rows.recipes, stockAdjust: state.rows.stockAdjust,
});

function setStatus(ctx, item, status) {
  const { id, ...body } = item;
  const since = status === 'normalno' || status === 'u-redu' ? null : today();
  const label = { 'pod-lupom': `${item.name} je pod lupom`, izbaciti: `${item.name}: izbačeno, pratim uštedu`, 'u-redu': `${item.name} je u redu`, normalno: `${item.name} vraćen` }[status];
  return ctx.run(() => ctx.state.store.put('items', id, { ...body, status, statusSince: since }), label);
}

export function renderAnalysis(ctx) {
  const { state } = ctx;
  const d = data(state);
  const s = monthSummary(state.month, { ...state.rows, items: ctx.items });
  const tr = trend(state.month, 6, d);
  const cur = tr[tr.length - 1];
  const prev = tr[tr.length - 2];
  return h('div', { class: 'stack' },
    thisMonth(ctx, s, cur, prev),
    chart(ctx, tr),
    candidateList(ctx, d),
    watched(ctx),
    askClaude(ctx, d));
}

function thisMonth(ctx, s, cur, prev) {
  const share = cur.total ? Math.round((cur.vice / cur.total) * 100) : 0;
  const diff = prev.total ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null;
  return h('section', { class: 'balance' },
    h('p', { class: 'eyebrow' }, `Kupovina · ${monthLabel(ctx.state.month)}`),
    h('p', { class: 'big' }, formatRSD(cur.total), h('small', {}, ' RSD')),
    h('dl', { class: 'ledger' },
      h('dt', {}, 'Porok', h('span', { class: 'pill vice' }, `${share}%`)), h('dd', {}, formatRSD(cur.vice)),
      h('dt', {}, 'Prošli mesec'), h('dd', {}, diff === null ? '–' : `${formatRSD(prev.total)} (${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)}%)`),
      h('dt', {}, 'Računi'), h('dd', {}, formatRSD(s.bills))));
}

function chart(ctx, tr) {
  const max = Math.max(...tr.map((t) => t.total), 1);
  const sel = ctx.state.month;
  const bars = tr.map((t) => {
    const [, m] = t.month.split('-').map(Number);
    const rest = t.total - t.vice;
    const title = `${monthLabel(t.month)}: ukupno ${formatRSD(t.total)} RSD, porok ${formatRSD(t.vice)}, ostalo ${formatRSD(rest)}`;
    return h('button', { type: 'button', class: `tbar${t.month === sel ? ' sel' : ''}`, title, 'aria-label': title, onclick: () => ctx.setMonth(t.month) },
      h('span', { class: 'tval' }, t.month === sel && t.total ? formatRSD(t.total) : ''),
      h('span', { class: 'tcol', style: { height: `calc((100% - 40px) * ${t.total / max})` } },
        rest > 0 && h('span', { class: 'seg rest', style: { flexGrow: rest } }),
        t.vice > 0 && h('span', { class: 'seg vice', style: { flexGrow: t.vice } })),
      h('span', { class: 'tlab' }, SHORT[m - 1]));
  });
  return h('section', { class: 'panel' },
    h('h2', {}, 'Kupovina, poslednjih 6 meseci'),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'sw rest' }), 'Ostalo'),
      h('span', {}, h('i', { class: 'sw vice' }), 'Porok')),
    h('div', { class: 'tchart' }, bars),
    h('p', { class: 'hint' }, 'Dodirni stubić da otvoriš taj mesec.'));
}

function candidateList(ctx, d) {
  const list = candidates(ctx.state.month, d);
  const itemsById = ctx.items;
  return h('section', { class: 'panel' },
    h('h2', {}, 'Kandidati za izbacivanje', h('span', { class: 'num' }, list.length || '')),
    list.length === 0
      ? h('p', { class: 'hint' }, 'Nema kandidata za ovaj mesec. Ovde se pojavljuju porok preko 500 RSD, namirnice preko 1.000 RSD koje ne ulaze u recepte, ono što se baca i kategorije koje rastu tri meseca zaredom.')
      : h('ul', { class: 'list cands' }, list.map((c) => {
        const [label, tone] = KIND[c.kind];
        const item = c.kind === 'raste' ? null : itemsById[c.id];
        return h('li', {},
          h('div', { class: 'row spread' },
            h('span', {}, c.name, h('span', { class: `pill ${tone}` }, label), h('small', {}, c.detail)),
            h('span', { class: 'num' }, formatRSD(c.amount))),
          item && h('div', { class: 'row acts' },
            h('button', { type: 'button', class: 'ghost small', onclick: () => setStatus(ctx, item, 'pod-lupom') }, 'Pod lupom'),
            h('button', { type: 'button', class: 'ghost small', onclick: () => setStatus(ctx, item, 'izbaciti') }, 'Izbaci'),
            h('button', { type: 'button', class: 'link small', onclick: () => setStatus(ctx, item, 'u-redu') }, 'U redu je')));
      })));
}

function watched(ctx) {
  const list = ctx.state.rows.items.filter((i) => STATUS[i.status]).sort((a, b) => a.name.localeCompare(b.name, 'sr'));
  const reviewed = ctx.state.rows.items.filter((i) => i.status === 'u-redu').length;
  if (!list.length && !reviewed) return null;
  const day = today();
  let total = 0;
  const rows = list.map((i) => {
    const sv = i.status === 'izbaciti' ? savings(i, ctx.state.rows.purchases, day) : null;
    if (sv) total += sv.saved;
    const since = i.statusSince ? i.statusSince.split('-').reverse().join('.') + '.' : '';
    return h('li', {},
      h('span', {}, i.name, h('span', { class: `pill ${i.status === 'izbaciti' ? 'vice' : 'warn'}` }, STATUS[i.status]),
        h('small', {}, sv ? `od ${since} · ranije ≈ ${formatRSD(sv.avgBefore)} RSD mesečno · potrošeno od tada ${formatRSD(sv.spentSince)}` : `od ${since}`)),
      h('span', { class: 'num' }, sv ? `+${formatRSD(sv.saved)}` : '',
        h('button', { type: 'button', class: 'link small', onclick: () => setStatus(ctx, i, 'normalno') }, 'Vrati')));
  });
  return h('section', { class: 'panel' },
    h('h2', {}, 'Praćeno', total > 0 ? h('span', { class: 'num pos-text' }, `ušteđeno ≈ ${formatRSD(total)} RSD`) : null),
    rows.length ? h('ul', { class: 'list' }, rows) : null,
    reviewed > 0 && h('p', { class: 'hint' }, `${reviewed} ${reviewed === 1 ? 'artikal je označen' : 'artikala je označeno'} kao „u redu“ i ne pojavljuje se među kandidatima.`));
}

function askClaude(ctx, d) {
  const sample = ctx.state.caps.sample;
  if (!sample) return copySummary(ctx, d);
  const ask = async () => {
    ui.abort?.abort();
    const ac = new AbortController();
    ui.abort = ac; ui.asking = true; ui.answer = ''; ui.error = '';
    ctx.render();
    const summary = summaryForClaude(ctx.state.month, d);
    const prompt = `Ti si savetnik za kućni budžet jedne porodice u Srbiji. Evo sažetka kupovine za mesec ${summary.mesec} (iznosi u dinarima, bez računa i prihoda):

${JSON.stringify(summary, null, 1)}

Napiši na srpskom (latinica), kratko i konkretno:
1. Tri najveće prilike za uštedu, sa procenom koliko mesečno može da se uštedi.
2. Šta deluje razumno i ne treba dirati.
3. Jedan mali korak za sledeću nedelju.
Bez uvoda i bez moralisanja; obični pasusi ili kratke liste, bez tabela.`;
    try {
      const r = await sample(prompt, { signal: ac.signal, onText: ({ text }) => { ui.answer = text; paint(); } });
      ui.answer = r.text;
    } catch (e) {
      if (e?.name !== 'AbortError') ui.error = e?.code === 'rate_limited' ? 'Claude je trenutno zauzet. Probaj za minut.' : e?.code === 'not_granted' ? 'Pitanja Claudeu su isključena za ovu aplikaciju.' : 'Claude nije odgovorio. Probaj ponovo.';
    }
    ui.asking = false;
    ctx.render();
  };
  const out = h('div', { class: 'answer', id: 'claude-answer', 'aria-live': 'polite' }, ui.answer);
  function paint() { const el = document.getElementById('claude-answer'); if (el) el.textContent = ui.answer; }
  return h('section', { class: 'panel' },
    h('h2', {}, 'Pitaj Claude'),
    h('p', { class: 'hint' }, `Šalje se samo sažetak kupovine za ${monthLabel(ctx.state.month)}: zbirovi po kategorijama i artiklima. Prihodi i računi se ne šalju.`),
    h('button', { type: 'button', class: 'primary', disabled: ui.asking, onclick: ask }, ui.asking ? 'Claude razmišlja…' : 'Predloži uštede'),
    ui.error && h('p', { class: 'hint warn-text' }, ui.error),
    (ui.answer || ui.asking) && out);
}

function copySummary(ctx, d) {
  const text = `Ovo je sažetak kupovine iz aplikacije Kućni Trošak. Predloži tri najveće uštede, šta ne treba dirati i jedan mali korak za sledeću nedelju.

${JSON.stringify(summaryForClaude(ctx.state.month, d), null, 1)}`;
  const area = h('textarea', { id: 'summary-text', rows: 4, readonly: true, 'aria-label': 'Sažetak za Claude' }, text);
  return h('section', { class: 'panel' },
    h('h2', {}, 'Pitaj Claude'),
    h('p', { class: 'hint' }, `Kopiraj sažetak kupovine za ${monthLabel(ctx.state.month)} i nalepi ga u razgovor sa Claude-om. Prihodi i računi nisu u sažetku.`),
    h('button', {
      type: 'button', class: 'primary',
      onclick: () => {
        navigator.clipboard?.writeText(text).then(() => ctx.toast('Sažetak je kopiran.'), () => { area.select(); ctx.toast('Označeno; kopiraj ručno.'); })
          ?? (area.select(), ctx.toast('Označeno; kopiraj ručno.'));
      },
    }, 'Kopiraj sažetak'),
    area);
}
