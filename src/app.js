// Kućni Trošak: pokretanje, stanje, tabovi.
import { createStore, ensureMonthPayments } from './store.js';
import { monthKey } from './totals.js';
import { h, monthLabel, monthShort, shiftMonth } from './ui/dom.js';
import { createEntry } from './ui/entry.js';
import { renderHome } from './ui/home.js';
import { renderPurchases } from './ui/purchases.js';
import { renderBills } from './ui/bills.js';
import { renderKitchen } from './ui/kitchen.js';
import { renderAnalysis } from './ui/analysis.js';
import { renderSettings } from './ui/settings.js';
import { createLocalStore } from './platform/local-store.js';
import { createSpeechDictation } from './platform/speech.js';
import { createGitHub, syncAll } from './sync.js';

const COLLECTIONS = ['categories', 'items', 'purchases', 'payments', 'income', 'bills', 'recipes', 'cooking', 'stockAdjust', 'mealPlan'];
const TABS = [
  ['home', 'Početna'], ['kupovina', 'Kupovina'], ['racuni', 'Računi'], ['kuhinja', 'Kuhinja'], ['analiza', 'Analiza'],
];

const state = {
  month: monthKey(new Date()),
  tab: 'home',
  status: 'loading', // loading | ready | slow | signin | private | error
  rows: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
  loaded: new Set(),
  store: null,
  caps: { dictation: null, sample: null },
  filter: null,
  ensured: new Set(),
  local: false, // true u aplikaciji sa GitHub-a (podaci na uređaju + sinhronizacija)
  syncReady: true,
};

const $ = (id) => document.getElementById(id);

export function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}

const ctx = {
  state,
  platform: null,
  toast,
  get items() { return Object.fromEntries(state.rows.items.map((i) => [i.id, i])); },
  get categories() { return Object.fromEntries(state.rows.categories.map((c) => [c.id, c])); },
  setMonth(m) { state.month = m; render(); },
  setTab(t) { state.tab = t; try { localStorage.setItem('kt-tab', t); } catch {} render(); window.scrollTo(0, 0); },
  setFilter(f) { state.filter = f; render(); },
  render: () => render(),
  async run(fn, okText) {
    try { await fn(); if (okText) toast(okText); } catch (e) {
      console.error(e);
      toast(e?.code === 'quota_exceeded' ? 'Baza je puna. Obriši stare stavke pa pokušaj ponovo.' : 'Nije sačuvano. Proveri vezu i pokušaj ponovo.');
    }
  },
};

let entry = null;

function renderHeader() {
  $('month-label').textContent = monthShort(state.month);
  $('month-label').title = monthLabel(state.month);
  $('settings-btn').classList.toggle('warn', !!ctx.platform && ['off', 'error'].includes(ctx.platform.syncState.status));
  $('month-switch').hidden = !['home', 'kupovina', 'racuni', 'kuhinja', 'analiza'].includes(state.tab);
  for (const btn of document.querySelectorAll('#tabs button')) {
    btn.setAttribute('aria-current', btn.dataset.tab === state.tab ? 'page' : 'false');
  }
}

function renderStatus() {
  const s = $('status');
  const msg = {
    loading: null,
    slow: 'Podaci se još ne učitavaju. Proveri internet vezu; aplikacija će se sama osvežiti kad stignu.',
    signin: 'Prijavi se na claude.ai da bi aplikacija mogla da čuva i čita tvoje podatke.',
    private: 'Ova aplikacija je privatna. Podatke vidi i menja samo vlasnik.',
    error: 'Veza sa bazom je prekinuta. Zatvori i ponovo otvori aplikaciju.',
  }[state.status];
  s.hidden = !msg;
  s.textContent = msg ?? '';
}

function maybeEnsurePayments() {
  const current = monthKey(new Date());
  if (state.month !== current || state.ensured.has(current)) return;
  if (state.local && !state.syncReady) return;
  if (!state.loaded.has('bills') || !state.loaded.has('payments') || !state.store) return;
  state.ensured.add(current);
  ensureMonthPayments(state.store, state.rows.bills, state.rows.payments, current).catch(console.error);
}

function render() {
  renderHeader();
  renderStatus();
  const usable = state.status === 'ready' || state.status === 'slow' || state.status === 'loading';
  $('entry-slot').hidden = !(state.tab === 'home' && usable && state.store);
  if (entry) entry.refresh();
  const view = $('view');
  view.replaceChildren();
  if (!usable) return;
  maybeEnsurePayments();
  const fn = { home: renderHome, kupovina: renderPurchases, racuni: renderBills, kuhinja: renderKitchen, analiza: renderAnalysis, podesavanja: renderSettings }[state.tab];
  view.append(fn(ctx));
}

