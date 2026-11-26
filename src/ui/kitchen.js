// Kuhinja: kuvanje (troši namirnice), recepti (sa cenom) i polica (procena zaliha).
import { consumptionFor, resolveIngredient, unitPrice, recipeCost, shelf, shelfFrom } from '../kitchen.js';
import { monthKey } from '../totals.js';
import { formatRSD } from '../format.js';
import { normalize } from '../normalize.js';
import { h, today, dayLabel, qtyLabel } from './dom.js';
import { weekStart, weekDays, shoppingList, formatQty, listText } from '../planning.js';

const MEALS = [['dorucak', 'Doručak'], ['rucak', 'Ručak'], ['vecera', 'Večera'], ['uzina', 'Užina'], ['ostalo', 'Ostalo']];
const UNITS = ['kom', 'kg', 'g', 'l', 'ml'];
const PROBLEM = { artikal: 'nema artikla', kolicina: 'nema količine', jedinica: 'jedinica se ne slaže' };

// Stanje ekrana živi van rendera, da osvežavanje baze ne obriše ono što je upisano.
const ui = { sub: null, cook: null, edit: null, confirm: null, shelfOpen: null, shelfInput: {} };

function loadSub() {
  if (ui.sub) return ui.sub;
  try { ui.sub = localStorage.getItem('kt-kitchen'); } catch {}
  if (!['kuvanje', 'plan', 'recepti', 'polica'].includes(ui.sub)) ui.sub = 'kuvanje';
  return ui.sub;
}

export function renderKitchen(ctx) {
  const sub = loadSub();
  const tabs = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Kuhinja' },
    [['kuvanje', 'Kuvanje'], ['plan', 'Plan'], ['recepti', 'Recepti'], ['polica', 'Polica']].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(sub === id), 'aria-pressed': String(sub === id),
        onclick: () => { ui.sub = id; ui.confirm = null; try { localStorage.setItem('kt-kitchen', id); } catch {} ctx.render(); } }, label)));
  const body = { kuvanje: cooking, plan: planView, recepti: recipes, polica: pantry }[sub](ctx);
  return h('div', { class: 'stack' }, tabs, body);
}

const itemName = (ctx, id) => ctx.items[id]?.name ?? id;
const priceOf = (ctx, itemId, date = today()) => unitPrice(itemId, ctx.state.rows.purchases, date);

function costOf(ctx, consumption, date) {
  return consumption.reduce((s, x) => s + (Number(x.qty) || 0) * (priceOf(ctx, x.itemId, date) ?? 0), 0);
}

// ---------- Kuvanje ----------

function startCook(ctx, recipeId, servings, planId = null) {
  const recipe = ctx.state.rows.recipes.find((r) => r.id === recipeId);
  if (!recipe) { ui.cook = null; return; }
  const items = ctx.state.rows.items;
  const n = Number(servings) > 0 ? Number(servings) : Math.max(Number(recipe.servings) || 1, 1);
  ui.cook = {
    recipeId, servings: n, date: ui.cook?.date ?? today(),
    planId: planId ?? (ui.cook?.recipeId === recipeId ? ui.cook?.planId : null),
    lines: consumptionFor(recipe, n, items).map((l) => ({ ...l })),
    skipped: (recipe.ingredients ?? []).map((i) => ({ name: i.name, ...resolveIngredient(i, items) })).filter((r) => r.problem),
  };
}

