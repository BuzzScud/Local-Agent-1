// The hub's Remote tab: the models on the services saved with /remote, one card
// each, and everything the service says about the one you pick. The hub runs
// apart from the app's windows, so it reads the services from settings.json
// ("remotes", and "remote" for the one in use) and each key from the Keychain;
// a key never reaches the page.
//   GET  /remote.json?service=<id>          the saved services, and that one's models (its cards, by category, biggest first)
//   GET  /remote/model.json?service=&id=    one model in full: the service's details, what it is good at, our results
//   POST /remote/try     { service, id }    asks it to count to 20: the answer, ✔ or ✗, the time and the speed (kept)
//   POST /remote/load    { service, id }    loads it on an Ollama service now, at the context the app would ask for
//   POST /remote/unload  { service, id }    takes it out of the service's memory
// A try, a load and an unload run in the background (a big model takes minutes
// to load); the model's `busy` says so until it is done, and the page asks again.
// When a service cannot be reached, the list it gave last time is shown, with its time.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOME, REMOTE_SOURCES, sourceOf, keyIdOf, readKey, directUrl, remoteLabel, remoteProblem, openTunnel, SERVE_PORT, probe,
  ollamaCatalog, ollamaDetail, preloadOllama, unloadOllama, ollamaCtxOf, COLD_CTX, isOutOfMemory,
  remoteLevels, bigHarness, CLAUDE_MODELS, CLAUDE_HOST, claudeClient, claudeCaps, claudeName, readRecord,
} from '../../../models/index.mjs';
import { loadSettings } from './store.mjs';
import { remotesOf, readyRemote, sourceWord } from './remote-form.mjs';
import { specialtiesOf, categoryGroups } from './remote-specialties.mjs';

