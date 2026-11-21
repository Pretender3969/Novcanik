// Parser brzog unosa: "jaja 30 komada 600 dinara, hleb 80" → stavke.
import { normalize, nameKey } from './normalize.js';

const UNIT_WORDS = {
  kom: 'kom', komad: 'kom', komada: 'kom', komadi: 'kom', kmd: 'kom',
  kg: 'kg', kila: 'kg', kile: 'kg', kilo: 'kg', kilograma: 'kg',
  g: 'g', gr: 'g', grama: 'g',
  l: 'l', litar: 'l', litra: 'l', litre: 'l', litara: 'l',
  ml: 'ml',
};
const CURRENCY = new Set(['din', 'dinara', 'dinar', 'rsd']);
const SPLIT = /,(?!\d)|;|\n|\s+pa\s+/;
const NUM = /^(\d+(?:[.,]\d+)?)([a-z]+)?$/;

const toNum = (s) => Number(s.replace(',', '.'));

// Voće i povrće se meri (kg); sve ostalo bez jedinice je komad.
const PRODUCE = ['krompir', 'paradajz', 'paprik', 'krastav', 'luk', 'kupus', 'sargarep', 'tikvic', 'patlidzan',
  'karfiol', 'brokol', 'spanac', 'blitv', 'cvekl', 'celer', 'jabuk', 'krusk', 'banan', 'pomorandz', 'mandarin',
  'limun', 'grozdj', 'breskv', 'kajsij', 'sljiv', 'tresnj', 'visnj', 'jagod', 'lubenic', 'dinj', 'kivi'];

export function suggestUnit(name, categoryId) {
  if (categoryId === 'pijaca-voce') return 'kg';
  const words = normalize(name).split(' ');
  return words.some((w) => PRODUCE.some((p) => w.startsWith(p))) ? 'kg' : 'kom';
}

/** Ključ naziva artikla bez brojeva i jedinica ("Sir 1 kg" → "sir"). */
function itemKeys(item) {
  return [item.name, ...(item.synonyms ?? [])]
    .map((n) => normalize(n).split(' ')
      .filter((t) => t && !/\d/.test(t) && !UNIT_WORDS[t])
      .join(' '))
    .filter(Boolean)
    .map(nameKey);
}

export function matchItem(name, catalog) {
  const key = nameKey(name);
  if (!key) return null;
  let best = null;
  let bestLen = 0;
  for (const item of catalog) {
    for (const k of itemKeys(item)) {
      if (k === key) return item;
      if (` ${key} `.includes(` ${k} `) && k.length > bestLen) { best = item; bestLen = k.length; }
    }
  }
  return best;
}

function parseLine(raw, catalog) {
  const tokens = normalize(raw).split(' ').filter(Boolean);
  const nameParts = [];
  const bare = [];
  let qty = null, unit = null, total = null;

  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(NUM);
    if (!m) { if (!CURRENCY.has(tokens[i])) nameParts.push(tokens[i]); continue; }
    const value = toNum(m[1]);
    const suffix = m[2] ?? tokens[i + 1];
    const consumed = !m[2];
    if (suffix && CURRENCY.has(suffix)) { total = value; if (consumed) i++; }
    else if (suffix && UNIT_WORDS[suffix]) { qty = value; unit = UNIT_WORDS[suffix]; if (consumed) i++; }
    else bare.push(value);
  }

  if (bare.length >= 2 && qty === null && total === null) { qty = bare[0]; total = bare[1]; }
  else for (const v of bare) { if (total === null) total = v; else if (qty === null) qty = v; }

  const name = nameParts.join(' ');
  const item = matchItem(name, catalog);
  const baseUnit = item?.unit ?? suggestUnit(name);
  return {
    raw: raw.trim(),
    name,
    itemId: item?.id ?? null,
    qty: qty ?? 1,
    unit: unit ?? baseUnit,
    total,
    confident: item !== null && total !== null,
  };
}

export function parseEntry(text, catalog) {
  const lines = String(text ?? '').split(SPLIT)
    .filter((s) => s && s.trim())
    .map((s) => parseLine(s, catalog));
  return { lines, confident: lines.length > 0 && lines.every((l) => l.confident) };
}

export function toBaseQty(qty, unit, baseUnit) {
  if ((unit === 'g' && baseUnit === 'kg') || (unit === 'ml' && baseUnit === 'l')) return qty / 1000;
  return qty;
}