async function boot() {
  try { const t = localStorage.getItem('kt-tab'); if (TABS.some(([id]) => id === t)) state.tab = t; } catch {}
  $('tabs').replaceChildren(...TABS.map(([id, label]) =>
    h('button', { type: 'button', 'data-tab': id, onclick: () => ctx.setTab(id) }, label)));
  $('prev').onclick = () => ctx.setMonth(shiftMonth(state.month, -1));
  $('next').onclick = () => ctx.setMonth(shiftMonth(state.month, 1));
  render();

  const claude = window.claude;
  if (!claude?.use) return bootLocal();
  const [user, db] = await Promise.all([claude.use('user'), claude.use('db')]);
  if (!db) { state.status = 'signin'; return render(); }
  if (user && (await user.isOwner().catch(() => true)) === false) { state.status = 'private'; return render(); }

  state.store = createStore(db);
  entry = createEntry(ctx, $('entry-slot'));
  claude.use('dictation').then((d) => { state.caps.dictation = d; state.caps.dictationChecked = true; entry.refresh(); });
  claude.use('sample').then((s) => { state.caps.sample = s; entry.refresh(); });

  subscribeAll();
}

function subscribeAll() {
  const slowTimer = setTimeout(() => {
    if (state.status === 'loading') { state.status = 'slow'; render(); }
  }, 10000);

  for (const name of COLLECTIONS) {
    state.store.subscribe(name, (rows, meta) => {
      state.rows[name] = rows;
      if (!meta?.fromCache) state.loaded.add(name);
      if (state.loaded.size === COLLECTIONS.length && state.status !== 'error') {
        clearTimeout(slowTimer);
        state.status = 'ready';
      }
      render();
    }, (err) => {
      console.error(name, err);
      clearTimeout(slowTimer);
      state.status = 'error';
      render();
    });
  }
}

const SYNC_KEY = 'kt-sync';
const SYNC_LAST = 'kt-sync-last';

function syncError(e) {
  if (e?.status === 401) return 'token ne važi ili je istekao';
  if (e?.status === 404) return 'repo nije pronađen ili token nema pristup';
  if (e?.status === 403) return 'token nema dozvolu za pisanje';
  return 'nema veze sa GitHub-om';
}

function bootLocal() {
  state.local = true;
  const platform = { collections: COLLECTIONS, syncState: { status: 'off', last: null, message: '' } };
  let timer = null;
  let running = null;
  const store = createLocalStore(localStorage, {
    onChange: () => { clearTimeout(timer); timer = setTimeout(() => platform.runSync(), 5000); },
  });
  platform.store = store;
  platform.syncConfig = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch { return null; } };
  platform.setSyncConfig = (c) => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(c)); } catch {} };
  try { platform.syncState.last = Number(localStorage.getItem(SYNC_LAST)) || null; } catch {}
  platform.runSync = (loud = false) => {
    const cfg = platform.syncConfig();
    if (!cfg?.token) { platform.syncState.status = 'off'; state.syncReady = true; render(); return Promise.resolve(); }
    if (running) return running;
    platform.syncState.status = 'syncing';
    render();
    running = (async () => {
      try {
        const r = await syncAll(store, createGitHub(cfg), COLLECTIONS);
        Object.assign(platform.syncState, { status: 'idle', last: Date.now(), message: '' });
        try { localStorage.setItem(SYNC_LAST, String(platform.syncState.last)); } catch {}
        if (loud) toast(r.pulled || r.pushed ? `Sinhronizovano: preuzeto ${r.pulled}, poslato ${r.pushed}.` : 'Sve je već sinhronizovano.');
      } catch (e) {
        console.error(e);
        Object.assign(platform.syncState, { status: 'error', message: syncError(e) });
        if (loud) toast(`Sinhronizacija nije uspela: ${syncError(e)}.`);
      } finally {
        running = null;
        state.syncReady = true;
        render();
      }
    })();
    return running;
  };
  ctx.platform = platform;
  state.store = store;
  state.syncReady = !platform.syncConfig()?.token;
  state.caps.dictation = createSpeechDictation(window);
  state.caps.dictationChecked = true;
  const gear = $('settings-btn');
  gear.hidden = false;
  gear.onclick = () => ctx.setTab('podesavanja');
  entry = createEntry(ctx, $('entry-slot'));
  subscribeAll();
  platform.runSync();
  window.addEventListener('online', () => platform.runSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (platform.syncState.last || 0) > 60000) platform.runSync();
  });
  navigator.storage?.persist?.().catch(() => {});
}

boot();
