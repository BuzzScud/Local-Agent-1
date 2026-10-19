// A Write that came without its content, asked for again in raw mode (agent-step.mjs rereadCall, qwen-raw.mjs).
// 19 Oct 2026: asked for the whole call again, Qwen3.6 on an Ollama service wrote the path and closed the call,
// three times in one conversation (logs/qwen-reread.jsonl). Now what came is written for it and the missing
// parameter opened, so what it writes next is that parameter's text.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-qwen-reread-home-'));
const { givenParams, callOpening, readCallText } = await import('../src/agent/qwen-raw.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { TOOL_DEFS } = await import('../src/agent/tools-defs.mjs');
const { fakeOllama } = await import('./fake-ollama.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const WRITE = TOOL_DEFS.find((d) => (d.function?.name ?? d.name) === 'Write');

test('what came of a call is written as its parameters, then the missing one is opened; read back whole', () => {
  const given = givenParams({ path: '/a/b.html' }, 'content');
  expect(given).toBe('<parameter=path>\n/a/b.html\n</parameter>\n<parameter=content>\n');
  expect(callOpening({ thinking: false, name: 'Write', given }).endsWith(`<tool_call>\n<function=Write>\n${given}`)).toBe(true);
  expect(readCallText(`${given}<h1>Hi</h1>\n</parameter>\n`, WRITE)).toEqual({ path: '/a/b.html', content: '<h1>Hi</h1>' });
  // Nothing came whole: only the missing parameter is opened.
  expect(givenParams({}, 'old_text')).toBe('<parameter=old_text>\n');
});

test('a Write that came with only its path is asked for again with its content opened, and the file is written', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-qwen-reread-'));
  const svc = await fakeOllama();
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, model: 'thinker:35b', family: 'qwen35moe', numCtx: 131072, keepAlive: -1, free: true });
  try {
    const a = new Agent({ url: svc.url, model: { ...local, remote: { model: 'thinker:35b' } }, cwd, system: 'You are the main agent.', ctx: 131072, memory: false, flows: false, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'remote', checkIns: false, confirmPlan: false });
    a.look = 'off';
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send('write the report to report.html');
    const raw = svc.seen.filter((s) => s.path === '/api/generate' && s.body.raw);
    expect(raw.length).toBe(1);
    expect(raw[0].body.prompt.endsWith('<function=Write>\n<parameter=path>\nreport.html\n</parameter>\n<parameter=content>\n')).toBe(true);
    expect(existsSync(join(cwd, 'report.html'))).toBe(true);
    expect(readFileSync(join(cwd, 'report.html'), 'utf8')).toBe('<h1>Report</h1>');
    expect(notes.some((t) => /asked for it once more and read it here: it was whole \(path, content\)/.test(t))).toBe(true);
  } finally { dropEndpoint(svc.url); await svc.close(); }
});

test('a whole file pasted into the reply (no Write) is saved: a Write is opened for it and the body streamed in', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-paste-write-'));
  const svc = await fakeOllama();
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, model: 'thinker:35b', family: 'qwen35moe', numCtx: 131072, keepAlive: -1, free: true });
  try {
    const a = new Agent({ url: svc.url, model: { ...local, remote: { model: 'thinker:35b' } }, cwd, system: 'You are the main agent.', ctx: 131072, memory: false, flows: false, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'remote', checkIns: false, confirmPlan: false });
    a.look = 'off';
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send('make me a dashboard page in dash.html');
    // The reply pasted the file, so the app opened a Write in raw mode (content opened) and saved what came.
    const raw = svc.seen.filter((s) => s.path === '/api/generate' && s.body.raw);
    expect(raw.length).toBe(1);
    expect(raw[0].body.prompt.endsWith('<function=Write>\n<parameter=path>\ndash.html\n</parameter>\n<parameter=content>\n')).toBe(true);
    expect(existsSync(join(cwd, 'dash.html'))).toBe(true);
    expect(readFileSync(join(cwd, 'dash.html'), 'utf8')).toContain('<h1>Dashboard saved</h1>');
    expect(notes.some((t) => /pasted the whole file/i.test(t))).toBe(true);
    expect(notes.some((t) => /Saved it as dash\.html/.test(t))).toBe(true);
  } finally { dropEndpoint(svc.url); await svc.close(); }
});
