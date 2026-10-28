// The hub's Bonsai tab (27 Oct 2026, the owner's pick of "3 · Map" from two design rounds, private:
// docs/private/design rounds/agentic-coder-bonsai-tab-2-designs-v2-2026-10-27.html): Bonsai 2 9B on this Mac's
// Ollama, everything about it in one page, with full control, updating live while a window works with it.
//   GET  /bonsai.json             the whole page: this Mac, Ollama, the model and its file, what it reads, who uses it,
//                                 its tests, its speed, and what it is doing now
//   GET  /bonsai/live.json        what changes by the second (the page asks every second): the requests under way and
//                                 the newest finished ones (agent/activity.mjs), Bonsai in memory, this Mac's free memory
//   GET  /bonsai/weights.json?layer=&part=   one layer's parts and a patch of one part's real weights (bonsai-gguf.mjs)
//   POST /bonsai/restart|stop|start   Ollama, with { settings } (ollama-control.mjs)
//   POST /bonsai/login       { on, settings }   Ollama started at login, or not
//   POST /bonsai/load|unload Bonsai in memory
//   POST /bonsai/tools       { off: [names] }   tools it goes without (its own settings: "tuned")
//   POST /bonsai/speed       the speed test, in the background (bonsai-speed.mjs)
//   POST /bonsai/check       the Bonsai check in the Arena's line
// Its settings, Thinking and own instructions are the Remote tab's (/remote/model.json, /remote/tune, /remote/tune-test)
// and its jobs the Profiles tab's (/profiles.json, /profiles/use): the page uses those routes, so each is kept once.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { HOME, OWN_REMOTES, sourceOf, readRecord, startBattle, parseAddress } from '../../../models/index.mjs';
import { loadSettings, saveService } from './store.mjs';
import { remotesOf } from './remote-form.mjs';
import { readProfiles } from './profiles.mjs';
import { ownOf, TOOLS_SWITCHABLE, cleanToolsOff, OWN_ROWS } from './limits.mjs';
import { activeRequests, recentRequests } from '../agent/activity.mjs';
import { toolSchemas } from '../agent/tools.mjs';
import { systemPrompt } from '../agent/prompt.mjs';
import { readSkills } from '../agent/prompt-files.mjs';
import { memoryStatus, statusWords } from '../agent/memory-home.mjs';
import { ollamaBlobOf, readGguf, modelFacts, layerParts, q2Patch } from './bonsai-gguf.mjs';
import { ollamaStatus, logTail, restartOllama, stopOllama, startOllama, setLogin, loadModel, unloadModel, keptSettings, OLLAMA_URL, CTX_STEPS, KV_TYPES } from './ollama-control.mjs';
import { speedTest, readSpeeds } from './bonsai-speed.mjs';

