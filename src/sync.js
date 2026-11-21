// Sinhronizacija sa privatnim GitHub repoom: jedan JSON fajl po kolekciji (data/<ime>.json).

export function mergeCollection(local, remote) {
  const merged = {};
  let changedLocal = false;
  let changedRemote = false;
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[id];
    const r = remote[id];
    if (l && (!r || (l._u ?? 0) >= (r._u ?? 0))) {
      merged[id] = l;
      if (!r || JSON.stringify(l) !== JSON.stringify(r)) changedRemote = true;
    } else {
      merged[id] = r;
      changedLocal = true;
    }
  }
  return { merged, changedLocal, changedRemote };
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function createGitHub({ owner, repo, token, fetch = globalThis.fetch.bind(globalThis) }) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const fail = (res, what) => Object.assign(new Error(`${what}: ${res.status}`), { status: res.status });
  return {
    async pull(name) {
      const res = await fetch(`${base}data/${name}.json`, { headers, cache: 'no-store' });
      if (res.status === 404) return { data: {}, sha: null };
      if (!res.ok) throw fail(res, 'pull');
      const j = await res.json();
      return { data: JSON.parse(fromBase64(j.content) || '{}'), sha: j.sha };
    },
    async push(name, data, sha) {
      const body = { message: `kucni-trosak: ${name}`, content: toBase64(JSON.stringify(data, null, 1)) };
      if (sha) body.sha = sha;
      const res = await fetch(`${base}data/${name}.json`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw fail(res, 'push');
      return (await res.json()).content?.sha ?? null;
    },
  };
}

async function syncOne(store, gh, name) {
  const { data, sha } = await gh.pull(name);
  const r = mergeCollection(store.raw(name), data);
  if (r.changedLocal) store.replaceRaw(name, r.merged);
  if (r.changedRemote) await gh.push(name, r.merged, sha);
  return r;
}

export async function syncAll(store, gh, collections) {
  let pulled = 0, pushed = 0;
  for (const name of collections) {
    let r;
    try { r = await syncOne(store, gh, name); } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      r = await syncOne(store, gh, name);
    }
    if (r.changedLocal) pulled++;
    if (r.changedRemote) pushed++;
  }
  return { pulled, pushed };
}
