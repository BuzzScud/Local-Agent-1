// The memory's save at quit when the model is off (/stop, or never started): nothing loads
// after the window has gone. The save waits in a .wait file for the next /start in that folder,
// which hands it to its own process on the model just loaded (AutoSave.runWaiting).
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Each case runs in a process of its own: HOME is fixed when models/ is first imported.
function run(body) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-start-save-'));
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    const { readdirSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { AutoSave, waitingFor, runJob, jobsDir } = await import(${src('src/app/autosave.mjs')});
    const { MODELS, DEFAULT_MODEL, scanServers } = await import(${src('../models/index.mjs')});
    const repo = ${JSON.stringify(repo)};
    const model = MODELS[DEFAULT_MODEL];
    const agent = { cwd: repo, memory: {}, model, url: 'http://127.0.0.1:0', ctx: 32768, slots: null, lessons: [{ request: 'fix the legend', kind: 'fix', outcome: 'passed', files: ['legend.js'] }], messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'fix the legend' }, { role: 'assistant', content: 'Fixed.' }] };
    const files = () => { try { return readdirSync(jobsDir()).sort(); } catch { return []; } };
    const out = {};
    ${body}
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  // AGENTIC_BIN: the process a save is handed to; /usr/bin/true stands in (it only has to start).
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: join(base, 'home'), AGENTIC_MEMORY: join(base, 'about-you'), AGENTIC_MEMORY_SAVE: 'on', AGENTIC_BIN: '/usr/bin/true' }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('quitting with the model off keeps the save for the next /start, and /start hands it over on the model just loaded', () => {
  const out = run(`
    const save = new AutoSave({ agent });
    out.handed = save.leave({ stopAfter: true, modelOff: true });
    out.afterQuit = files();
    out.waiting = waitingFor(repo).length;
    out.elsewhere = waitingFor(join(repo, 'other')).length;
    // The next window here: /start has loaded the model.
    agent.url = 'http://127.0.0.1:17600'; agent.slots = { main: 0, side: 1 };
    out.ran = save.runWaiting();
    out.afterStart = files();
    const job = JSON.parse(readFileSync(join(jobsDir(), out.afterStart[0]), 'utf8'));
    out.job = { url: job.url, slot: job.slot, stopAfter: job.stopAfter, review: job.review, lessons: job.lessons.length };
  `);
  expect(out.handed).toBe(false); // nothing handed over at quit: no process loads the model for it
  expect(out.afterQuit).toHaveLength(1);
  expect(out.afterQuit[0]).toMatch(/\.wait$/);
  expect(out.waiting).toBe(1);
  expect(out.elsewhere).toBe(0); // only the folder it was made in
  expect(out.ran).toBe(1);
  expect(out.afterStart).toHaveLength(1);
  expect(out.afterStart[0]).toMatch(/\.json$/); // handed to its own process
  expect(out.job).toEqual({ url: 'http://127.0.0.1:17600', slot: 1, stopAfter: false, review: true, lessons: 1 }); // the window keeps its model
});

test('a save handed over at quit never loads the model itself: if it has gone, the save waits for /start', async () => {
  const out = run(`
    mkdirSync(jobsDir(), { recursive: true });
    const file = join(jobsDir(), '1-1.json');
    writeFileSync(file, JSON.stringify({ cwd: repo, home: null, url: 'http://127.0.0.1:17600', remote: false, model: model.id, slot: 1, ctx: 32768, stopAfter: true, review: true, ask: false, lessons: agent.lessons, messages: agent.messages }));
    out.result = await runJob(file);
    out.files = files();
    out.servers = scanServers().length;
  `);
  expect(out.result).toBe(null);
  expect(out.files).toEqual(['1-1.wait']);
  expect(out.servers).toBe(0); // nothing was started
});

// The audit of 18 Nov 2026: a copy registered but not answering (or an https `coding serve`, or one ending as it was
// found) made ModelServer.start load a copy of its own for the save. Only a copy that answers is joined.
test('a save handed over at quit joins only a copy that answers: one that does not leaves the save waiting, nothing loaded', async () => {
  const out = run(`
    const { spawn } = await import('node:child_process');
    // a registered "server" that is alive but answers nothing on its port
    const fake = spawn('sleep', ['30'], { stdio: 'ignore' });
    mkdirSync(join(process.env.AGENTIC_HOME, 'servers'), { recursive: true });
    writeFileSync(join(process.env.AGENTIC_HOME, 'servers', '17991.json'), JSON.stringify({ pid: fake.pid, owner: process.pid, port: 17991, ctx: 8192, slots: 1, model: model.file, linger: 60 }));
    mkdirSync(jobsDir(), { recursive: true });
    const file = join(jobsDir(), '1-1.json');
    writeFileSync(file, JSON.stringify({ cwd: repo, home: null, url: 'http://127.0.0.1:17991', remote: false, model: model.id, slot: 1, ctx: 32768, stopAfter: false, review: true, ask: false, lessons: agent.lessons, messages: agent.messages }));
    out.result = await runJob(file);
    out.files = files();
    out.servers = scanServers().map((e) => e.port);
    fake.kill();
  `);
  expect(out.result).toBe(null);
  expect(out.files).toEqual(['1-1.wait']);
  expect(out.servers).toEqual([17991]); // nothing else was started
});

// A job file still being written does not parse yet: it is left for its writer, and an old broken one does not stop the
// others from being read (sinceLastTime ended at the first .done it could not read).
test('job files that do not parse: a fresh one is left alone, an old one goes, and the others are still read', () => {
  const out = run(`
    const { utimesSync } = await import('node:fs');
    const { sinceLastTime, pendingFor } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src/app/autosave.mjs'))});
    mkdirSync(jobsDir(), { recursive: true });
    const at = (name, text, ageMs = 0) => { const f = join(jobsDir(), name); writeFileSync(f, text); if (ageMs) { const t = (Date.now() - ageMs) / 1000; utimesSync(f, t, t); } };
    at('a.done', '{ "cwd": "' + repo.replace(/\\\\/g, '/') + '", "li'); // being written
    at('b.done', 'broken', 5 * 60_000); // broken for minutes
    at('c.done', JSON.stringify({ cwd: repo, line: 'Memory: 2 saved' }));
    at('d.wait', '{ "at": "', 0);
    at('e.pending', '{ "at": "', 0);
    at('f.wait', 'broken', 5 * 60_000);
    out.lines = sinceLastTime(repo);
    out.waiting = waitingFor(repo).length;
    out.pending = pendingFor(repo).length;
    out.files = files();
  `);
  expect(out.lines).toEqual(['Memory, saved when you last quit: 2 saved']);
  expect(out.files).toEqual(['a.done', 'd.wait', 'e.pending']); // the fresh ones stay for their writers; c was read and let go
  expect(out.waiting).toBe(0);
  expect(out.pending).toBe(0);
});