function cooking(ctx) {
  const { state } = ctx;
  const recipesSorted = [...state.rows.recipes].sort((a, b) => a.name.localeCompare(b.name, 'sr'));
  if (!recipesSorted.length) {
    return h('div', { class: 'empty' }, h('p', {}, 'Još nema recepata. Dodaj prvi u delu Recepti.'),
      h('button', { type: 'button', class: 'link', onclick: () => { ui.sub = 'recepti'; ctx.render(); } }, 'Recepti →'));
  }
  const c = ui.cook;
  const form = h('section', { class: 'panel' },
    h('h2', {}, 'Šta si skuvao?'),
    h('div', { class: 'row' },
      h('select', { id: 'cook-recipe', 'aria-label': 'Jelo', onchange: (e) => { startCook(ctx, e.target.value); ctx.render(); } },
        h('option', { value: '' }, 'Izaberi jelo…'),
        recipesSorted.map((r) => h('option', { value: r.id, selected: c?.recipeId === r.id }, r.name))),
      h('label', { class: 'money servings' },
        h('input', { id: 'cook-servings', type: 'number', inputmode: 'numeric', min: '1', step: '1', value: c?.servings ?? '', 'aria-label': 'Broj porcija', disabled: !c,
          onchange: (e) => { if (c) { startCook(ctx, c.recipeId, e.target.value); ctx.render(); } } }),
        h('span', {}, 'porc.'))),
    c && cookPreview(ctx, c));

  const month = state.rows.cooking.filter((k) => monthKey(k.date) === state.month)
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  const log = h('section', { class: 'panel' },
    h('h2', {}, 'Kuvano ovog meseca', h('span', { class: 'num' }, `${month.length}×`)),
    month.length
      ? h('ul', { class: 'list' }, month.map((k) => h('li', {},
        h('span', {}, k.recipeName, h('small', {}, `${dayLabel(k.date)} · ${k.servings} porc.`)),
        h('span', { class: 'num' }, `≈ ${formatRSD(costOf(ctx, k.consumption ?? [], k.date))}`,
          ui.confirm === `cook-${k.id}`
            ? h('button', { type: 'button', class: 'danger small', onclick: () => ctx.run(async () => { await state.store.remove('cooking', k.id); ui.confirm = null; }, 'Obrisano') }, 'Obriši')
            : h('button', { type: 'button', class: 'icon', 'aria-label': `Obriši ${k.recipeName}`, onclick: () => { ui.confirm = `cook-${k.id}`; ctx.render(); } }, '×')))))
      : h('p', { class: 'hint' }, 'Kad zabeležiš kuvanje, namirnice se skidaju sa police i vidiš koliko je jelo koštalo.'));
  return h('div', { class: 'stack' }, form, log);
}

function cookPreview(ctx, c) {
  const { state } = ctx;
  const cost = costOf(ctx, c.lines, c.date);
  return h('div', { class: 'stack tight' },
    h('p', { class: 'eyebrow' }, 'Skida se sa police'),
    c.lines.length
      ? h('ul', { class: 'list' }, c.lines.map((l, i) => h('li', {},
        h('span', {}, itemName(ctx, l.itemId)),
        h('span', { class: 'row qty' },
          h('input', { id: `cook-q-${i}`, type: 'number', step: 'any', inputmode: 'decimal', value: l.qty, class: 'inline', 'aria-label': `Količina ${itemName(ctx, l.itemId)}`,
            oninput: (e) => { l.qty = Number(e.target.value) || 0; } }),
          h('span', { class: 'unit' }, ctx.items[l.itemId]?.unit ?? ''),
          h('button', { type: 'button', class: 'icon', 'aria-label': 'Ukloni', onclick: () => { c.lines.splice(i, 1); ctx.render(); } }, '×')))))
      : h('p', { class: 'hint' }, 'Recept nema nijedan sastojak sa artiklom i količinom.'),
    c.skipped.length > 0 && h('p', { class: 'hint' }, 'Preskočeno: ', c.skipped.map((s) => `${s.name} (${PROBLEM[s.problem]})`).join(', '), '. Dopuni recept da se i to računa.'),
    h('div', { class: 'row' },
      h('input', { id: 'cook-date', type: 'date', value: c.date, 'aria-label': 'Datum kuvanja', oninput: (e) => { c.date = e.target.value || today(); } }),
      h('span', { class: 'num cost' }, `≈ ${formatRSD(cost)} RSD`)),
    h('div', { class: 'entry-actions' },
      h('button', { type: 'button', class: 'ghost', onclick: () => { ui.cook = null; ctx.render(); } }, 'Odustani'),
      h('button', { type: 'button', class: 'primary', onclick: () => {
        const recipe = state.rows.recipes.find((r) => r.id === c.recipeId);
        ctx.run(async () => {
          await state.store.add('cooking', {
            date: c.date, recipeId: c.recipeId, recipeName: recipe?.name ?? '', servings: c.servings,
            consumption: c.lines.filter((l) => l.qty > 0).map((l) => ({ itemId: l.itemId, qty: l.qty })),
          });
          const planned = c.planId && state.rows.mealPlan.find((m) => m.id === c.planId);
          if (planned) { const { id, ...body } = planned; await state.store.put('mealPlan', id, { ...body, done: true }); }
          ui.cook = null;
        }, `Zabeleženo: ${recipe?.name ?? 'jelo'}`);
      } }, 'Zabeleži kuvanje')));
}

