// The AI gateway (Agentic Coder Web, 8 Oct 2026): every model request of the web goes through
// here, from the page's chat, from a run's `coding -p` (pointed at this server as its Ollama
// service, with the run's own token), and from API keys (Ollama's API and the OpenAI shape).
// What it does on the way:
//   - picks the service that has the model (a run's own first);
//   - Laguna q8, the last resort (the owner's rule): only for an admin, or a run whose user said
//     yes to the switch; anyone else is refused with why;
//   - moves a request to the stand-in on another service when its own gives no first word in
//     `spill.after` seconds plus the time to read what is new (the owner's pick: AI 2 after 60 s),
//     says so to the run, and sends that run's next requests straight there for 2 minutes;
//   - never lets a request unload a model (keep_alive 0) or load one again at another size
//     (num_ctx is set to the size it is loaded at), and keeps a model kept loaded for ever
//     (keep_alive -1) that way after a request that would have reset it;
//   - counts each request for its user (usage), and knows which service is busy: Ollama keeps a
//     model past its time only while a request runs on it, so loaded + expires_at passed = busy.
import { ollamaCatalog } from '../../../models/index.mjs';
import { addUsage } from './db.mjs';
import { isLastResort, accessOf, roleOf, warningsOf } from './models.mjs';

const COOL_MS = 2 * 60_000;
const STATUS_MS = 10_000;
const CHARS_A_TOKEN = 3.6;
const GEN = new Set(['/api/chat', '/api/generate', '/v1/chat/completions', '/v1/completions']);
const PASS = new Set(['/api/show', '/api/embed', '/api/embeddings', '/v1/embeddings']);
const LISTS = new Set(['/api/tags', '/api/ps', '/api/version', '/v1/models']);
export const GATEWAY_PATHS = new Set([...GEN, ...PASS, ...LISTS]);

const pinnedAt = (expires) => Number(String(expires).slice(0, 4)) > 2100;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const unloads = (k) => k === 0 || k === '0' || /^0+(\.0+)?[smh]?$/.test(String(k ?? 'x'));

export class Gateway {
  constructor({ settings, db, fetchImpl = fetch, now = () => Date.now() }) {
    this.settings = settings; // () => the web settings
    this.db = db;
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = new Map(); // service id → { at, value }
    this.cool = new Map(); // `${who}|${service}|${model}` → until
    this.inFlight = new Map(); // id → { user, model, service, since, first }
    this.seq = 0;
    // Each service's reading speed (tokens a second), from Ollama's own counts; until one is
    // measured, the slow end of what was seen on 8 Oct (about 90 a second), so a long
    // conversation being read is never taken for a service that gives no word.
    this.readSpeed = new Map();
  }

  // How long a request may go with no first word before it moves: the wait chosen, plus reading
  // what it sends at the service's measured speed, plus loading the model when it is not loaded.
  deadline(st, model, promptChars) {
    const s = this.settings();
    const speed = this.readSpeed.get(st.id) ?? 90;
    const read = promptChars / CHARS_A_TOKEN / speed * 1000;
    const gb = st.models.find((m) => m.name === model)?.gb ?? 20;
    const load = st.loaded.has(model) ? 0 : Math.max(60_000, gb * 3000);
    return (s.spill?.after ?? 60) * 1000 + Math.round(read) + load;
  }

  services() { return this.settings().services; }

