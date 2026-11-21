// Podešavanja (samo u aplikaciji sa GitHub-a): sinhronizacija, rezervna kopija, glas.
import { mergeCollection } from '../sync.js';
import { h } from './dom.js';

const draft = { owner: null, repo: null, token: '' };

function timeLabel(ts) {
  if (!ts) return 'nikad';
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}. u ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function renderSettings(ctx) {
  const p = ctx.platform;
  const cfg = p.syncConfig() ?? {};
  if (draft.owner === null) { draft.owner = cfg.owner ?? ''; draft.repo = cfg.repo ?? 'home-tracker'; }
  const s = p.syncState;
  const statusText = {
    off: 'Sinhronizacija nije podešena. Podaci su samo na ovom telefonu.',
    idle: `Sinhronizovano: ${timeLabel(s.last)}.`,
    syncing: 'Sinhronizujem…',
    error: `Greška: ${s.message}`,
  }[s.status];

  const sync = h('section', { class: 'panel' },
    h('h2', {}, 'Kopija na GitHub-u'),
    h('p', { class: `hint ${s.status === 'error' ? 'warn-text' : ''}` }, statusText),
    h('form', {
      class: 'add-income',
      onsubmit: (e) => {
        e.preventDefault();
        if (!draft.owner.trim() || !draft.repo.trim() || (!draft.token.trim() && !cfg.token)) { ctx.toast('Upiši korisnika, repo i token.'); return; }
        p.setSyncConfig({ owner: draft.owner.trim(), repo: draft.repo.trim(), token: draft.token.trim() || cfg.token });
        draft.token = '';
        p.runSync(true);
      },
    },
    h('label', { class: 'eyebrow', for: 'gh-owner' }, 'GitHub korisnik'),
    h('input', { id: 'gh-owner', value: draft.owner, autocomplete: 'off', autocapitalize: 'off', oninput: (e) => { draft.owner = e.target.value; } }),
    h('label', { class: 'eyebrow', for: 'gh-repo' }, 'Privatni repo za podatke'),
    h('input', { id: 'gh-repo', value: draft.repo, autocomplete: 'off', autocapitalize: 'off', oninput: (e) => { draft.repo = e.target.value; } }),
    h('label', { class: 'eyebrow', for: 'gh-token' }, cfg.token ? 'Token (sačuvan; upiši novi samo ako menjaš)' : 'Token'),
    h('input', { id: 'gh-token', type: 'password', value: draft.token, autocomplete: 'off', placeholder: cfg.token ? '••••••••' : 'github_pat_…', oninput: (e) => { draft.token = e.target.value; } }),
    h('p', { class: 'hint' }, 'Token se čuva samo na ovom telefonu i služi isključivo za repo sa podacima.'),
    h('div', { class: 'entry-actions' },
      cfg.token && h('button', { type: 'button', class: 'ghost', disabled: s.status === 'syncing', onclick: () => p.runSync(true) }, 'Sinhronizuj sada'),
      h('button', { type: 'submit', class: 'primary' }, 'Sačuvaj i sinhronizuj'))));

  const importFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      let n = 0;
      for (const name of p.collections) {
        if (!data[name]) continue;
        const r = mergeCollection(p.store.raw(name), data[name]);
        if (r.changedLocal) { p.store.replaceRaw(name, r.merged); n++; }
      }
      ctx.toast(n ? `Uvezeno (${n} kolekcija izmenjeno).` : 'Ništa novo u fajlu.');
      p.runSync();
    } catch { ctx.toast('Fajl nije ispravna rezervna kopija.'); }
    e.target.value = '';
  };

  const backup = h('section', { class: 'panel' },
    h('h2', {}, 'Rezervna kopija u fajlu'),
    h('p', { class: 'hint' }, 'Fajl sa svim podacima. Uvoz spaja podatke iz fajla sa onima na telefonu (novija izmena pobeđuje).'),
    h('div', { class: 'entry-actions' },
      h('button', {
        type: 'button', class: 'ghost',
        onclick: () => {
          const blob = new Blob([JSON.stringify(p.store.exportAll(p.collections), null, 1)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `kucni-trosak-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
        },
      }, 'Izvezi fajl'),
      h('label', { class: 'ghost filebtn' }, 'Uvezi fajl',
        h('input', { id: 'import-file', type: 'file', accept: 'application/json,.json', hidden: true, onchange: importFile }))));

  const voice = h('section', { class: 'panel' },
    h('h2', {}, 'Glas'),
    h('p', { class: 'hint' }, ctx.state.caps.dictation
      ? 'Dugme „Diktiraj“ koristi prepoznavanje govora iz Chrome-a, na srpskom. Prvi put će tražiti dozvolu za mikrofon.'
      : 'Ovaj pregledač nema prepoznavanje govora. Koristi mikrofon na tastaturi ili otvori aplikaciju u Chrome-u.'));

  return h('div', { class: 'stack' }, sync, voice, backup,
    h('button', { type: 'button', class: 'link', onclick: () => ctx.setTab('home') }, '← Nazad'));
}
