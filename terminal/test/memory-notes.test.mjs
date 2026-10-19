// A note after every answer, and the facts save at once (src/agent/notes.mjs, src/app/autosave.mjs;
// 19 Oct 2026, the owner: "ensure the agentic coder updates memory after every result").
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { noteEntry, writeNote, dueNotes, foldNote, notesToday, notesFolder, readNote, localDay } from '../src/agent/notes.mjs';

const dirsIn = () => { const base = mkdtempSync(join(tmpdir(), 'agentic-notes-')); return { you: join(base, 'you'), project: join(base, 'project') }; };
const lesson = (o = {}) => ({ request: 'fix the legend', outcome: 'passed', files: ['legend.js'], check: { cmd: 'bun test legend', ok: true }, warnings: [], answer: 'Fixed: the legend shows again.', ...o });

test('a note says when, how it ended, what was asked and said, the files and the check, and leaves a key out', () => {
  const at = new Date(2026, 9, 19, 14, 5);
  const e = noteEntry(lesson({ answer: 'Done.\n```js\nconst a = 1;\n```\nIt works.' }), at);
  expect(e.split('\n')[0]).toBe('## 14:05 · passed its check');
  expect(e).toContain('- Asked: fix the legend');
  expect(e).toContain('- Said: Done. (code) It works.');
  expect(e).toContain('- Files: legend.js');
  expect(e).toContain('- Check: bun test legend ✓');
  const secret = noteEntry(lesson({ request: 'use api_key: sk-abcdefghijklmnopqrstuvwxyz0123' }), at);
  expect(secret).toContain('(left out: it held a key or a password)');
  expect(secret).not.toContain('sk-abcdef');
});