// ---------- Recepti ----------

function recipes(ctx) {
  if (ui.edit) return editor(ctx);
  const { state } = ctx;
  const items = state.rows.items;
  const day = today();
  const groups = MEALS.map(([meal, label]) => {
    const list = state.rows.recipes.filter((r) => (r.meal ?? 'ostalo') === meal).sort((a, b) => a.name.localeCompare(b.name, 'sr'));
    if (!list.length) return null;
    return h('section', { class: 'panel' }, h('h2', {}, label),
      h('ul', { class: 'list' }, list.map((r) => {
        const cost = recipeCost(r, items, state.rows.purchases, day);
        const todo = (r.ingredients ?? []).filter((i) => resolveIngredient(i, items).problem).length;
        return h('li', { class: 'tap', tabindex: '0', onclick: () => openEditor(ctx, r), onkeydown: (e) => { if (e.key === 'Enter') openEditor(ctx, r); } },
          h('span', {}, r.name, todo ? h('span', { class: 'pill warn' }, `dopuni ${todo}`) : null,
            h('small', {}, `${r.servings || 1} porc. · ${(r.ingredients ?? []).length} sastojaka`),
            cost.missing.length > 0 && !todo ? h('small', {}, `bez cene: ${cost.missing.join(', ')}`) : null),
          h('span', { class: 'num' }, cost.total ? `${formatRSD(cost.perServing)}` : '–', h('small', {}, 'po porciji')));
      })));
  });
  return h('div', { class: 'stack' },
    h('button', { type: 'button', class: 'ghost', onclick: () => openEditor(ctx, null) }, '+ Novi recept'),
    groups.some(Boolean) ? groups : h('div', { class: 'empty' }, h('p', {}, 'Još nema recepata.')));
}

function openEditor(ctx, r) {
  const items = ctx.state.rows.items;
  ui.confirm = null;
  ui.edit = r
    ? {
      id: r.id, name: r.name, meal: r.meal ?? 'ostalo', servings: r.servings || 1, prep: r.prep ?? '',
      ingredients: (r.ingredients ?? []).map((i) => ({ ...i, itemId: i.itemId ?? resolveIngredient(i, items).itemId ?? '' })),
    }
    : { id: null, name: '', meal: 'rucak', servings: 4, prep: '', ingredients: [{ name: '', itemId: '', qty: null, unit: 'g' }] };
  ctx.render();
}

