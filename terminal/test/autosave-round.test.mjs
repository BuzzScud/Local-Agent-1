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

// As real rounds end with Claude (9 Oct 2026): every saved fact came with the request, so the round
// is "known", and a commit or an answer ends "done" with no file changed. The old rule skipped them all.
test('on a service a round that ended "done" and "known" is still read; a llama.cpp side slot keeps skipping it; a declined round never runs', () => {
  const o = inChild(`
    const answer = { add: [{ kind: 'project', text: 'The legend fix was pushed as abc1234.', turn: 1 }], drop: [] };
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify(answer) }) });
    const real = () => [{ ...lesson(), request: 'commit and push', outcome: 'done', files: [], known: true }];
    setEndpoint(fake.url, { remote: true, kind: 'openai', model: 'some-model' });
    const svc = new AutoSave({ agent: agentOn(fake.url, { lessons: real() }) });
    out.svc = Boolean(await svc.now());
    out.facts = readFacts(dirs.project).map((f) => f.text);
    out.svcCalls = fake.requests.length;
    const declined = new AutoSave({ agent: agentOn(fake.url, { lessons: [{ ...real()[0], outcome: 'declined' }] }) });
    out.declined = await declined.now();
    const llamaFake = await startFakeServer([], { route: () => ({ text: JSON.stringify(answer) }) });
    setEndpoint(llamaFake.url, { remote: true, kind: 'llama', model: 'm' });
    const llama = new AutoSave({ agent: agentOn(llamaFake.url, { lessons: real(), slots: { main: 0, side: 1 } }) });
    out.llama = [llama.canRunNow, await llama.now()];
    out.calls = [fake.requests.length, llamaFake.requests.length];
    await fake.close();
    await llamaFake.close();
  `);
  expect(o.svc).toBe(true);
  expect(o.facts).toEqual(['The legend fix was pushed as abc1234.']);
  expect(o.svcCalls).toBe(1);
  expect(o.declined).toBe(null);
  expect(o.llama).toEqual([true, null]);
  expect(o.calls).toEqual([1, 0]);
});

test('llama side slot, a known round: skipped as before, the model is never called', () => {
  const o = inChild(`
    const fake = await startFakeServer([], { route: () => ({ text: '{"add":[{"kind":"project","text":"Never saved: a known round.","turn":1}],"drop":[]}' }) });
    setEndpoint(fake.url, { remote: true, kind: 'llama', model: 'm' });
    const save = new AutoSave({ agent: agentOn(fake.url, { lessons: [{ ...lesson(), known: true }], slots: { main: 0, side: 1 } }) });
    out.run = [save.onService, save.canRunNow, save.worth, await save.now()];
    out.calls = fake.requests.length;
    out.facts = readFacts(dirs.project).length;
    await fake.close();
  `);
  expect(o.run).toEqual([false, true, false, null]);
  expect(o.calls).toBe(0);
  expect(o.facts).toBe(0);
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
