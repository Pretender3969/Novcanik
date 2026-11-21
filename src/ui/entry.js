// Brzi unos: tekst ili glas → kartice za potvrdu → kupovine.
import { parseEntry, toBaseQty, suggestUnit } from '../parser.js';
import { normalize } from '../normalize.js';
import { formatRSD } from '../format.js';
import { h, today } from './dom.js';

const UNITS = ['kom', 'kg', 'g', 'l', 'ml'];

function slugId(name, taken) {
  const base = normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artikal';
  let id = base, i = 2;
  while (taken.has(id)) id = `${base}-${i++}`;
  taken.add(id);
  return id;
}

export function createEntry(ctx, slot) {
  const { state } = ctx;
  let lines = [];
  let confident = true;
  let usedVoice = false;
  let micOff = false;
  let busy = false;
  let date = today();

  const text = h('textarea', {
    id: 'quick', rows: 2, autocomplete: 'off', spellcheck: 'false',
    placeholder: 'npr. jaja 30 komada 600 dinara, hleb 80',
    'aria-label': 'Šta si kupio',
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); interpret(); } },
  });
  const partial = h('p', { class: 'partial', hidden: true });
  const voiceHint = h('p', { class: 'hint', hidden: true },
    'Za unos glasom dodirni mikrofon na tastaturi telefona i izgovori npr. „jaja 30 komada 600 dinara“, pa dodirni Protumači.');
  const mic = h('button', { type: 'button', class: 'mic', hidden: true, 'aria-label': 'Diktiraj kupovinu', onclick: toggleMic }, 'Diktiraj');
  const go = h('button', { type: 'button', class: 'primary', onclick: interpret }, 'Protumači');
  const cards = h('div', { class: 'cards', 'aria-live': 'polite' });

  slot.replaceChildren(
    h('div', { class: 'entry' },
      h('label', { for: 'quick', class: 'eyebrow' }, 'Brzi unos kupovine'),
      text, partial, voiceHint,
      h('div', { class: 'entry-actions' }, mic, go)),
    cards,
  );

  let dictationBound = false;
  function bindDictation(d) {
    if (dictationBound || !d) return;
    dictationBound = true;
    d.onPartial(({ text: t }) => { partial.textContent = t; partial.hidden = !t; });
    d.onFinal(({ text: t }) => {
      text.value = text.value ? text.value + t : t.trimStart();
      usedVoice = true;
    });
    d.onState(({ state: s, reason }) => {
      const on = s !== 'idle';
      mic.classList.toggle('live', on);
      mic.textContent = on ? 'Zaustavi' : 'Diktiraj';
      if (!on) partial.hidden = true;
      if (!on && (reason === 'stopped' || reason === 'viewer_stopped') && text.value.trim()) interpret();
      if (reason === 'unavailable' || reason === 'not_granted') { micOff = true; mic.hidden = true; voiceHint.hidden = false; }
    });
  }

  function toggleMic() {
    const d = state.caps.dictation;
    if (!d) return;
    if (d.active()) { d.stop(); return; }
    d.start().catch((e) => {
      if (e?.code === 'not_granted' || e?.code === 'unavailable') {
        micOff = true; mic.hidden = true; voiceHint.hidden = false;
        ctx.toast('Diktiranje nije dostupno ovde. Koristi mikrofon na tastaturi telefona.');
      } else if (e?.code === 'rate_limited') ctx.toast('Diktiranje je trenutno zauzeto. Probaj za minut.');
    });
  }

  function interpret() {
    const r = parseEntry(text.value, state.rows.items);
    lines = r.lines.map((l) => ({ ...l, newCategory: '' }));
    confident = r.confident;
    if (!lines.length) ctx.toast('Upiši bar jednu stavku, npr. „hleb 80“.');
    drawCards();
  }

  async function askClaude() {
    const s = state.caps.sample;
    if (!s || busy) return;
    busy = true; drawCards();
    const catalog = state.rows.items.map((i) => `${i.id} | ${i.name} | ${i.unit}`).join('\n');
    const prompt = `Tumačiš unos kupovine na srpskom (latinica ili ćirilica, možda iz diktiranja).
Katalog artikala (id | naziv | jedinica):
${catalog}

Unos: """${text.value}"""

Vrati JSON: {"lines":[{"itemId": id iz kataloga ili null ako artikla nema, "name": naziv kako ga je korisnik rekao, "qty": broj, "unit": "kom"|"kg"|"g"|"l"|"ml", "total": ukupno plaćeno u dinarima ili null}]}.
Cena je UKUPNO plaćeno za stavku. Brojeve rečima pretvori u cifre ("hiljadu dvesta" = 1200). Bez ikakvog drugog teksta.`;
    try {
      const out = await s.json(prompt, { modelTier: 'quick' });
      const known = new Set(state.rows.items.map((i) => i.id));
      lines = (out?.lines ?? []).map((l) => ({
        raw: '', name: String(l.name ?? ''), itemId: known.has(l.itemId) ? l.itemId : null,
        qty: Number(l.qty) > 0 ? Number(l.qty) : 1, unit: UNITS.includes(l.unit) ? l.unit : 'kom',
        total: Number(l.total) > 0 ? Number(l.total) : null, newCategory: '', confident: true,
      }));
      confident = true;
    } catch (e) {
      ctx.toast(e?.code === 'rate_limited' ? 'Claude je zauzet. Probaj za minut.' : 'Claude nije uspeo da protumači. Ispravi kartice ručno.');
    }
    busy = false; drawCards();
  }

  function lineValid(l) {
    return Number(l.total) > 0 && Number(l.qty) > 0 && (l.itemId || (l.name.trim() && l.newCategory));
  }

  async function saveAll() {
    if (!lines.length || !lines.every(lineValid) || busy) return;
    busy = true; drawCards();
    const taken = new Set(state.rows.items.map((i) => i.id));
    let sum = 0;
    await ctx.run(async () => {
      for (const l of lines) {
        let itemId = l.itemId;
        let unit = state.rows.items.find((i) => i.id === itemId)?.unit;
        if (!itemId) {
          itemId = slugId(l.name, taken);
          unit = ['kg', 'g'].includes(l.unit) ? 'kg' : ['l', 'ml'].includes(l.unit) ? 'l' : 'kom';
          const name = l.name.trim().replace(/^./, (c) => c.toUpperCase());
          await state.store.put('items', itemId, {
            name, synonyms: [], categoryId: l.newCategory, unit, status: 'normalno', statusSince: null,
          });
        }
        const name = state.rows.items.find((i) => i.id === itemId)?.name ?? l.name.trim();
        await state.store.add('purchases', {
          date, itemId, name, qty: toBaseQty(Number(l.qty), l.unit, unit), unit,
          total: Number(l.total), source: usedVoice ? 'glas' : 'tekst',
        });
        sum += Number(l.total);
      }
      const n = lines.length;
      lines = []; text.value = ''; usedVoice = false;
      ctx.toast(`Sačuvano: ${n} ${n === 1 ? 'stavka' : n < 5 ? 'stavke' : 'stavki'}, ${formatRSD(sum)} RSD`);
    });
    busy = false; drawCards();
  }

  function card(l, idx) {
    const items = [...state.rows.items].sort((a, b) => a.name.localeCompare(b.name, 'sr'));
    const pick = h('select', {
      id: `c${idx}-item`, 'aria-label': 'Artikal',
      onchange: (e) => {
        l.itemId = e.target.value === '__new' ? null : e.target.value;
        if (l.itemId) l.unit = state.rows.items.find((i) => i.id === l.itemId)?.unit ?? l.unit;
        drawCards();
      },
    },
    h('option', { value: '__new', selected: !l.itemId }, l.name ? `Novi artikal: ${l.name}` : 'Novi artikal'),
    items.map((i) => h('option', { value: i.id, selected: i.id === l.itemId }, i.name)));
    const cats = state.rows.categories;
    const newRow = !l.itemId && h('div', { class: 'row' },
      h('input', { id: `c${idx}-name`, value: l.name, 'aria-label': 'Naziv novog artikla', oninput: (e) => { l.name = e.target.value; updateSave(); } }),
      h('select', { id: `c${idx}-cat`, 'aria-label': 'Kategorija', onchange: (e) => {
        l.newCategory = e.target.value;
        if (l.unit === 'kom' && suggestUnit(l.name, l.newCategory) === 'kg') { l.unit = 'kg'; drawCards(); } else updateSave();
      } },
        h('option', { value: '' }, 'Kategorija…'),
        cats.map((c) => h('option', { value: c.id, selected: c.id === l.newCategory }, c.name))));
    return h('div', { class: `card${l.itemId ? '' : ' unknown'}` },
      h('div', { class: 'row' }, pick,
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Ukloni stavku', onclick: () => { lines.splice(idx, 1); drawCards(); } }, '×')),
      newRow,
      h('div', { class: 'row nums' },
        h('input', { id: `c${idx}-qty`, type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: l.qty, 'aria-label': 'Količina', oninput: (e) => { l.qty = e.target.value; updateSave(); } }),
        h('select', { id: `c${idx}-unit`, 'aria-label': 'Jedinica', onchange: (e) => { l.unit = e.target.value; } },
          UNITS.map((u) => h('option', { value: u, selected: u === l.unit }, u))),
        h('label', { class: 'money' },
          h('input', { id: `c${idx}-total`, type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: l.total ?? '', placeholder: 'cena', 'aria-label': 'Ukupno plaćeno', oninput: (e) => { l.total = e.target.value; updateSave(); } }),
          h('span', {}, 'RSD'))));
  }

  let saveBtn = null;
  function updateSave() {
    if (saveBtn) saveBtn.disabled = busy || !lines.every(lineValid);
  }

  function drawCards() {
    if (!lines.length) { cards.replaceChildren(); return; }
    const total = lines.reduce((s, l) => s + (Number(l.total) || 0), 0);
    saveBtn = h('button', { type: 'button', class: 'primary', onclick: saveAll }, busy ? 'Čuvam…' : `Sačuvaj sve · ${formatRSD(total)} RSD`);
    const showAsk = !confident && state.caps.sample;
    cards.replaceChildren(...[
      h('div', { class: 'cards-head' },
        h('span', { class: 'eyebrow' }, `Proveri pre čuvanja (${lines.length})`),
        h('input', { id: 'entry-date', type: 'date', value: date, 'aria-label': 'Datum kupovine', onchange: (e) => { date = e.target.value || today(); } })),
      lines.map(card),
      showAsk && h('button', { type: 'button', class: 'ghost', disabled: busy, onclick: askClaude }, busy ? 'Claude tumači…' : 'Pitaj Claude da protumači'),
      h('div', { class: 'entry-actions' },
        h('button', { type: 'button', class: 'ghost', onclick: () => { lines = []; drawCards(); } }, 'Odustani'),
        saveBtn),
    ].flat().filter(Boolean));
    updateSave();
  }

  return {
    refresh() {
      bindDictation(state.caps.dictation);
      mic.hidden = !state.caps.dictation || micOff;
      voiceHint.hidden = !(state.caps.dictationChecked && mic.hidden);
    },
  };
}