function editor(ctx) {
  const { state } = ctx;
  const e = ui.edit;
  const items = [...state.rows.items].sort((a, b) => a.name.localeCompare(b.name, 'sr'));
  const ingRow = (ing, i) => h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('select', { id: `ing-${i}-item`, 'aria-label': 'Artikal', onchange: (ev) => {
        ing.itemId = ev.target.value;
        const it = state.rows.items.find((x) => x.id === ing.itemId);
        if (it && !ing.name) ing.name = it.name;
        ctx.render();
      } },
      h('option', { value: '' }, `Bez artikla${ing.name ? `: ${ing.name}` : ''}`),
      items.map((it) => h('option', { value: it.id, selected: it.id === ing.itemId }, it.name))),
      h('button', { type: 'button', class: 'icon', 'aria-label': 'Ukloni sastojak', onclick: () => { e.ingredients.splice(i, 1); ctx.render(); } }, '×')),
    h('div', { class: 'row nums ing' },
      h('input', { id: `ing-${i}-name`, value: ing.name ?? '', placeholder: 'naziv', 'aria-label': 'Naziv sastojka', oninput: (ev) => { ing.name = ev.target.value; } }),
      h('input', { id: `ing-${i}-qty`, type: 'number', step: 'any', inputmode: 'decimal', value: ing.qty ?? '', placeholder: 'kol.', 'aria-label': 'Količina',
        oninput: (ev) => { ing.qty = ev.target.value === '' ? null : Number(ev.target.value); } }),
      h('select', { id: `ing-${i}-unit`, 'aria-label': 'Jedinica', onchange: (ev) => { ing.unit = ev.target.value; } },
        UNITS.map((u) => h('option', { value: u, selected: u === (ing.unit ?? state.rows.items.find((x) => x.id === ing.itemId)?.unit) }, u)))),
    (() => {
      const p = resolveIngredient(ing, state.rows.items).problem;
      return p ? h('p', { class: 'hint warn-text' }, PROBLEM[p]) : null;
    })());

  const save = () => {
    if (!e.name.trim()) { ctx.toast('Upiši naziv jela.'); return; }
    const taken = new Set(state.rows.recipes.map((r) => r.id));
    let id = e.id;
    if (!id) {
      const base = normalize(e.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recept';
      id = base; let n = 2; while (taken.has(id)) id = `${base}-${n++}`;
    }
    const body = {
      name: e.name.trim(), meal: e.meal, servings: Math.max(Number(e.servings) || 1, 1), prep: e.prep,
      ingredients: e.ingredients.filter((i) => i.itemId || (i.name ?? '').trim())
        .map((i) => ({ name: (i.name ?? '').trim() || (state.rows.items.find((x) => x.id === i.itemId)?.name ?? ''), itemId: i.itemId || null,
          qty: i.qty === null || i.qty === '' ? null : Number(i.qty), unit: i.unit ?? state.rows.items.find((x) => x.id === i.itemId)?.unit ?? null })),
    };
    ctx.run(async () => { await state.store.put('recipes', id, body); ui.edit = null; }, 'Recept sačuvan');
  };

  return h('section', { class: 'panel' },
    h('h2', {}, e.id ? 'Izmena recepta' : 'Novi recept'),
    h('input', { id: 'rec-name', value: e.name, placeholder: 'Naziv jela, npr. Sarma', 'aria-label': 'Naziv jela', oninput: (ev) => { e.name = ev.target.value; } }),
    h('div', { class: 'row' },
      h('select', { id: 'rec-meal', 'aria-label': 'Obrok', onchange: (ev) => { e.meal = ev.target.value; } },
        MEALS.map(([v, l]) => h('option', { value: v, selected: v === e.meal }, l))),
      h('label', { class: 'money servings' },
        h('input', { id: 'rec-servings', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: e.servings, 'aria-label': 'Broj porcija', oninput: (ev) => { e.servings = ev.target.value; } }),
        h('span', {}, 'porc.'))),
    h('p', { class: 'eyebrow' }, 'Sastojci (za ceo recept)'),
    e.ingredients.map(ingRow),
    h('button', { type: 'button', class: 'ghost', onclick: () => { e.ingredients.push({ name: '', itemId: '', qty: null, unit: 'g' }); ctx.render(); } }, '+ Sastojak'),
    h('textarea', { id: 'rec-prep', rows: 3, placeholder: 'Priprema (nije obavezno)', 'aria-label': 'Priprema', oninput: (ev) => { e.prep = ev.target.value; } }, e.prep),
    h('div', { class: 'entry-actions' },
      e.id && (ui.confirm === `rec-${e.id}`
        ? h('button', { type: 'button', class: 'danger', onclick: () => ctx.run(async () => { await state.store.remove('recipes', e.id); ui.edit = null; ui.confirm = null; }, 'Recept obrisan') }, 'Da, obriši')
        : h('button', { type: 'button', class: 'ghost', onclick: () => { ui.confirm = `rec-${e.id}`; ctx.render(); } }, 'Obriši')),
      h('button', { type: 'button', class: 'ghost', onclick: () => { ui.edit = null; ctx.render(); } }, 'Zatvori'),
      h('button', { type: 'button', class: 'primary', onclick: save }, 'Sačuvaj')));
}

// ---------- Polica ----------

