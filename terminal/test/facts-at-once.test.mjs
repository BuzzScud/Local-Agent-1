// Two Agentic Coder windows in one folder save at the same moment (part 1 of the
// memory plan, step 7). Each window is its own process, as in real use, and
// both start their save on the same millisecond. Afterwards every fact has
// to be there, once, under a name of its own, and the log and the list of
// facts have to hold them all.
import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFacts, readLog, applyChanges, changeTrust, locked } from '../src/agent/facts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FACTS = join(here, '..', 'src', 'agent', 'facts.mjs');

// One window: waits for the agreed moment, then saves its facts in one save.
const WINDOW = `
const { applyChanges, changeTrust } = await import(${JSON.stringify(FACTS)});
const [dir, at, job] = process.argv.slice(-3);
const work = JSON.parse(job);
while (Date.now() < Number(at)) {}
let out;
if (work.add) out = applyChanges(dir, { add: work.add }, { batch: work.batch, why: 'save' });
if (work.trust) out = changeTrust(dir, work.trust.ids, work.trust.delta, 'two windows at once', { batch: work.batch });
process.stdout.write(JSON.stringify({ added: out.added?.length ?? 0, refused: out.refused ?? [], changed: out.changed?.length ?? 0 }));
`;

function openWindow(dir, at, job) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', WINDOW, dir, String(at), JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AGENTIC_NO_RECORD: '1' } });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out || '{}')) : reject(new Error(`the window ended with ${code}: ${err.slice(-600)}`))));
  });
}

const place = () => { const dir = join(mkdtempSync(join(tmpdir(), 'agentic-at-once-')), 'memory'); mkdirSync(dir, { recursive: true }); return dir; };
// The same first six words in every fact, so both windows reach for the same file name.
const facts = (w, n) => Array.from({ length: n }, (_, i) => ({ kind: 'project', text: `The build for this project needs step ${w}${i + 1} before the tests of window ${w} can run`, from: `window ${w}` }));

test('two windows save at the same moment: no fact is lost, none is written over, and the log and the list hold them all', async () => {
  for (let round = 0; round < 5; round++) {
    const dir = place();
    const at = Date.now() + 700;
    const [a, b] = await Promise.all([
      openWindow(dir, at, { add: facts('A', 12), batch: `save-a-${round}` }),
      openWindow(dir, at, { add: facts('B', 12), batch: `save-b-${round}` }),
    ]);
    expect([round, a.added, b.added, a.refused, b.refused]).toEqual([round, 12, 12, [], []]);
    const saved = readFacts(dir);
    const texts = saved.map((f) => f.text).sort();
    expect([round, texts]).toEqual([round, [...facts('A', 12), ...facts('B', 12)].map((f) => f.text).sort()]);
    // Every fact under its own name, and nothing left half written.
    expect(new Set(saved.map((f) => f.id)).size).toBe(24);
    expect(readdirSync(join(dir, 'facts')).filter((n) => !n.endsWith('.md'))).toEqual([]);
    // The log: one whole line per fact, from both saves.
    const log = readLog(dir).filter((l) => l.what === 'add');
    expect(log.length).toBe(24);
    expect(new Set(log.map((l) => l.id))).toEqual(new Set(saved.map((f) => f.id)));
    expect(readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').every((l) => { try { JSON.parse(l); return true; } catch { return false; } })).toBe(true);
    // The list of facts names all 24.
    const list = readFileSync(join(dir, 'index.md'), 'utf8').split('\n').filter((l) => l.startsWith('- '));
    expect([round, list.length]).toEqual([round, 24]);
  }
}, 60_000);

test('two windows that learn the same thing at the same moment save it once', async () => {
  const dir = place();
  const same = [{ kind: 'project', text: 'The tests of this project run with bun run test, never with npm', from: 'both windows' }];
  const at = Date.now() + 700;
  const [a, b] = await Promise.all([openWindow(dir, at, { add: same, batch: 'save-a' }), openWindow(dir, at, { add: same, batch: 'save-b' })]);
  expect(readFacts(dir).map((f) => f.text)).toEqual([same[0].text]);
  expect(a.added + b.added).toBe(1);
  expect([...a.refused, ...b.refused].map((r) => r.why)).toEqual(['saved already']);
}, 30_000);

test('two windows that used the same fact at the same moment: both results count towards its trust', async () => {
  const dir = place();
  const [fact] = applyChanges(dir, { add: [{ kind: 'project', text: 'The server of this project starts with bun run start on port 8757', from: 'a test' }] }).added;
  const at = Date.now() + 700;
  await Promise.all([
    openWindow(dir, at, { trust: { ids: [fact.id], delta: 1 }, batch: 'trust-a' }),
    openWindow(dir, at, { trust: { ids: [fact.id], delta: 1 }, batch: 'trust-b' }),
  ]);
  const after = readFacts(dir).find((f) => f.id === fact.id);
  expect([after.trust, after.passed]).toEqual([2, 2]);
  expect(existsSync(join(dir, '.lock'))).toBe(false); // nothing is left held
  expect(changeTrust(dir, [fact.id], -1, 'later, alone').changed[0].trust).toBe(1);
  writeFileSync(join(dir, 'note.txt'), 'the folder is still writable\n');
}, 30_000);

test('a lock left behind by a window that was killed does not hold up the next save', async () => {
  // A process that has ended: its number names nobody now.
  const gone = await new Promise((resolve) => { const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }); c.on('exit', () => resolve(c.pid)); });
  const dir = place();
  mkdirSync(join(dir, '.lock'));
  writeFileSync(join(dir, '.lock', 'pid'), String(gone));
  let t0 = Date.now();
  const a = applyChanges(dir, { add: [{ kind: 'project', text: 'Saved although an old lock of a killed window was in the way', from: 'a test' }] });
  expect(a.added.length).toBe(1);
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(existsSync(join(dir, '.lock'))).toBe(false);
  // A lock with no owner written in it, older than any save takes.
  mkdirSync(join(dir, '.lock'));
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(dir, '.lock'), old, old);
  t0 = Date.now();
  expect(applyChanges(dir, { add: [{ kind: 'project', text: 'Saved although an old lock without an owner was in the way', from: 'a test' }] }).added.length).toBe(1);
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(existsSync(join(dir, '.lock'))).toBe(false);
  expect(readFacts(dir).length).toBe(2);
});

test('a change inside a change does not wait for itself', () => {
  const dir = place();
  const t0 = Date.now();
  const out = locked(dir, () => locked(dir, () => applyChanges(dir, { add: [{ kind: 'project', text: 'A save made while the folder was already held by this window', from: 'a test' }] })));
  expect(out.added.length).toBe(1);
  expect(Date.now() - t0).toBeLessThan(500);
  expect(existsSync(join(dir, '.lock'))).toBe(false);
});