const noStore = { 'cache-control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers: noStore });
const bad = (error, status = 400) => json({ error }, status);
// Only this page may press a button: a request another site's tab sends here carries that site as its origin.
const fromHere = (req, url) => { const o = req.headers.get('origin'); return !o || o === url.origin; };

// A network error in plain words.
const plain = (e) => {
  const c = e?.cause?.code ?? e?.code ?? '';
  if (e?.name === 'TimeoutError' || /timed? ?out/i.test(e?.message ?? '')) return 'it did not answer in time';
  if (c === 'ECONNREFUSED' || /ConnectionRefused/i.test(e?.message ?? '')) return 'nothing is listening at that address';
  if (c === 'ECONNRESET' || /reset|socket connection was closed/i.test(e?.message ?? '')) return 'it cut the connection: the service is up but refused the request (a firewall, or the service is restarting)';
  if (c === 'ENOTFOUND' || /getaddrinfo|Unable to connect/i.test(e?.message ?? '')) return 'that address could not be found or reached';
  return String(e?.message ?? e).slice(0, 200);
};

// What the counting answer must say (commas, dots and line breaks between the numbers are fine).
export const COUNT_ASK = 'Count from 1 to 20, with a space between each number. Reply with the numbers only.';
export const countedRight = (said) => /\b1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20\b/.test(String(said ?? '').replace(/[,.;\n\r\t]+/g, ' ').replace(/\s+/g, ' '));

export function remoteHub({ cwd = process.cwd(), home = HOME } = {}) {
  const seenDir = join(home, 'remote-seen');
  const triedFile = join(home, 'remote-tried.json');
  const conns = new Map(); // service → { url, key, tunnel, sig }
  const lists = new Map(); // service → the last list read, for /remote/model.json
  const busy = new Map(); // `${service}\0${id}` → { what, since }
  const last = new Map(); // `${service}\0${id}` → { what, ok, error, at } (the last load or unload)

  const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, v) => { try { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1)); renameSync(`${f}.tmp`, f); } catch { /* shown, not kept */ } };
  const tried = () => readJson(triedFile, {});

  const settings = () => loadSettings(cwd);
  function services() {
    const s = settings();
    const all = remotesOf(s);
    const inUse = s.remote?.use ? sourceOf(s.remote) : null;
    return REMOTE_SOURCES.filter((id) => all[id]).map((id) => ({
      id, word: sourceWord(id), label: id === 'claude' ? 'Anthropic' : remoteLabel(all[id]), kind: all[id].kind,
      model: all[id].model || null, inUse: id === inUse, ready: readyRemote(all[id]), problem: remoteProblem(all[id]) ?? (id === 'claude' && !readyRemote(all[id]) ? 'it needs an API key: paste one in /remote claude, or set ANTHROPIC_API_KEY' : null), profile: all[id],
    }));
  }

  // The service's address and key: an SSH tunnel is opened once and kept while the hub runs.
  async function connOf(sv) {
    const r = sv.profile;
    const sig = JSON.stringify([r.address, r.port, r.connect, r.kind, r.keyId]);
    const had = conns.get(sv.id);
    if (had?.sig === sig) return had;
    had?.tunnel?.stop();
    const key = r.key ? readKey(keyIdOf(r)) : sv.id === 'claude' ? process.env.ANTHROPIC_API_KEY ?? null : null;
    if (r.key && !key) throw new Error('its API key is missing from the Keychain: enter it again in /remote');
    let tunnel = null;
    let url;
    if (r.kind === 'claude') url = r.address ? directUrl(r) : `https://${CLAUDE_HOST}`;
    else if (r.connect === 'ssh') { tunnel = await openTunnel({ dest: r.address.trim(), remotePort: r.port ?? SERVE_PORT }); url = tunnel.url; }
    else url = directUrl(r);
    const c = { url, key, tunnel, sig };
    conns.set(sv.id, c);
    return c;
  }

  // One card's facts, the same shape whatever the service is.
  const card = (sv, m, t) => ({ ...m, tried: t[sv.id]?.[m.id] ?? null, busy: busy.get(`${sv.id}\0${m.id}`) ?? null, last: last.get(`${sv.id}\0${m.id}`) ?? null, specialties: sv.ollama !== false ? specialtiesOf(m) : null });

  // The list a service gives now: { server, models, groups }. Throws when it cannot be read.
  async function readList(sv) {
    const c = await connOf(sv);
    const r = sv.profile;
    if (r.kind === 'claude') {
      const client = await claudeClient(c.url, c.key);
      const page = await client.models.list({ limit: 100 }, { timeout: 10_000, maxRetries: 0 });
      const models = (page.data ?? []).map((x) => {
        const ours = CLAUDE_MODELS.find((m) => m.id === x.id);
        return { id: x.id, name: x.display_name ?? claudeName(x.id), created: x.created_at ?? null, ctx: x.max_input_tokens ?? null, maxOut: x.max_tokens ?? null, price: ours?.price ?? null, note: ours?.note ?? null, kind: 'claude', known: true, chat: true, tools: true, vision: true, thinking: true };
      });
      return { server: 'Anthropic API', models, groups: [{ id: 'all', text: 'Models your key can use', ids: models.map((m) => m.id) }] };
    }
    if (r.kind === 'openai') {
      const cat = await ollamaCatalog({ url: c.url, key: c.key, timeoutMs: 10_000 });
      // Cards by what each model is for, biggest first (categoryGroups); a loaded one keeps its mark.
      if (cat) return { server: `Ollama ${cat.version}`, ollama: true, models: cat.models.map((m) => ({ ...m, kind: 'ollama' })), groups: categoryGroups(cat.models) };
      const res = await fetch(`${c.url.replace(/\/+$/, '')}/v1/models`, { headers: c.key ? { authorization: `Bearer ${c.key}` } : {}, signal: AbortSignal.timeout(10_000) });
      if (res.status === 401 || res.status === 403) throw new Error(c.key ? 'the API key was not accepted' : 'it needs an API key: add one in /remote');
      const j = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(j?.data)) throw new Error(`it answered ${res.status} to its model list`);
      const models = j.data.filter((x) => x?.id).map((x) => {
        const pin = Number(x.pricing?.prompt), pout = Number(x.pricing?.completion);
        return {
          id: x.id, name: x.name ?? x.id, owner: x.owned_by ?? null, created: x.created ? new Date(x.created * 1000).toISOString() : null,
          ctx: x.context_length ?? x.max_model_len ?? x.max_context_length ?? x.top_provider?.context_length ?? null,
          maxOut: x.top_provider?.max_completion_tokens ?? null, description: x.description ?? null,
          price: Number.isFinite(pin) && Number.isFinite(pout) ? { in: pin * 1e6, out: pout * 1e6 } : null,
          inputs: x.architecture?.input_modalities ?? null, params: x.supported_parameters ?? null,
          vision: Array.isArray(x.architecture?.input_modalities) ? x.architecture.input_modalities.includes('image') : null,
          tools: Array.isArray(x.supported_parameters) ? x.supported_parameters.includes('tools') : null, kind: 'openai',
        };
      });
      return { server: 'OpenAI-compatible service', models, groups: [{ id: 'all', text: 'Models it lists', ids: models.map((m) => m.id) }] };
    }
    // My other computer: a llama.cpp server (or coding serve) runs one model.
    const p = await probe({ url: c.url, kind: 'llama', key: c.key, timeoutMs: 10_000 });
    if (!p.ok) throw new Error(p.error);
    const m = { id: p.model || 'its model', file: p.file, ctx: p.ctx, slots: p.slots, vision: p.vision, loaded: true, kind: 'llama', known: false, chat: true, tools: true };
    return { server: 'llama.cpp server', models: [m], groups: [{ id: 'loaded', text: 'Loaded now', ids: [m.id] }] };
  }

  async function listOf(id) {
    const all = services();
    const sv = all.find((s) => s.id === id) ?? all.find((s) => s.inUse) ?? all.find((s) => s.ready) ?? all[0] ?? null;
    const head = all.map(({ profile: _p, ...s }) => s);
    if (!sv) return { services: head, service: null, state: 'none' };
    if (!sv.ready) return { services: head, service: sv.id, state: 'setup', why: sv.problem ?? 'it is not set up yet' };
    const t = tried();
    try {
      const l = await readList(sv);
      lists.set(sv.id, l);
      writeJson(join(seenDir, `${sv.id}.json`), { ...l, at: new Date().toISOString() });
      const svx = { ...sv, ollama: Boolean(l.ollama) };
      return { services: head, service: sv.id, state: 'ok', server: l.server, ollama: Boolean(l.ollama), models: l.models.map((m) => card(svx, m, t)), groups: l.groups, at: new Date().toISOString() };
    } catch (e) {
      const seen = readJson(join(seenDir, `${sv.id}.json`), null);
      if (seen) lists.set(sv.id, seen);
      const svx = { ...sv, ollama: Boolean(seen?.ollama) };
      return { services: head, service: sv.id, state: 'down', why: plain(e), server: seen?.server ?? null, ollama: Boolean(seen?.ollama), seenAt: seen?.at ?? null, models: (seen?.models ?? []).map((m) => card(svx, m, t)), groups: seen?.groups ?? [] };
    }
  }

  // One model in full.
  async function modelOf(id, mid) {
    const sv = services().find((s) => s.id === id);
    if (!sv) return bad('no such service', 404);
    const l = lists.get(id) ?? readJson(join(seenDir, `${id}.json`), null);
    const m = l?.models?.find((x) => x.id === mid);
    if (!m) return bad('no such model on it', 404);
    const t = tried();
    const base = card({ ...sv, ollama: Boolean(l.ollama) }, m, t);
    const runs = readRecord().filter((x) => x?.model === `remote:${mid}`).slice(-12).reverse()
      .map((x) => ({ at: x.at, name: x.name, passed: x.passed, total: x.total, secs: x.secs, result: x.result, note: x.note, page: x.page }));
    const out = { service: { id, word: sv.word, label: sv.label, server: l.server }, model: base, runs, inUse: sv.inUse && sv.model === mid };
    if (l.ollama) {
      const r = sv.profile;
      out.levels = m.known ? remoteLevels(m).map((v) => ({ label: v.label, note: v.note })) : null;
      out.big = Boolean(bigHarness(m));
      out.runsAt = ollamaCtxOf(r, mid) || (m.loaded ? m.loadedCtx : null) || Math.min(m.ctx || COLD_CTX, COLD_CTX);
      out.runsAtFrom = ollamaCtxOf(r, mid) ? 'your /effort setting' : m.loaded ? 'the context it is loaded at now' : 'the app\'s safe start (32k) until you set one in /effort';
      try { const c = await connOf(sv); out.detail = await ollamaDetail({ url: c.url, key: c.key, model: mid }); } catch (e) { out.detailError = plain(e); }
    } else if (sv.profile.kind === 'claude') out.caps = claudeCaps(mid);
    return json(out);
  }

  // The jobs. Each runs in the background; the model's `busy` shows it until it ends.
  function startJob(id, mid, what, fn) {
    const k = `${id}\0${mid}`;
    if (busy.has(k)) return bad(`it is already ${busy.get(k).what === 'try' ? 'being tried' : busy.get(k).what === 'load' ? 'loading' : 'unloading'}`, 409);
    busy.set(k, { what, since: new Date().toISOString() });
    fn().then((r) => last.set(k, { what, ok: true, at: new Date().toISOString(), ...r }), (e) => last.set(k, { what, ok: false, error: isOutOfMemory(e?.message) ? 'the service has no room for it (out of GPU memory): unload another model first' : plain(e), at: new Date().toISOString() }))
      .finally(() => busy.delete(k));
    return json({ ok: true, started: what });
  }

  async function tryModel(sv, mid) {
    const c = await connOf(sv);
    const l = lists.get(sv.id);
    const m = l?.models?.find((x) => x.id === mid) ?? {};
    const t0 = Date.now();
    let said = '', loadSecs = null, replySecs = null, tokens = null, tokSecs = null;
    if (l?.ollama) {
      const gptoss = /gpt-?oss/i.test(`${m.family ?? ''} ${mid}`);
      const numCtx = ollamaCtxOf(sv.profile, mid) || (m.loaded ? m.loadedCtx : null);
      const res = await fetch(`${c.url.replace(/\/+$/, '')}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) }, signal: AbortSignal.timeout(15 * 60_000),
        body: JSON.stringify({ model: mid, messages: [{ role: 'user', content: COUNT_ASK }], stream: false, ...(gptoss ? { think: 'low' } : m.thinking ? { think: false } : {}), options: { num_predict: gptoss ? 800 : 160, ...(numCtx ? { num_ctx: numCtx } : {}) } }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === 'string' ? j.error : j?.error?.message ?? `it answered ${res.status}`);
      said = j?.message?.content ?? '';
      loadSecs = j?.load_duration ? j.load_duration / 1e9 : null;
      replySecs = j?.total_duration ? (j.total_duration - (j.load_duration ?? 0)) / 1e9 : null;
      tokens = j?.eval_count ?? null;
      tokSecs = j?.eval_count && j?.eval_duration ? j.eval_count / (j.eval_duration / 1e9) : null;
    } else if (sv.profile.kind === 'claude') {
      const client = await claudeClient(c.url, c.key);
      const r = await client.messages.create({ model: mid, max_tokens: 1024, messages: [{ role: 'user', content: COUNT_ASK }], ...(claudeCaps(mid).effort ? { output_config: { effort: 'low' } } : {}) }, { timeout: 120_000 });
      said = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      tokens = r.usage?.output_tokens ?? null;
    } else {
      const res = await fetch(`${c.url.replace(/\/+$/, '')}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) }, signal: AbortSignal.timeout(5 * 60_000),
        body: JSON.stringify({ model: mid, messages: [{ role: 'user', content: COUNT_ASK }], max_tokens: 160, stream: false, ...(sv.profile.kind === 'llama' ? { chat_template_kwargs: { enable_thinking: false } } : {}) }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `it answered ${res.status}`);
      said = j?.choices?.[0]?.message?.content ?? '';
      tokens = j?.usage?.completion_tokens ?? null;
    }
    const secs = (Date.now() - t0) / 1000;
    replySecs ??= secs;
    tokSecs ??= tokens && replySecs ? tokens / replySecs : null;
    const result = { ok: countedRight(said), said: String(said).trim().replace(/\s+/g, ' ').slice(0, 160), secs, loadSecs, replySecs, tokens, tokSecs, at: new Date().toISOString() };
    const all = tried();
    all[sv.id] = { ...(all[sv.id] ?? {}), [mid]: result };
    writeJson(triedFile, all);
    return { result };
  }

  async function route(req, url) {
    if (url.pathname === '/remote.json' && req.method === 'GET') return json(await listOf(url.searchParams.get('service')));
    if (url.pathname === '/remote/model.json' && req.method === 'GET') return modelOf(url.searchParams.get('service'), url.searchParams.get('id'));
    if (!url.pathname.startsWith('/remote/')) return null;
    if (req.method !== 'POST') return bad('not found', 404);
    if (!fromHere(req, url)) return bad('only the hub page may do this', 403);
    let body = {};
    try { body = (await req.json()) ?? {}; } catch { return bad('the request body is not JSON'); }
    const sv = services().find((s) => s.id === body.service);
    if (!sv || !sv.ready) return bad('that service is not set up', 404);
    const mid = typeof body.id === 'string' ? body.id : '';
    const l = lists.get(sv.id);
    if (!mid || !l?.models?.some((m) => m.id === mid)) return bad('no such model on it (refresh the list)', 404);
    if (url.pathname === '/remote/try') return startJob(sv.id, mid, 'try', () => tryModel(sv, mid));
    if (!l.ollama) return bad('only an Ollama service loads and unloads models on request', 400);
    if (url.pathname === '/remote/load') return startJob(sv.id, mid, 'load', async () => { const c = await connOf(sv); await preloadOllama({ url: c.url, key: c.key, model: mid, numCtx: ollamaCtxOf(sv.profile, mid) }); return {}; });
    if (url.pathname === '/remote/unload') return startJob(sv.id, mid, 'unload', async () => { const c = await connOf(sv); await unloadOllama({ url: c.url, key: c.key, model: mid }); return {}; });
    return bad('not found', 404);
  }

  return { route, stop: () => { for (const c of conns.values()) c.tunnel?.stop(); conns.clear(); } };
}