const BONSAI = 'bonsai-2:9b';
const noStore = { 'cache-control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers: noStore });
const bad = (error, status = 400) => json({ error }, status);
const fromHere = (req, url) => { const o = req.headers.get('origin'); return !o || o === url.origin; };
const tok = (s) => Math.round(String(s ?? '').length / 3.6);
// A value worked out at most every `ms` (the lookups that run a program: lsof, ps, memory_pressure).
const every = (ms, fn) => { let at = 0, v; return async () => { if (Date.now() - at > ms) { v = await fn(); at = Date.now(); } return v; }; };

// This Mac: its chip, its memory and how much of it is free (macOS's own figure).
const chip = (() => { try { return execFileSync('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim(); } catch { return cpus()[0]?.model ?? ''; } })();
const freePct = every(5000, () => {
  try { const m = /free percentage:\s*(\d+)%/.exec(execFileSync('/usr/bin/memory_pressure', [], { encoding: 'utf8', timeout: 4000 })); return m ? Number(m[1]) : null; } catch { return null; }
});
const ollamaNow = every(3000, () => ollamaStatus());

// Where Bonsai is set up: the saved service at this Mac's Ollama address (Agentic Coder's "machine" one, for the owner).
function bonsaiService(settings = loadSettings()) {
  const all = remotesOf(settings);
  const port = Number(new URL(OLLAMA_URL()).port || 11434);
  const here = (r) => { const a = parseAddress(r?.address ?? ''); return a && /^(localhost|127\.0\.0\.1|::1)$/i.test(a.host) && Number(a.port || 11434) === port; };
  const id = Object.keys(all).find((s) => all[s]?.model === BONSAI && here(all[s])) ?? Object.keys(all).find((s) => here(all[s]));
  return id ? { source: id, profile: all[id], inUse: Boolean(settings.remote?.use && sourceOf(settings.remote) === id && settings.remote.model === BONSAI) } : null;
}

async function ps() {
  try {
    const j = await (await fetch(`${OLLAMA_URL()}/api/ps`, { signal: AbortSignal.timeout(2500) })).json();
    const m = (j.models ?? []).find((x) => x.name === BONSAI || x.model === BONSAI);
    return m ? { gb: m.size / 1e9, gpuPct: m.size ? Math.round((m.size_vram / m.size) * 100) : 0, ctx: m.context_length ?? null, until: m.expires_at ?? null } : null;
  } catch { return null; }
}

// What it reads with every fresh prompt: its instructions (the set it gets) and each tool, in tokens.
function readsOf(own) {
  const set = OWN_REMOTES.find((x) => x.match.test(BONSAI))?.rules ?? 'remote';
  const off = new Set(cleanToolsOff(own?.toolsOff));
  const tools = toolSchemas('app').map((t) => ({ name: t.function.name, tokens: tok(JSON.stringify(t)), what: String(t.function.description ?? '').split(/[.:]/)[0].slice(0, 60), can: TOOLS_SWITCHABLE.includes(t.function.name), on: !off.has(t.function.name) }));
  let instr = 0;
  try { instr = tok(systemPrompt({ cwd: HOME, git: 'none', set })); } catch {}
  const skills = (s) => { try { return (readSkills(undefined, s) ?? []).filter((k) => !k.off && !k.hidden).map((k) => k.name); } catch { return []; } };
  return { set: set === 'local' ? 'small models (on this Mac)' : 'big models (another machine)', instrTok: instr, tools, off: [...off], skills: skills(set), otherSkills: skills(set === 'local' ? 'remote' : 'local'), notes: Boolean(own?.notes) };
}

// Who uses it: every job of the profiles file and the profile it uses, marked when that profile is Bonsai.
function usesOf(settings) {
  const data = readProfiles(settings);
  if (!data) return { rows: [], profiles: [] };
  const isBonsai = (name) => { const p = data.profiles[name]; return Boolean(p && p.model === BONSAI); };
  const LABEL = { 'ai:main': ['Main', 'your conversations'], 'ai:side': ['Side jobs', 'saved notes, sorting a request, summaries'], 'ai:btw': ['/btw', 'side questions'], 'ai:designWrite': ['Design writing', 'pages it writes'], 'ai:pictures': ['Pictures', 'screenshots it looks at'], 'ai:search': ['Search', 'code search'], 'ai:review': ['Review', 'second opinions'], 'ai:designCheck': ['Design check', 'checking a page'], 'ai:agents': ['/agents', 'its steps'], 'ai:helpers': ['Helper agents', 'your helper agents'] };
  const rows = Object.entries(data.uses ?? {}).filter(([k]) => k.startsWith('ai:')).map(([key, profile]) => ({ key, label: LABEL[key]?.[0] ?? key, what: LABEL[key]?.[1] ?? '', profile, model: data.profiles[profile]?.model ?? null, bonsai: isBonsai(profile) }));
  const bonsaiProfiles = Object.keys(data.profiles).filter(isBonsai);
  return { rows, profiles: Object.entries(data.profiles).map(([name, p]) => ({ name, model: p.model, bonsai: isBonsai(name) })), bonsaiProfiles };
}

// Its conversations since Bonsai 2 came (27 Oct 2026; "Bonsai" before that was another model): newest first.
const convsOf = every(30_000, () => {
  const out = [];
  const since = Date.parse('2026-10-27T00:00:00Z');
  let dirs = [];
  try { dirs = readdirSync(join(HOME, 'sessions')); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = readdirSync(join(HOME, 'sessions', d)).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const p = join(HOME, 'sessions', d, f);
      try {
        if (statSync(p).mtimeMs < since) continue;
        const text = readFileSync(p, 'utf8');
        if (!text.includes(BONSAI)) continue;
        const s = JSON.parse(text);
        out.push({ at: s.updated ?? statSync(p).mtime.toISOString(), title: String(s.title ?? '').slice(0, 80), messages: (s.messages ?? []).filter((m) => m.role === 'user').length, folder: d.replace(/^Users-[^-]+-?/, '~/').replace(/-/g, '/') });
      } catch {}
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
});
// Its results in the test record: Bonsai 2's own (from 27 Oct 2026), newest first.
function testsOf() {
  const since = '2026-10-27';
  return readRecord().filter((r) => String(r.at ?? '') >= since && /bonsai-2|bonsai 2/i.test(`${r.model ?? ''} ${r.name ?? ''}`))
    .slice(-12).reverse().map((r) => ({ at: r.at, name: r.name, passed: r.passed ?? null, total: r.total ?? null, result: r.result, secs: r.secs ?? null, note: r.note ?? '' }));
}

export function bonsaiHub({ cwd = process.cwd() } = {}) {
  const jobs = { speed: null, last: null };
  const settings = () => loadSettings(cwd);
  let file = null, header = null;
  const gguf = () => {
    if (!file) file = ollamaBlobOf(BONSAI);
    if (file && !header) { try { header = readGguf(file); } catch { header = null; } }
    return header;
  };
  const live = async () => {
    const [loaded, free] = await Promise.all([ps(), freePct()]);
    return { now: activeRequests({ model: BONSAI }), recent: recentRequests({ model: BONSAI, limit: 25 }), loaded, mac: { freePct: free }, speedJob: jobs.speed, at: Date.now() };
  };
  async function page() {
    const s = settings();
    const svc = bonsaiService(s);
    const own = svc ? ownOf({ remote: svc.profile }, BONSAI) : null;
    const g = gguf();
    const [ollama, lv] = await Promise.all([ollamaNow(), live()]);
    let mem = null;
    try { mem = statusWords(memoryStatus(cwd)); } catch {}
    return {
      model: BONSAI, service: svc ? { id: svc.source, inUse: svc.inUse } : null,
      mac: { chip, ramGB: Math.round(totalmem() / 2 ** 30), freePct: lv.mac.freePct },
      ollama: { ...ollama, kept: keptSettings(), ctxSteps: CTX_STEPS, kvTypes: KV_TYPES, logTail: logTail(8) },
      file: file ? { gb: statSync(file).size / 1e9 } : null, facts: g ? modelFacts(g) : null,
      own: own ? { rows: Object.fromEntries(OWN_ROWS.map((id) => [id, own.limits?.[id]]).filter(([, v]) => v !== undefined)), level: own.level ?? null, notes: own.notes ?? '', toolsOff: cleanToolsOff(own.toolsOff) } : null,
      ctxOwn: svc ? Number(svc.profile.contexts?.[BONSAI]) || 0 : 0,
      reads: readsOf(own), memory: mem, uses: usesOf(s), convs: await convsOf(), tests: testsOf(), speed: readSpeeds().slice(-5).reverse(),
      live: lv, last: jobs.last,
    };
  }
  const act = async (fn) => {
    try { const r = await fn(); jobs.last = { ok: true, said: r.said, at: Date.now() }; return json(r); }
    catch (e) { jobs.last = { ok: false, said: e.message, at: Date.now() }; return bad(e.message, 409); }
  };
  const clean = (x = {}) => ({ flash: x.flash !== false, kv: KV_TYPES.includes(x.kv) ? x.kv : 'q8_0', ctx: CTX_STEPS.includes(Number(x.ctx)) ? Number(x.ctx) : 0 });

  async function route(req, url) {
    if (url.pathname === '/bonsai.json' && req.method === 'GET') return json(await page());
    if (url.pathname === '/bonsai/live.json' && req.method === 'GET') return json(await live());
    if (url.pathname === '/bonsai/weights.json' && req.method === 'GET') {
      const g = gguf();
      if (!g) return bad('Bonsai’s model file was not found in Ollama’s folder', 404);
      const layer = Math.max(0, Math.min((modelFacts(g).layers || 1) - 1, Number(url.searchParams.get('layer') ?? 3)));
      const parts = layerParts(g, layer);
      const part = parts.find((p) => p.part === url.searchParams.get('part') && p.kind === 'Q2_0') ?? parts.find((p) => p.part === 'ffn_down.weight') ?? parts.find((p) => p.kind === 'Q2_0');
      let patch = null, why = null;
      try { patch = part ? q2Patch(file, g, `blk.${layer}.${part.part}`, { rows: 48, cols: 256 }) : null; } catch (e) { why = e.message; }
      return json({ layer, parts, part: part?.part ?? null, patch, why });
    }
    if (!url.pathname.startsWith('/bonsai/')) return null;
    if (req.method !== 'POST') return bad('not found', 404);
    if (!fromHere(req, url)) return bad('only the hub page may do this', 403);
    let body = {};
    try { body = (await req.json()) ?? {}; } catch {}
    const p = url.pathname.slice('/bonsai/'.length);
    if (p === 'restart') return act(() => restartOllama(clean(body.settings)));
    if (p === 'stop') return act(() => stopOllama());
    if (p === 'start') return act(() => startOllama(clean(body.settings ?? keptSettings())));
    if (p === 'login') return act(() => setLogin(Boolean(body.on), clean(body.settings ?? keptSettings())));
    if (p === 'load') { const svc = bonsaiService(settings()); return act(() => loadModel(BONSAI, Number(svc?.profile.contexts?.[BONSAI]) || 65536)); }
    if (p === 'unload') return act(() => unloadModel(BONSAI));
    if (p === 'tools') {
      const svc = bonsaiService(settings());
      if (!svc) return bad('Bonsai is not set up as a service here (/remote)', 404);
      const off = cleanToolsOff(body.off);
      saveService(svc.source, (r) => {
        const tuned = { ...(r.tuned ?? {}) };
        const own = { ...(tuned[BONSAI] ?? {}) };
        if (off.length) own.toolsOff = off; else delete own.toolsOff;
        if (Object.keys(own).length) tuned[BONSAI] = own; else delete tuned[BONSAI];
        return { ...r, tuned };
      });
      return json({ ok: true, said: off.length ? `Off for Bonsai: ${off.join(', ')}. From its next conversation's first step (an open window takes it within 2 s).` : 'Every tool on for Bonsai again' });
    }
    if (p === 'speed') {
      if (jobs.speed) return bad('the speed test is already running', 409);
      const svc = bonsaiService(settings());
      jobs.speed = { since: Date.now() };
      speedTest({ url: OLLAMA_URL(), model: BONSAI, ctx: Number(svc?.profile.contexts?.[BONSAI]) || null })
        .then((r) => { jobs.last = { ok: true, said: `Speed test: reads ${r.readTokS} tokens a second, writes ${r.writeTokS}; a fresh prompt ${r.freshSecs} s`, at: Date.now() }; })
        .catch((e) => { jobs.last = { ok: false, said: `The speed test failed: ${e.message}`, at: Date.now() }; })
        .finally(() => { jobs.speed = null; });
      return json({ ok: true, started: 'speed' });
    }
    if (p === 'check') {
      try {
        const { url: arena } = await startBattle();
        const r = await fetch(`${arena}api/line`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bonsai check', items: [{ kind: 'check', id: 'bonsai' }] }), signal: AbortSignal.timeout(15_000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return bad(j.error ?? `the Arena answered ${r.status}`, 409);
        return json({ ok: true, said: 'The Bonsai check is in the Arena’s line' });
      } catch (e) { return bad(`the Arena did not take it: ${e.message}`, 409); }
    }
    return bad('not found', 404);
  }
  return { route };
}
