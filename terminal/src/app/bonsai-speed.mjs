// The speed test of a model on this Mac's Ollama (27 Oct 2026, the hub's Bonsai tab; the Arena's "Bonsai speed test"
// runs the same through models/evals/tools/bonsai-speed.mjs). Two requests, the way a window's first two steps go:
//   1. the app's own instructions and tools, read from the start (a line of its own at the top so nothing of an earlier
//      request is reused), and a short answer: how fast it reads a prompt and writes;
//   2. the same again with one more message: how long a later step takes when what it read is kept.
// Asked at the context the model is loaded at (another would load it again), thinking off, so it measures reading and
// writing, not how long it chooses to think. Each run is kept (<home>/bonsai/speed.json, newest last) and recorded.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HOME, recordTest } from '../../../models/index.mjs';
import { systemPrompt } from '../agent/prompt.mjs';
import { toolSchemas } from '../agent/tools.mjs';

const speedFile = () => join(HOME, 'bonsai', 'speed.json');
export const readSpeeds = () => { try { return JSON.parse(readFileSync(speedFile(), 'utf8')); } catch { return []; } };
const r1 = (x) => Math.round(x * 10) / 10;

async function chat(url, body, signal) {
  const r = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: false }), signal });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
const loadedCtx = async (url, model) => {
  try { const j = await (await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(4000) })).json(); return (j.models ?? []).find((m) => m.name === model || m.model === model)?.context_length ?? null; } catch { return null; }
};

// → { at, model, ctx, readTokS, writeTokS, freshTok, freshSecs, writeTok, writeSecs, laterTok, laterReadSecs, laterSecs,
//     loadSecs, wallSecs, answered }
export async function speedTest({ url = 'http://127.0.0.1:11434', model, ctx = null, signal, record = true } = {}) {
  const t0 = Date.now();
  const numCtx = ctx ?? (await loadedCtx(url, model)) ?? 65536;
  const system = `Speed test ${new Date().toISOString()}.\n${systemPrompt({ cwd: tmpdir(), git: 'none' })}`;
  const tools = toolSchemas('app');
  const ask = 'In two short sentences: what can you do in this folder?';
  const base = { model, think: false, tools, options: { num_ctx: numCtx, num_predict: 160 } };
  const a = await chat(url, { ...base, messages: [{ role: 'system', content: system }, { role: 'user', content: ask }] }, signal);
  const b = await chat(url, { ...base, messages: [{ role: 'system', content: system }, { role: 'user', content: ask }, { role: 'assistant', content: a.message?.content ?? '' }, { role: 'user', content: 'And in one word?' }] }, signal);
  const s = (ns) => (ns ?? 0) / 1e9;
  const out = {
    at: new Date().toISOString(), model, ctx: numCtx,
    readTokS: Math.round((a.prompt_eval_count ?? 0) / Math.max(1e-3, s(a.prompt_eval_duration))),
    writeTokS: r1((a.eval_count ?? 0) / Math.max(1e-3, s(a.eval_duration))),
    freshTok: a.prompt_eval_count ?? 0, freshSecs: r1(s(a.prompt_eval_duration)), writeTok: a.eval_count ?? 0, writeSecs: r1(s(a.eval_duration)),
    laterTok: b.prompt_eval_count ?? 0, laterReadSecs: r1(s(b.prompt_eval_duration)),
    laterSecs: r1(s(b.prompt_eval_duration) + s(b.eval_duration)), loadSecs: r1(s(a.load_duration)),
    wallSecs: r1((Date.now() - t0) / 1000),
    answered: Boolean(a.message?.content?.trim() && b.message?.content?.trim()),
  };
  try {
    mkdirSync(join(HOME, 'bonsai'), { recursive: true });
    writeFileSync(speedFile(), JSON.stringify([...readSpeeds(), out].slice(-50), null, 1));
  } catch { /* kept when it can be */ }
  if (record) recordTest({ kind: 'other', name: `Speed test: ${model} on this Mac's Ollama`, model: `remote:${model}`, ctx: numCtx, result: 'pass', secs: out.wallSecs,
    note: `reads ${out.readTokS} tokens/s, writes ${out.writeTokS}/s; a fresh prompt of ${out.freshTok.toLocaleString()} tokens ${out.freshSecs} s; a later step ${out.laterSecs} s (what it read kept); loading ${out.loadSecs} s` });
  return out;
}
