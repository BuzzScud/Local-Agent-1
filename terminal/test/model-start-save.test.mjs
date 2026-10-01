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