test('notes go in the day\'s file of the project\'s memory (else the one about you), one entry each', () => {
  const dirs = dirsIn();
  const now = new Date(2026, 9, 19, 9, 0);
  writeNote(dirs, lesson(), { now });
  writeNote(dirs, lesson({ request: 'add a test', outcome: 'done' }), { now: new Date(2026, 9, 19, 9, 30) });
  const file = join(notesFolder(dirs), '2026-10-19.md');
  const text = readNote(file);
  expect(text.match(/^# Notes · 2026-10-19/gm)).toHaveLength(1);
  expect(text.match(/^## /gm)).toHaveLength(2);
  expect(notesToday(dirs, now)).toBe(2);
  expect(notesFolder({ you: dirs.you, project: null })).toBe(join(dirs.you, 'notes'));
  expect(localDay(new Date(2026, 9, 19, 23, 30))).toBe('2026-10-19');
});

test('after two weeks a day\'s notes are due, and folding moves them to folded/', () => {
  const dirs = dirsIn();
  writeNote(dirs, lesson(), { now: new Date(2026, 9, 1, 10) });
  writeNote(dirs, lesson(), { now: new Date(2026, 9, 10, 10) });
  const due = dueNotes(dirs, new Date(2026, 9, 19, 12));
  expect(due.map((d) => d.day)).toEqual(['2026-10-01']);
  foldNote(dirs, due[0]);
  expect(dueNotes(dirs, new Date(2026, 9, 19, 12))).toEqual([]);
  expect(readNote(join(notesFolder(dirs), 'folded', '2026-10-01.md'))).toContain('fix the legend');
});

// The AutoSave parts in a process of their own, with its own home and memory (read when the code loads).
function inChild(body, { save = 'auto' } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-notes-run-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, 'legend.js'), 'export const z = 0;\n');
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', p));
  const script = `
    const { startFakeServer } = await import(${src('test/fake-server.mjs')});
    const { memoryDirs, readFacts } = await import(${src('src/agent/facts.mjs')});
    const notes = await import(${src('src/agent/notes.mjs')});
    const { MODELS, DEFAULT_MODEL, setEndpoint } = await import(${src('../models/index.mjs')});
    const { AutoSave } = await import(${src('src/app/autosave.mjs')});
    const repo = ${JSON.stringify(repo)};
    const dirs = memoryDirs(repo);
    const model = MODELS[DEFAULT_MODEL];
    const lesson = (o = {}) => ({ at: new Date().toISOString(), request: 'fix the legend', kind: null, outcome: 'passed', reason: 'done', files: ['legend.js'], tries: [], findings: [], warnings: [], recalled: [], answer: 'Fixed: the legend shows again.', ...o });
    const agentOn = (url, o = {}) => ({ url, model, cwd: repo, memory: {}, way: 'app', slots: null, busy: false, lessons: [], messages: [{ role: 'user', content: 'fix the legend' }], sideUse: () => undefined, ...o });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    ${body}
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: join(base, 'home'), AGENTIC_MEMORY: join(base, 'about-you'), AGENTIC_MEMORY_SAVE: save }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('an answer ends on a service: its note is written at once, the save runs with no pause, even while the next message runs, and one line says both', () => {
  const o = inChild(`
    const answer = { add: [{ kind: 'worked', text: 'Worked: the legend showed after the fix in legend.js.', turn: 1 }], drop: [] };
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify(answer) }) });
    setEndpoint(fake.url, { remote: true, kind: 'openai', model: 'some-model' });
    const said = [];
    const agent = agentOn(fake.url);
    const save = new AutoSave({ agent, say: (t, tone) => said.push([t, tone]) }); // the default 10 s pause stays the default
    const l = lesson();
    agent.lessons.push(l);
    save.settled(l);
    out.noted = notes.notesToday(dirs);
    agent.busy = true; // the next message has started
    save.stepAside();
    for (let i = 0; i < 40 && !said.length; i++) await wait(50);
    await save.running;
    out.said = said;
    out.facts = readFacts(dirs.project).map((f) => f.text);
    out.calls = fake.requests.length;
    await fake.close();
  `);
  expect(o.noted).toBe(1);
  expect(o.calls).toBe(1);
  expect(o.facts).toEqual(['Worked: the legend showed after the fix in legend.js.']);
  expect(o.said).toHaveLength(1);
  expect(o.said[0][0]).toMatch(/^Memory: noted "fix the legend" · 1 saved/);
});

test('a save that keeps nothing still says the answer was noted, "no new facts"', () => {
  const o = inChild(`
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify({ add: [], drop: [] }) }) });
    setEndpoint(fake.url, { remote: true, kind: 'openai', model: 'some-model' });
    const said = [];
    const agent = agentOn(fake.url);
    const save = new AutoSave({ agent, say: (t) => said.push(t) });
    const l = lesson({ outcome: 'done', files: [], request: 'ssh root@the-server' });
    agent.lessons.push(l);
    save.settled(l);
    for (let i = 0; i < 40 && !said.length; i++) await wait(50);
    await save.running;
    out.said = said;
    const { join } = await import('node:path');
    out.note = notes.readNote(join(notes.notesFolder(dirs), notes.localDay() + '.md'));
    await fake.close();
  `);
  expect(o.said).toEqual(['Memory: noted "ssh root@the-server" · no new facts']);
  expect(o.note).toContain('- Asked: ssh root@the-server');
});

test('a second answer while a save runs: noted at once, read when that save ends, one line for the two', () => {
  const o = inChild(`
    let n = 0;
    const fake = await startFakeServer([], { delayMs: 100, route: () => { n++; return { text: JSON.stringify({ add: [], drop: [] }) }; } });
    setEndpoint(fake.url, { remote: true, kind: 'openai', model: 'some-model' });
    const said = [];
    const agent = agentOn(fake.url);
    const save = new AutoSave({ agent, say: (t) => said.push(t) });
    const a = lesson({ request: 'first' }), b = lesson({ request: 'second' });
    agent.lessons.push(a);
    save.settled(a);
    await wait(30);
    agent.lessons.push(b);
    save.settled(b);
    out.noted = notes.notesToday(dirs);
    for (let i = 0; i < 80 && fake.requests.length < 2; i++) await wait(50);
    for (let i = 0; i < 40 && said.length < 2; i++) await wait(50);
    out.said = said;
    out.calls = fake.requests.length;
    await fake.close();
  `);
  expect(o.noted).toBe(2);
  expect(o.calls).toBe(2);
  expect(o.said.join('\n')).toContain('noted "second"');
});

test('on a llama.cpp side slot the save waits while a reply runs; the note is written all the same', () => {
  const o = inChild(`
    const fake = await startFakeServer([], { route: () => ({ text: JSON.stringify({ add: [], drop: [] }) }) });
    setEndpoint(fake.url, { remote: true, kind: 'llama', model: 'm' });
    const said = [];
    const agent = agentOn(fake.url, { slots: { main: 0, side: 1 }, busy: true });
    const save = new AutoSave({ agent, say: (t) => said.push(t) });
    const l = lesson();
    agent.lessons.push(l);
    out.busy = save.canRunNow;
    save.settled(l);
    await wait(200);
    out.calls = fake.requests.length;
    out.noted = notes.notesToday(dirs);
    out.said = said;
    await fake.close();
  `);
  expect(o.busy).toBe(false);
  expect(o.calls).toBe(0);
  expect(o.noted).toBe(1);
  expect(o.said).toEqual(['Memory: noted "fix the legend"']);
});

test('notes of two weeks ago are read once after a save, kept as facts, then moved to folded/', () => {
  const o = inChild(`
    notes.writeNote(dirs, lesson({ request: 'set up the VPN box' }), { now: new Date(Date.now() - 20 * 86400000) });
    const answers = [{ add: [], drop: [] }, { add: [{ kind: 'project', text: 'The VPN box is set up on the home network.' }], drop: [] }];
    const asked = [];
    const fake = await startFakeServer([], { route: (req) => { asked.push(JSON.stringify(req.body ?? req)); return { text: JSON.stringify(answers.shift() ?? { add: [], drop: [] }) }; } });
    setEndpoint(fake.url, { remote: true, kind: 'openai', model: 'some-model' });
    const said = [];
    const agent = agentOn(fake.url);
    const save = new AutoSave({ agent, say: (t) => said.push(t) });
    const l = lesson();
    agent.lessons.push(l);
    save.settled(l);
    for (let i = 0; i < 80 && said.length < 2; i++) await wait(50);
    if (save.running) await save.running;
    out.said = said;
    out.due = notes.dueNotes(dirs).length;
    out.facts = readFacts(dirs.project).map((f) => f.text);
    out.calls = fake.requests.length;
    out.read = asked.some((a) => a.includes('set up the VPN box'));
    await fake.close();
  `);
  expect(o.calls).toBe(2);
  expect(o.read).toBe(true);
  expect(o.due).toBe(0);
  expect(o.facts).toContain('The VPN box is set up on the home network.');
  expect(o.said[1]).toMatch(/^Memory: the notes of \d{4}-\d{2}-\d{2} folded in · 1 saved/);
});

test('with saving off, nothing is noted', () => {
  const o = inChild(`
    const agent = agentOn('http://127.0.0.1:0');
    const save = new AutoSave({ agent, say: () => {} });
    save.settled(lesson());
    out.noted = notes.notesToday(dirs);
  `, { save: 'off' });
  expect(o.noted).toBe(0);
});
