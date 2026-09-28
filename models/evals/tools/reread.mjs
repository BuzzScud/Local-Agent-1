// Why does each step of a conversation re-read so much? (Optimization probe.)
// Runs one real question with the real model, records every request the agent
// sends, renders each prompt exactly as the model sees it (/apply-template),
// and finds where step N+1 stops matching step N. When a step only adds to the
// previous one, the server can continue; when an earlier part changed, it has
// to re-read from a checkpoint before that point.
//   node models/evals/tools/reread.mjs [--minutes 12] [--out file.json]
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL, thinkingKwargs, modelFolder } from '../../index.mjs';
import { ModelServer } from '../../index.mjs';
import { warmUp } from '../../index.mjs';
import { Agent, systemPrompt, projectNotes, gitSummary, SESSION_MARK, toolSchemas } from '../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[DEFAULT_MODEL];

const base = mkdtempSync(join(tmpdir(), 'agentic-reread-'));
const src = join(base, 'agentic-coder');
mkdirSync(src);
for (const [from, to] of [['terminal/src', 'src'], ['README.md', 'README.md'], ['package.json', 'package.json']]) cpSync(join(root, from), join(src, to), { recursive: true });

const srv = new ModelServer(model);
const st = await srv.start({ ctx: 32768, share: false });
process.on('uncaughtException', async (e) => { console.error(e); await srv.stop(); process.exit(1); });
process.on('unhandledRejection', () => {}); // a stopped request's leftovers
const system = systemPrompt({ cwd: src, notes: projectNotes(src).text, git: gitSummary(src) });
await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model, system, tools: toolSchemas(), thinking: false, slot: 0 });

// Record what the agent sends (conversation requests only) and what the
// server says it re-read.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const res = await realFetch(url, init);
  if (String(url).endsWith('/v1/chat/completions') && init?.body) {
    const body = JSON.parse(init.body);
    if (body.tools) {
      const rec = { messages: JSON.parse(JSON.stringify(body.messages)), kwargs: body.chat_template_kwargs, at: Date.now() };
      sent.push(rec);
      // Read the stream's final timings without disturbing the agent.
      const [a, b] = res.body.tee();
      (async () => { const text = await new Response(b).text(); const m = [...text.matchAll(/"timings":(\{[^}]*\})/g)].pop(); if (m) { try { rec.timings = JSON.parse(m[1]); } catch {} } })().catch(() => {}); // a stopped request just has no timings
      return new Response(a, { status: res.status, headers: res.headers });
    }
  }
  return res;
};

const agent = new Agent({ url: srv.url, model, cwd: src, system, thinking: false, ctx: 32768, mode: 'plan', flows: true, slots: st.slots > 1 ? { main: 0, side: 1 } : undefined, ask: async () => ({ choice: 'no' }) });
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), Number(opt('minutes', 12)) * 60_000);
const t0 = Date.now();
try { await agent.send('Read src/app/App.jsx and explain, step by step, what happens when the app starts.', { signal: ac.signal }); } catch {}
clearTimeout(timer);
await new Promise((r) => setTimeout(r, 1000));
globalThis.fetch = realFetch;

// Render every recorded prompt and compare each with the one before.
const render = async (rec) => {
  const r = await realFetch(`${srv.url}/apply-template`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: rec.messages, tools: toolSchemas(), chat_template_kwargs: rec.kwargs ?? thinkingKwargs(model, false) }) });
  return (await r.json()).prompt ?? '';
};
const prompts = [];
for (const rec of sent) prompts.push(await render(rec));
await srv.stop();

const steps = [];
for (let i = 1; i < prompts.length; i++) {
  const prev = prompts[i - 1];
  const next = prompts[i];
  // The previous prompt ends with the "assistant is about to speak" header;
  // what it wrote comes after that, so compare up to that header.
  const header = prev.lastIndexOf('<|im_start|>assistant');
  const keep = header > 0 ? prev.slice(0, header) : prev;
  let n = 0;
  while (n < keep.length && n < next.length && keep[n] === next[n]) n++;
  const extends_ = n === keep.length;
  // Which message was the first to differ?
  let msg = null;
  const pm = sent[i - 1].messages;
  const nm = sent[i].messages;
  for (let k = 0; k < Math.min(pm.length, nm.length); k++) if (JSON.stringify(pm[k]) !== JSON.stringify(nm[k])) { msg = { index: k, role: nm[k].role, before: JSON.stringify(pm[k]).slice(0, 240), after: JSON.stringify(nm[k]).slice(0, 240) }; break; }
  steps.push({
    step: i + 1,
    previousChars: keep.length, sameChars: n, extendsPrevious: extends_,
    rereadTokens: sent[i].timings?.prompt_n ?? null, readSecs: sent[i].timings ? Math.round(sent[i].timings.prompt_ms / 100) / 10 : null,
    wroteTokens: sent[i].timings?.predicted_n ?? null,
    changedMessage: msg,
    around: extends_ ? null : { previous: keep.slice(Math.max(0, n - 100), n + 140), next: next.slice(Math.max(0, n - 100), n + 140) },
  });
}
const out = {
  at: new Date().toISOString(), secs: Math.round((Date.now() - t0) / 1000), requests: sent.length,
  totalRereadTokens: sent.reduce((s, r) => s + (r.timings?.prompt_n ?? 0), 0),
  totalWrittenTokens: sent.reduce((s, r) => s + (r.timings?.predicted_n ?? 0), 0),
  stepsThatExtend: steps.filter((s) => s.extendsPrevious).length,
  steps,
};
const file = opt('out', join(modelFolder(model), 'results', `reread-${out.at.replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`${out.requests} requests in ${out.secs}s; re-read ${out.totalRereadTokens} tokens, wrote ${out.totalWrittenTokens}; ${out.stepsThatExtend} of ${steps.length} steps only added to the previous prompt`);
for (const s of steps.filter((x) => !x.extendsPrevious).slice(0, 5)) console.log(`  step ${s.step}: re-read ${s.rereadTokens}; first change in message ${s.changedMessage?.index} (${s.changedMessage?.role})`);