function pantry(ctx) {
  const { state } = ctx;
  const rows = shelf(state.rows.items, state.rows.categories, state.rows.purchases, state.rows.cooking, state.rows.stockAdjust, { from: shelfFrom(today()) });
  const wasteMonth = state.rows.stockAdjust.filter((a) => a.reason === 'baceno' && monthKey(a.date) === state.month)
    .reduce((s, a) => s + (Number(a.delta) || 0) * (priceOf(ctx, a.itemId, a.date) ?? 0), 0);
  if (!rows.length) {
    return h('div', { class: 'empty' }, h('p', {}, 'U poslednjih 30 dana nema kupljenih namirnica. Polica se puni kad kupuješ (Primarno, Pijaca, Dopunske, Delikates, Sirni proizvodi), a prazni kad zabeležiš kuvanje.'));
  }
  const add = (itemId, delta, reason, ok) => ctx.run(async () => {
    await state.store.add('stockAdjust', { date: today(), itemId, delta, reason });
    ui.shelfOpen = null; ui.shelfInput = {};
  }, ok);
  return h('div', { class: 'stack' },
    h('p', { class: 'hint' }, 'Procena za poslednjih 30 dana: kupljeno − skuvano − bačeno. Dodirni namirnicu da upišeš koliko je stvarno ostalo ili koliko je bačeno.'),
    wasteMonth > 0 && h('p', { class: 'sum' }, 'Bačeno ovog meseca: ', h('strong', {}, `≈ ${formatRSD(wasteMonth)} RSD`)),
    h('section', { class: 'panel' }, h('ul', { class: 'list' }, rows.map((r) => {
      const open = ui.shelfOpen === r.itemId;
      const head = [
        h('span', {}, r.name, r.check ? h('span', { class: 'pill warn' }, 'proveri') : null,
          h('small', {}, `kupljeno ${qtyLabel(r.bought, r.unit)} · skuvano ${qtyLabel(r.used, r.unit)}${r.wasted ? ` · bačeno ${qtyLabel(r.wasted, r.unit)}` : ''}`)),
        h('span', { class: 'num' }, `≈ ${qtyLabel(r.left, r.unit)}`),
      ];
      if (!open) {
        return h('li', { class: 'tap', tabindex: '0', onclick: () => { ui.shelfOpen = r.itemId; ui.shelfInput = {}; ctx.render(); },
          onkeydown: (e) => { if (e.key === 'Enter') { ui.shelfOpen = r.itemId; ctx.render(); } } }, head);
      }
      const inp = ui.shelfInput;
      return h('li', { class: 'editor' },
        h('div', { class: 'row spread' }, head),
        h('div', { class: 'row nums' },
          h('label', { class: 'money' },
            h('input', { id: `shelf-left-${r.itemId}`, type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'stvarno ostalo', 'aria-label': 'Stvarno ostalo', value: inp.left ?? '', oninput: (e) => { inp.left = e.target.value; } }),
            h('span', {}, r.unit)),
          h('button', { type: 'button', class: 'ghost', onclick: () => {
            if (inp.left === undefined || inp.left === '') return;
            const delta = Number(inp.left) - r.left;
            add(r.itemId, Math.round(delta * 1e4) / 1e4, 'popis', 'Polica ispravljena');
          } }, 'Upiši')),
        h('div', { class: 'row nums' },
          h('label', { class: 'money' },
            h('input', { id: `shelf-waste-${r.itemId}`, type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'bačeno', 'aria-label': 'Bačeno', value: inp.waste ?? '', oninput: (e) => { inp.waste = e.target.value; } }),
            h('span', {}, r.unit)),
          h('button', { type: 'button', class: 'ghost', onclick: () => {
            if (!(Number(inp.waste) > 0)) return;
            add(r.itemId, Number(inp.waste), 'baceno', 'Otpad zabeležen');
          } }, 'Bačeno')),
        h('button', { type: 'button', class: 'link', onclick: () => { ui.shelfOpen = null; ctx.render(); } }, 'Zatvori'));
    }))));
}

// ---------- Plan obroka ----------

