// Two slots + saving the warmed-up instructions to disk, with the real 27B.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, statSync, openSync } from 'node:fs';
const R = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, ''); // the repo
const { MODELS, DEFAULT_MODEL, thinkingKwargs, SERVER_BIN } = await import(`${R}/models/registry.mjs`);
const { serverArgs } = await import(`${R}/models/runtime/server.mjs`);
const { systemPrompt, toolSchemas } = await import(`${R}/terminal/index.mjs`);
const m = MODELS[DEFAULT_MODEL];
const dir = new URL('./slots/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const PORT = 17654, URL0 = `http://127.0.0.1:${PORT}`;
const args = () => { const a = serverArgs(m, { ctx: 32768, port: PORT }); a[a.indexOf('-np') + 1] = '2'; return [...a, '-kvu', '--slot-save-path', dir]; };
let srv;
const log = openSync(new URL('./server.log', import.meta.url).pathname, 'a');
async function start() {
  const t0 = Date.now();
  srv = spawn(SERVER_BIN, args(), { stdio: ['ignore', log, log] });
  for (;;) { try { if ((await fetch(`${URL0}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return (Date.now() - t0) / 1000;
}
const stop = async () => { srv.kill(); await new Promise((r) => srv.once('exit', r)); };
const fp = () => { const t = execFileSync('footprint', ['-p', String(srv.pid)], { encoding: 'utf8' }); const x = /phys_footprint:\s*([\d.]+)\s*(MB|GB)/.exec(t); return x ? Number(x[1]) / (x[2] === 'MB' ? 1000 : 1) : null; };
const post = async (path, body) => { const t0 = Date.now(); const r = await fetch(`${URL0}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { secs: (Date.now() - t0) / 1000, status: r.status, j }; };
const sys = { role: 'system', content: systemPrompt({ cwd: `${R}/terminal/demo-project`, git: 'test' }) };
const tools = toolSchemas();
const kw = thinkingKwargs(m, false);
const chat = (slot, content, max = 40) => post('/v1/chat/completions', { messages: [sys, { role: 'user', content }], tools, max_tokens: max, temperature: 0, cache_prompt: true, id_slot: slot, chat_template_kwargs: kw });
const out = {};
out.start1 = await start();
out.loaded = fp();
// The prefix: everything before the first user message's text.
const MARK = '\u0001MARK\u0001';
const tpl = await post('/apply-template', { messages: [sys, { role: 'user', content: MARK }], tools, chat_template_kwargs: kw });
const prompt = tpl.j.prompt ?? '';
const prefix = prompt.slice(0, prompt.indexOf(MARK));
out.prefixChars = prefix.length; out.templateOk = prompt.includes(MARK);
const warm = await post('/completion', { prompt: prefix, n_predict: 0, cache_prompt: true, id_slot: 0 });
out.warm = { secs: warm.secs, prompt_n: warm.j.timings?.prompt_n, status: warm.status };
const save = await post('/slots/0?action=save', { filename: 'warm.bin' });
out.save = { secs: save.secs, status: save.status, n_saved: save.j.n_saved, mb: Math.round(statSync(dir + 'warm.bin').size / 1e6) };
// A sorting request in the other slot, then the real first message in slot 0.
const side = await post('/v1/chat/completions', { messages: [{ role: 'system', content: 'You sort a request to a coding assistant into one kind.' }, { role: 'user', content: 'Request: tidy up\n\nKinds: question, rename, fix, change, other.' }], max_tokens: 20, temperature: 0, id_slot: 1, chat_template_kwargs: kw });
out.side = { secs: side.secs, prompt_n: side.j.timings?.prompt_n };
const first = await chat(0, 'hello');
out.firstAfterSide = { secs: first.secs, prompt_n: first.j.timings?.prompt_n, text: first.j.choices?.[0]?.message?.content?.slice(0, 100) };
out.memTwoSlots = fp();
await stop();
// Restart and restore from disk.
out.start2 = await start();
const rest = await post('/slots/0?action=restore', { filename: 'warm.bin' });
out.restore = { secs: rest.secs, status: rest.status, n_restored: rest.j.n_restored, err: rest.j.error?.message };
const first2 = await chat(0, 'hello');
out.firstAfterRestore = { secs: first2.secs, prompt_n: first2.j.timings?.prompt_n, text: first2.j.choices?.[0]?.message?.content?.slice(0, 100) };
const tool = await chat(0, 'What does export.mjs print? Read it first.', 80);
out.toolAfterRestore = { secs: tool.secs, prompt_n: tool.j.timings?.prompt_n, calls: JSON.stringify(tool.j.choices?.[0]?.message?.tool_calls?.map((c) => c.function)) };
out.memEnd = fp();
await stop();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