  // ---- what each service has, and is doing ----
  async status(id, { force = false } = {}) {
    const sv = this.services()[id];
    if (!sv) return null;
    const hit = this.cache.get(id);
    if (!force && hit && this.now() - hit.at < STATUS_MS) return hit.value;
    const get = async (path) => { const r = await this.fetch(`${sv.url}${path}`, { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
    let value;
    try {
      // Every model with what it can do (Agentic Coder's own reading of /api/show, kept per set of
      // weights, so only new models are asked again), and what is in memory with its times.
      const [cat, ps] = await Promise.all([ollamaCatalog({ url: sv.url, timeoutMs: 8000 }), get('/api/ps').catch(() => ({ models: [] }))]);
      if (!cat) throw new Error('no answer (or not an Ollama service)');
      const now = this.now();
      const loaded = new Map((ps.models ?? []).map((m) => [m.name, { ctx: m.context_length ?? null, pinned: pinnedAt(m.expires_at), expires: Date.parse(m.expires_at), gb: Math.round((m.size_vram ?? m.size ?? 0) / 1e8) / 10 }]));
      const busy = [...loaded].filter(([, m]) => !m.pinned && m.expires < now).map(([name, m]) => ({ name, mins: Math.round((now - m.expires) / 60000) }));
      value = {
        id, label: sv.label, url: sv.url, ok: true, at: now, version: cat.version,
        models: cat.models.map((m) => ({ name: m.id, gb: Math.round(m.bytes / 1e8) / 10, params: m.params || null, family: m.family || null, quant: m.quant || null, ctx: m.ctx ?? null, caps: m.known ? { chat: m.chat, tools: m.tools, thinking: m.thinking, vision: m.vision, embedding: m.embedding } : null, sameAs: m.sameAs ?? [] })),
        loaded, busy,
      };
    } catch (e) {
      value = { id, label: sv.label, url: sv.url, ok: false, at: this.now(), error: e.name === 'TimeoutError' ? 'no answer in 5 s' : e.message, models: [], loaded: new Map(), busy: [] };
    }
    this.cache.set(id, { at: this.now(), value });
    return value;
  }
  async statuses(opts) { return Promise.all(this.services().map((_, i) => this.status(i, opts))); }

  // Every model a user may pick (the admin's Who column: all, admin, off), with what it can do and
  // the warnings it carries; `all: true` gives every model (the admin's table).
  async modelsFor(user, { all = false, opts } = {}) {
    const s = this.settings();
    const mac = s.mode !== 'server';
    const out = [];
    for (const st of await this.statuses(opts)) {
      for (const m of st.models) {
        const access = accessOf(s, st.id, m.name);
        if (!all && (access === 'off' || (access === 'admin' && user?.role !== 'admin'))) continue;
        const l = st.loaded.get(m.name);
        out.push({ ...m, maxCtx: m.ctx, service: st.id, serviceLabel: st.label, loaded: Boolean(l), pinned: Boolean(l?.pinned), ctx: l?.ctx ?? null, loadedGb: l?.gb ?? null, busy: st.busy.some((b) => b.name === m.name), lastResort: isLastResort(s, m.name, st.id), access, warnings: warningsOf(m, { mac }), inUse: this.useOf(st.id, m.name) });
      }
    }
    return out;
  }

  // Requests at a service for a model right now.
  useOf(service, model) { let n = 0; for (const f of this.inFlight.values()) if (f.service === service && f.model === model) n++; return n; }

  // The service a model is asked on: the preferred one if it has it, else the first that does.
  async serviceFor(model, preferred = null) {
    const all = await this.statuses();
    const has = (st) => st?.ok && st.models.some((m) => m.name === model);
    if (preferred != null && has(all[preferred])) return all[preferred];
    return all.find(has) ?? null;
  }

  // May this caller use this model on this service? null, or why not.
  refusal(who, service, model) {
    const s = this.settings();
    // The admin's Helper does a run's side jobs whoever the run's person is (it is the system's job, not their pick).
    const helper = who.run ? roleOf(s, 'helper') : null;
    if (helper && helper.model === model && (helper.service == null || helper.service === service) && !isLastResort(s, model, service)) return null;
    const access = accessOf(s, service, model);
    if (access === 'off') return `${model} is switched off by the admin.`;
    if (isLastResort(s, model, service) && who.user?.role !== 'admin' && !who.run?.laguna) return `${model} is the last resort: it is used only after you say yes to switching a run to it, or by an admin.`;
    if (access === 'admin' && who.user?.role !== 'admin' && !(who.run?.laguna && isLastResort(s, model, service))) return `${model} is for admins only.`;
    return null;
  }

  // ---- one request ----
  // who: { user, via, run? }. Answers a Response (streamed as the service streams it).
  async handle(who, { method, path, body, signal }) {
    if (!GATEWAY_PATHS.has(path)) return json({ error: `${path} is not offered through Agentic Coder Web` }, 404);
    if (LISTS.has(path)) return this.lists(who, path);
    if (method !== 'POST' || !body || typeof body !== 'object') return json({ error: 'POST a JSON body' }, 400);
    const model = String(body.model ?? '');
    if (!model) return json({ error: 'name a model' }, 400);
    // A run's side job on the admin's Helper goes to the Helper's own service.
    const helper = who.run ? roleOf(this.settings(), 'helper') : null;
    const st = await this.serviceFor(model, helper?.model === model && helper.service != null ? helper.service : who.run?.service ?? null);
    if (!st) return json({ error: `model "${model}" not found on your AI services` }, 404);
    const why = this.refusal(who, st.id, model);
    if (why) return json({ error: why }, 403);
    if (PASS.has(path)) return this.pass(st, path, body, signal);
    return this.generate(who, st, path, body, signal);
  }

  async lists(who, path) {
    if (path === '/api/version') {
      const st = await this.status(who.run?.service ?? 0);
      try { return json(await (await this.fetch(`${st.url}/api/version`, { signal: AbortSignal.timeout(5000) })).json()); } catch { return json({ error: 'your AI service did not answer' }, 502); }
    }
    const models = await this.modelsFor(who.user);
    const mine = who.run ? models.filter((m) => m.service === who.run.service || who.run.laguna && m.lastResort) : models;
    const seen = new Set();
    const uniq = mine.filter((m) => !seen.has(m.name) && seen.add(m.name));
    if (path === '/v1/models') return json({ object: 'list', data: uniq.map((m) => ({ id: m.name, object: 'model', owned_by: m.serviceLabel })) });
    if (path === '/api/tags') return json({ models: uniq.map((m) => ({ name: m.name, model: m.name, size: Math.round(m.gb * 1e9), details: { family: m.family, parameter_size: m.params } })) });
    // /api/ps: what is loaded, with the service's own fields.
    const out = [];
    for (const st of await this.statuses()) {
      if (who.run && st.id !== who.run.service) continue;
      for (const [name, l] of st.loaded) if (uniq.some((m) => m.name === name)) out.push({ name, model: name, size_vram: Math.round(l.gb * 1e9), context_length: l.ctx, expires_at: new Date(l.pinned ? Date.UTC(2318, 0, 1) : l.expires).toISOString() });
    }
    return json({ models: out });
  }

  async pass(st, path, body, signal) {
    try {
      const r = await this.fetch(`${st.url}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, signal });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
    } catch (e) { return json({ error: `your AI service did not answer: ${e.message}` }, 502); }
  }

  // The body as it goes to a service: no unloading, the size it is loaded at, kept loaded for ever if it was.
  shape(st, path, body, model) {
    const b = { ...body, model };
    if (unloads(b.keep_alive)) delete b.keep_alive;
    const l = st.loaded.get(model);
    if (l?.ctx && b.options?.num_ctx && b.options.num_ctx !== l.ctx) b.options = { ...b.options, num_ctx: l.ctx };
    if (l?.pinned && path.startsWith('/api/')) b.keep_alive = -1;
    return b;
  }

  // A load request (no prompt, no messages) for a model that is loaded already is answered here.
  loadOnly(path, body) { return path === '/api/generate' && !body.prompt && !body.messages && !body.images; }

  // The stand-in for a request on `st`, or null: on another service, never the last resort.
  async standIn(st, model) {
    const s = this.settings();
    const to = roleOf(s, 'standIn');
    if (!to || isLastResort(s, to.model, to.service) || (to.model === model && to.service === st.id)) return null;
    const other = to.service != null ? await this.status(to.service) : (await this.statuses()).find((x) => x.id !== st.id && x.ok && x.models.some((m) => m.name === to.model));
    if (!other || other.id === st.id) return null;
    return other.ok && other.models.some((m) => m.name === to.model) ? { st: other, model: to.model } : null;
  }

  async generate(who, st0, path, body, signal) {
    const model0 = String(body.model);
    const id = ++this.seq;
    const t0 = this.now();
    const coolKey = (st, m) => `${who.run?.token ?? `u${who.user?.id}`}|${st.id}|${m}`;
    let st = st0;
    let model = model0;
    let spilled = false;
    // A run that moved in the last 2 minutes goes straight to its stand-in.
    if ((this.cool.get(coolKey(st0, model0)) ?? 0) > this.now()) {
      const to = await this.standIn(st0, model0);
      if (to) { st = to.st; model = to.model; spilled = true; }
    }
    if (this.loadOnly(path, body) && st.loaded.has(model)) return json({ model, created_at: new Date().toISOString(), response: '', done: true, done_reason: 'load' });
    const s = this.settings();
    const stream = body.stream !== false;
    const promptChars = JSON.stringify(body.messages ?? body.prompt ?? '').length;
    const deadline = (st2, m) => this.deadline(st2, m, promptChars);
    this.inFlight.set(id, { user: who.user?.id, name: who.user?.name, model, service: st.id, since: t0, first: null, run: who.run?.run ?? null });

    // One try on a service: { res, first (Uint8Array|null), reader } or { late: true } past the deadline.
    const attempt = async (st2, m, waitMs) => {
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const sent = this.shape(st2, path, body, m);
      const go = (async () => {
        const res = await this.fetch(`${st2.url}${path}`, { method: 'POST', body: JSON.stringify(sent), headers: { 'content-type': 'application/json' }, signal: ac.signal });
        if (!res.ok || !res.body) return { res, first: null, reader: null };
        const reader = res.body.getReader();
        const r = await reader.read();
        return { res, first: r.done ? null : r.value, reader, done: r.done };
      })();
      if (waitMs == null) { const out = await go; return { ...out, ac }; }
      let timer;
      const late = new Promise((ok) => { timer = setTimeout(() => ok({ late: true }), waitMs); });
      let out = await Promise.race([go, late]);
      clearTimeout(timer);
      // Past the deadline: a request that does not stream moves only when its service is busy.
      if (out.late && !stream) {
        const fresh = await this.status(st2.id, { force: true });
        if (!fresh.busy.length) out = await go;
      }
      if (out.late) { ac.abort(); go.catch(() => {}); signal?.removeEventListener('abort', onAbort); return { late: true }; }
      return { ...out, ac };
    };

    let got;
    try {
      const to = spilled ? null : await this.standIn(st, model);
      got = await attempt(st, model, to ? deadline(st, model) : null);
      if (got.late) {
        const waited = Math.round((this.now() - t0) / 1000);
        this.cool.set(coolKey(st0, model0), this.now() + COOL_MS);
        who.run?.note?.(`${st.label} gave no first word in ${waited} s: this step went to ${to.model} on ${to.st.label}.`);
        st = to.st; model = to.model; spilled = true;
        this.inFlight.set(id, { ...this.inFlight.get(id), model, service: st.id });
        got = await attempt(st, model, null);
      }
    } catch (e) {
      this.inFlight.delete(id);
      if (signal?.aborted) return json({ error: 'stopped' }, 499);
      return json({ error: `your AI service did not answer: ${e.message}` }, 502);
    }
    const { res, first, reader } = got;
    const firstAt = this.now();
    if (!res.ok || !reader) {
      this.inFlight.delete(id);
      const text = await res.text().catch(() => '');
      return new Response(text, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
    }
    const flight = this.inFlight.get(id);
    if (flight) flight.first = firstAt;
    // Pass the bytes through as they come, reading the counts from the last lines.
    const dec = new TextDecoder();
    let tail = '';
    const counts = { in: 0, out: 0, chars: 0 };
    const read = (chunk) => {
      tail = (tail + dec.decode(chunk, { stream: true })).slice(-8000);
      counts.chars += chunk.length;
    };
    const finish = () => {
      for (const line of tail.split('\n').reverse()) {
        const t = line.replace(/^data:\s*/, '').trim();
        if (!t.startsWith('{')) continue;
        try {
          const j = JSON.parse(t);
          if (j.eval_count != null || j.prompt_eval_count != null) {
            counts.out = j.eval_count ?? 0; counts.in = j.prompt_eval_count ?? 0;
            // The reading speed it showed (only from a read long enough to say).
            if (j.prompt_eval_count > 500 && j.prompt_eval_duration > 0) {
              const v = j.prompt_eval_count / (j.prompt_eval_duration / 1e9);
              const was = this.readSpeed.get(st.id);
              this.readSpeed.set(st.id, was ? was * 0.7 + v * 0.3 : v);
            }
            break;
          }
          if (j.usage) { counts.out = j.usage.completion_tokens ?? 0; counts.in = j.usage.prompt_tokens ?? 0; break; }
        } catch { /* a cut line */ }
      }
      if (!counts.out) counts.out = Math.round(counts.chars / CHARS_A_TOKEN / 4);
      if (!counts.in) counts.in = Math.round(promptChars / CHARS_A_TOKEN);
      this.inFlight.delete(id);
      if (who.user?.id != null && this.db) addUsage(this.db, { user: who.user.id, model, tokensIn: counts.in, tokensOut: counts.out, waitMs: firstAt - t0, busyMs: this.now() - t0, spilled });
      // A model kept loaded for ever stays so after an OpenAI-shaped request (which cannot say so).
      if (st.loaded.get(model)?.pinned && path.startsWith('/v1/')) this.fetch(`${st.url}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: -1 }), headers: { 'content-type': 'application/json' } }).catch(() => {});
    };
    if (first) read(first);
    const body2 = new ReadableStream({
      start(ctl) { if (first) ctl.enqueue(first); },
      async pull(ctl) {
        try {
          const r = await reader.read();
          if (r.done) { finish(); ctl.close(); return; }
          read(r.value);
          ctl.enqueue(r.value);
        } catch (e) { finish(); ctl.error(e); }
      },
      cancel() { got.ac?.abort(); finish(); },
    });
    return new Response(body2, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/x-ndjson', ...(spilled ? { 'x-acw-spilled-to': `${st.label} ${model}` } : {}) } });
  }

  // ---- the admin's buttons (Admin › Models) ----
  // Test: one short answer, timed. Loads the model when it is not loaded (the page says so first).
  async test(service, model) {
    const st = await this.status(service, { force: true });
    if (!st?.ok || !st.models.some((m) => m.name === model)) return { ok: false, error: `${model} is not on ${st?.label ?? 'that service'} now` };
    const m = st.models.find((x) => x.name === model);
    if (m.caps && !m.caps.chat) return { ok: false, error: 'an embedding model does not chat, so it cannot be tested this way' };
    const l = st.loaded.get(model);
    const body = { model, messages: [{ role: 'user', content: 'Reply with just the word ok.' }], stream: true, options: { num_predict: 24, ...(l?.ctx ? { num_ctx: l.ctx } : {}) }, ...(m.caps?.thinking ? { think: /gpt-?oss/i.test(model) ? 'low' : false } : {}), ...(l?.pinned ? { keep_alive: -1 } : {}) };
    const t0 = this.now();
    let first = null, text = '', last = null;
    try {
      const res = await this.fetch(`${st.url}/api/chat`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok) return { ok: false, error: `${st.label} answered ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (first == null) first = this.now() - t0;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const j = JSON.parse(line); if (j.error) return { ok: false, error: j.error }; text += j.message?.content ?? ''; if (j.done) last = j; }
      }
    } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? 'no answer in 10 minutes' : e.message }; }
    this.cache.delete(service);
    const ms = (ns) => Math.round((ns ?? 0) / 1e6);
    return { ok: true, text: text.trim().slice(0, 80), firstMs: first, totalMs: this.now() - t0, loadMs: ms(last?.load_duration), readMs: ms(last?.prompt_eval_duration), tokens: last?.eval_count ?? 0, tps: last?.eval_count && last?.eval_duration ? Math.round(last.eval_count / (last.eval_duration / 1e9) * 10) / 10 : null };
  }

  // Load a model and keep it loaded (keep: true = for good; else 30 minutes), or let it go.
  async keep(service, model, { keep = true } = {}) {
    const st = await this.status(service, { force: true });
    if (!st?.ok || !st.models.some((m) => m.name === model)) return { ok: false, error: `${model} is not on ${st?.label ?? 'that service'} now` };
    const l = st.loaded.get(model);
    try {
      const res = await this.fetch(`${st.url}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10 * 60_000), body: JSON.stringify({ model, keep_alive: keep ? -1 : '30m', ...(l?.ctx ? { options: { num_ctx: l.ctx } } : {}) }) });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: `${st.label} answered ${res.status}: ${text.slice(0, 200)}` };
    } catch (e) { return { ok: false, error: e.message }; }
    this.cache.delete(service);
    return { ok: true };
  }
  async letGo(service, model) {
    const st = await this.status(service, { force: true });
    if (!st?.ok) return { ok: false, error: `${st?.label ?? 'that service'} does not answer` };
    if (!st.loaded.has(model)) return { ok: true, already: true };
    if (this.useOf(service, model)) return { ok: false, error: `${model} is answering ${this.useOf(service, model)} request(s) right now: let it go when they finish` };
    try {
      const res = await this.fetch(`${st.url}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60_000), body: JSON.stringify({ model, keep_alive: 0 }) });
      if (!res.ok) return { ok: false, error: `${st.label} answered ${res.status}` };
    } catch (e) { return { ok: false, error: e.message }; }
    this.cache.delete(service);
    return { ok: true };
  }

  // What is being asked right now (the admin's Queue).
  flights() { return [...this.inFlight.values()].map((f) => ({ ...f, waiting: !f.first, secs: Math.round((this.now() - f.since) / 1000) })); }
}