const MEAL_ORDER = Object.fromEntries(MEALS.map(([v], i) => [v, i]));
const SHORT_MONTH = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const shortDay = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d}. ${SHORT_MONTH[m - 1]}`; };

function defaultServings() {
  try { return Number(localStorage.getItem('kt-servings')) || 4; } catch { return 4; }
}
function boughtSet(week) {
  try { return new Set(JSON.parse(localStorage.getItem(`kt-kupljeno-${week}`) || '[]')); } catch { return new Set(); }
}
function saveBought(week, set) {
  try { localStorage.setItem(`kt-kupljeno-${week}`, JSON.stringify([...set])); } catch {}
}

function planView(ctx) {
  const { state } = ctx;
  if (!ui.week) ui.week = weekStart(today());
  const days = weekDays(ui.week);
  const shift = (n) => {
    const d = new Date(`${ui.week}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * n);
    ui.week = d.toISOString().slice(0, 10);
    ui.add = null;
    ctx.render();
  };
  const entries = state.rows.mealPlan.filter((m) => m.date >= days[0] && m.date <= days[6]);
  const recipesSorted = [...state.rows.recipes].sort((a, b) => a.name.localeCompare(b.name, 'sr'));

  const nav = h('div', { class: 'row spread weeknav' },
    h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Prethodna nedelja', onclick: () => shift(-1) }, '‹'),
    h('strong', {}, `${shortDay(days[0])} – ${shortDay(days[6])}`),
    h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Sledeća nedelja', onclick: () => shift(1) }, '›'));

  const addForm = (date) => {
    const a = ui.add;
    const save = () => {
      const r = state.rows.recipes.find((x) => x.id === a.recipeId);
      const n = Math.max(Number(a.servings) || 1, 1);
      if (!r) { ctx.toast('Izaberi jelo.'); return; }
      try { localStorage.setItem('kt-servings', String(n)); } catch {}
      ctx.run(async () => {
        await state.store.add('mealPlan', { date, meal: a.meal, recipeId: r.id, recipeName: r.name, servings: n, done: false });
        ui.add = null;
      }, `${r.name} je u planu`);
    };
    return h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('select', { id: 'plan-meal', 'aria-label': 'Obrok', onchange: (e) => { a.meal = e.target.value; } },
          MEALS.map(([v, l]) => h('option', { value: v, selected: v === a.meal }, l))),
        h('label', { class: 'money servings' },
          h('input', { id: 'plan-servings', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: a.servings, 'aria-label': 'Broj porcija', oninput: (e) => { a.servings = e.target.value; } }),
          h('span', {}, 'porc.'))),
      h('select', { id: 'plan-recipe', 'aria-label': 'Jelo', onchange: (e) => { a.recipeId = e.target.value; } },
        h('option', { value: '' }, 'Izaberi jelo…'),
        recipesSorted.map((r) => h('option', { value: r.id, selected: r.id === a.recipeId }, r.name))),
      h('div', { class: 'entry-actions' },
        h('button', { type: 'button', class: 'ghost', onclick: () => { ui.add = null; ctx.render(); } }, 'Odustani'),
        h('button', { type: 'button', class: 'primary', onclick: save }, 'Dodaj')));
  };

  const cookFromPlan = (m) => {
    ui.cook = null;
    startCook(ctx, m.recipeId, m.servings, m.id);
    if (ui.cook) ui.cook.date = m.date <= today() ? m.date : today();
    ui.sub = 'kuvanje';
    ctx.render();
    window.scrollTo(0, 0);
  };

  const dayBlocks = days.map((date) => {
    const list = entries.filter((m) => m.date === date).sort((x, y) => (MEAL_ORDER[x.meal] ?? 9) - (MEAL_ORDER[y.meal] ?? 9));
    const isToday = date === today();
    return h('section', { class: `panel day-plan${isToday ? ' today' : ''}` },
      h('h2', { class: 'day' }, dayLabel(date), isToday ? h('span', { class: 'pill warn' }, 'danas') : null),
      list.length ? h('ul', { class: 'list' }, list.map((m) => h('li', { class: m.done ? 'paid' : '' },
        h('span', {}, m.recipeName,
          h('small', {}, `${MEALS.find(([v]) => v === m.meal)?.[1] ?? ''} · ${m.servings} porc.${m.done ? ' · skuvano' : ''}`)),
        h('span', { class: 'row qty' },
          !m.done && h('button', { type: 'button', class: 'ghost small', onclick: () => cookFromPlan(m) }, 'Skuvano'),
          ui.confirm === `plan-${m.id}`
            ? h('button', { type: 'button', class: 'danger small', onclick: () => ctx.run(async () => { await state.store.remove('mealPlan', m.id); ui.confirm = null; }, 'Uklonjeno iz plana') }, 'Ukloni')
            : h('button', { type: 'button', class: 'icon', 'aria-label': `Ukloni ${m.recipeName} iz plana`, onclick: () => { ui.confirm = `plan-${m.id}`; ctx.render(); } }, '×'))))) : null,
      ui.add?.date === date
        ? addForm(date)
        : h('button', { type: 'button', class: 'link small', onclick: () => { ui.add = { date, meal: 'rucak', recipeId: '', servings: defaultServings() }; ctx.render(); } }, '+ obrok'));
  });

  return h('div', { class: 'stack' }, nav,
    !recipesSorted.length && h('p', { class: 'hint' }, 'Prvo dodaj recepte (deo Recepti), pa ih rasporedi po danima.'),
    shopping(ctx, entries), dayBlocks);
}

