// The save after each round (src/app/autosave.mjs): it runs when the model decides too (Claude),
// and on a service it needs no side slot; on a llama.cpp server without one it still waits.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// In its own process with its own home and memory (the folders are read when the code loads).
function inChild(body, { save = 'auto' } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-round-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, 'legend.js'), 'export const z = 0;\n');
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    const { startFakeServer } = await import(${src('test/fake-server.mjs')});
    const { memoryDirs, readFacts } = await import(${src('src/agent/facts.mjs')});
    const { MODELS, DEFAULT_MODEL, setEndpoint } = await import(${src('../models/index.mjs')});
    const { AutoSave } = await import(${src('src/app/autosave.mjs')});
    const repo = ${JSON.stringify(repo)};
    const dirs = memoryDirs(repo);
    const model = MODELS[DEFAULT_MODEL];
    const lesson = () => ({ request: 'fix the legend', kind: null, outcome: 'passed', reason: 'done', files: ['legend.js'], tries: [], findings: [], warnings: [], recalled: [] });
    const agentOn = (url, o = {}) => ({ url, model, cwd: repo, memory: {}, way: 'model', slots: null, busy: false, lessons: [lesson()], messages: [{ role: 'user', content: 'fix the legend' }], sideUse: () => undefined, ...o });
    const out = {};
    ${body}
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: join(base, 'home'), AGENTIC_MEMORY: join(base, 'about-you'), AGENTIC_MEMORY_SAVE: save }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('the model decides, on a service with no side slot: the round is saved on its own, and the quit and first-use saves stay off', () => {
  const o = inChild(`
    const answer = { add: [{ kind: 'worked', text: 'Worked: the legend showed after the fix in legend.js.', turn: 1 }], drop: [] };
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify(answer) }) });
    setEndpoint(fake.url, { remote: true, kind: 'openai', model: 'some-model' });
    const said = [];
    const save = new AutoSave({ agent: agentOn(fake.url), say: (t) => said.push(t) });
    out.flags = [save.afterTaskOn, save.onService, save.canRunNow, save.on];
    out.saved = await save.now();
    out.facts = readFacts(dirs.project).map((f) => f.text);
    out.said = said;
    out.calls = fake.requests.length;
    out.seed = await save.seed();
    await fake.close();
  `);
  expect(o.flags).toEqual([true, true, true, false]);
  expect(o.facts).toEqual(['Worked: the legend showed after the fix in legend.js.']);
  expect(o.said.some((t) => t.startsWith('Memory:'))).toBe(true);
  expect(o.calls).toBe(1);
  expect(o.seed).toBe(null);
});

test('a llama.cpp server without a side slot still waits for the window to close; with saving off nothing runs', () => {
  const o = inChild(`
    const fake = await startFakeServer([], { route: () => ({ text: '{"add":[],"drop":[]}' }) });
    setEndpoint(fake.url, { remote: true, kind: 'llama', model: 'm' });
    const llama = new AutoSave({ agent: agentOn(fake.url) });
    out.llama = [llama.onService, llama.canRunNow, await llama.now()];
    const withSide = new AutoSave({ agent: agentOn(fake.url, { slots: { main: 0, side: 1 } }) });
    out.withSide = withSide.canRunNow;
    out.calls = fake.requests.length;
    await fake.close();
  `);
  expect(o.llama).toEqual([false, false, null]);
  expect(o.withSide).toBe(true);
  expect(o.calls).toBe(0);
  const off = inChild(`
    const save = new AutoSave({ agent: agentOn('http://127.0.0.1:1') });
    out.off = [save.afterTaskOn, save.canRunNow];
  `, { save: 'off' });
  expect(off.off).toEqual([false, false]);
});