function shopping(ctx, entries) {
  const { state } = ctx;
  const open = entries.filter((m) => !m.done);
  if (!open.length) {
    return h('section', { class: 'panel' }, h('h2', {}, 'Spisak za kupovinu'),
      h('p', { class: 'hint' }, 'Dodaj obroke za ovu nedelju; spisak se pravi sam, umanjen za ono što je već na polici.'));
  }
  const shelfRows = shelf(state.rows.items, state.rows.categories, state.rows.purchases, state.rows.cooking, state.rows.stockAdjust, { from: shelfFrom(today()) });
  const list = shoppingList(open, { recipes: state.rows.recipes, items: state.rows.items, shelfRows, purchases: state.rows.purchases }, today());
  const bought = boughtSet(ui.week);
  const toBuy = list.lines.filter((l) => l.buy > 0);
  const have = list.lines.filter((l) => l.buy === 0);
  const copy = () => {
    const text = listText(list);
    const done = () => ctx.toast('Spisak je kopiran.');
    const fail = () => ctx.toast('Kopiranje nije uspelo.');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fail); else fail();
  };
  const toggle = (id) => {
    if (bought.has(id)) bought.delete(id); else bought.add(id);
    saveBought(ui.week, bought);
    ctx.render();
  };
  const planned = `${open.length} ${open.length === 1 ? 'planiran obrok' : 'planiranih obroka'}`;
  return h('section', { class: 'panel' },
    h('h2', {}, 'Spisak za kupovinu', h('span', { class: 'num' }, `≈ ${formatRSD(list.total)} RSD`)),
    h('p', { class: 'hint' }, `Za ${planned}, umanjeno za ono što je na polici.${list.unpriced ? ` Bez cene: ${list.unpriced} (još nisu kupovani).` : ''}`),
    toBuy.length
      ? h('ul', { class: 'list bills' }, toBuy.map((l) => h('li', { class: bought.has(l.itemId) ? 'paid' : '' },
        h('label', { class: 'check' },
          h('input', { id: `buy-${l.itemId}`, type: 'checkbox', checked: bought.has(l.itemId), onchange: () => toggle(l.itemId) }),
          h('span', {}, l.name, h('small', {}, l.have > 0 ? `treba ${formatQty(l.need, l.unit)}, imaš ${formatQty(l.have, l.unit)}` : `treba ${formatQty(l.need, l.unit)}`))),
        h('span', { class: 'num' }, formatQty(l.buy, l.unit), h('small', {}, l.cost === null ? 'bez cene' : `≈ ${formatRSD(l.cost)}`)))))
      : h('p', { class: 'hint' }, 'Sve što treba već je na polici.'),
    have.length > 0 && h('p', { class: 'hint' }, `Već imaš: ${have.map((l) => l.name).join(', ')}.`),
    list.missing.length > 0 && h('p', { class: 'hint warn-text' }, 'Dopuni recept: ', list.missing.map((m) => `${m.recipe} – ${m.ingredient}`).join('; '), '.'),
    toBuy.length > 0 && h('div', { class: 'entry-actions' },
      h('button', { type: 'button', class: 'ghost', onclick: copy }, 'Kopiraj spisak')));
}
