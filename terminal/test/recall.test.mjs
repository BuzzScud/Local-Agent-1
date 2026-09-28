// Bringing facts back (src/agent/recall.mjs): by meaning with the small
// model, by words without it; and in a conversation, where the facts travel
// with the request and earn or lose trust by how the turn ends.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recall, recallNotes, wordsOf, looksLikeEvent } from '../src/agent/recall.mjs';
import { memoryDirs, applyChanges, readFacts, changeTrust, openMemory } from '../src/agent/facts.mjs';
import { digest } from '../src/agent/memory.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';
import { demoReplies } from './demo-script.mjs';
import { FakeEmbedder } from './fake-embedder.mjs';

function place() {
  const home = mkdtempSync(join(tmpdir(), 'agentic-recall-'));
  const repo = join(home, 'work', 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  cpSync(join(import.meta.dir, '..', 'demo-project'), repo, { recursive: true });
  const dirs = memoryDirs(repo, home);
  applyChanges(dirs.project, { add: [
    { kind: 'project', text: 'Run the tests with `node --test`.' },
    { kind: 'project', text: 'Every page about Agentic Coder is saved in the DOCS folder.' },
    { kind: 'worked', text: 'Worked: the symbol list showed again after lowering the legend\'s z-index.' },
    { kind: 'project', text: 'The flags are read in export.mjs.' },
    { kind: 'project', text: 'The colours are set in theme.css.' }, // names a file that is not there
  ] }, { today: '2026-09-26' });
  applyChanges(dirs.you, { add: [{ kind: 'you', text: 'Commit and push only when the user says so.' }, { kind: 'you', always: true, text: 'When you are stuck, ask.' }] }, { today: '2026-09-26' });
  return { home, repo, ...dirs };
}
const texts = (r) => r.facts.map((f) => f.text);

// 28 Sep: "Created a self-contained notes.html on the Desktop…" came along with
// a profile card and a weather widget request, telling the model a page existed.
test('a note that only says what happened is skipped, and said so; a note on how to work still comes', async () => {
  expect(looksLikeEvent('Created a self-contained notes.html on the Desktop with local storage and modal functionality.')).toBe(true);
  expect(looksLikeEvent('Fixed the chart legend by raising the header z-index.')).toBe(true);
  expect(looksLikeEvent('Run the tests with `node --test`.')).toBe(false);
  expect(looksLikeEvent('Created pages go on the Desktop: always say the full path.')).toBe(false);
  const { home, repo, project } = place();
  applyChanges(project, { add: [{ kind: 'project', text: 'Created the tests for export.mjs and ran the suite with node --test.' }] }, { today: '2026-09-26' });
  const r = await recall(repo, 'run the tests for export.mjs with node --test', { home, today: '2026-09-27', mark: false });
  expect(texts(r)).toContain('Run the tests with `node --test`.');
  expect(texts(r)).not.toContain('Created the tests for export.mjs and ran the suite with node --test.');
  expect(r.skipped.map((f) => f.text)).toEqual(['Created the tests for export.mjs and ran the suite with node --test.']);
});

test('by meaning: the fact comes back for a request in other words; nothing for a request about something else', async () => {
  const { home, repo, project } = place();
  const embedder = new FakeEmbedder();
  const r = await recall(repo, 'can you check the suite still passes', { embedder, home, today: '2026-09-27' });
  expect(r.how).toBe('meaning');
  expect(texts(r)).toEqual(['Run the tests with `node --test`.']);
  expect(texts(await recall(repo, 'push it to github', { embedder, home }))).toEqual(['Commit and push only when the user says so.']); // from your own memory
  expect(texts(await recall(repo, 'whats the capital of brazil', { embedder, home }))).toEqual([]);
  // never: what is always read (it is in the instructions), or a fact about a file that is gone
  expect(texts(await recall(repo, 'when you are stuck ask', { embedder, home }))).toEqual([]);
  expect(texts(await recall(repo, 'where are the colours set, theme.css?', { embedder, home }))).toEqual([]);
  // the fact that came back was used
  expect(readFacts(project).find((f) => f.text.startsWith('Run the tests'))).toMatchObject({ used: 1, last: '2026-09-27' });
});

test('a fact\'s numbers are worked out once, and again only when the fact changed', async () => {
  const { home, repo, project } = place();
  const embedder = new FakeEmbedder();
  await recall(repo, 'run the suite', { embedder, home });
  expect(embedder.calls.map((c) => c.length)).toEqual([1, 4, 1]); // your 1 fact, the project's 4 (not the one about a missing file), the request
  expect(existsSync(join(project, 'vectors.json'))).toBe(true);
  await recall(repo, 'save a page', { embedder, home });
  expect(embedder.calls.map((c) => c.length)).toEqual([1, 4, 1, 1]); // only the new request
  applyChanges(project, { add: [{ text: 'Deploys go through ssh to the server.' }] });
  await recall(repo, 'deploy it', { embedder, home });
  expect(embedder.calls.map((c) => c.length)).toEqual([1, 4, 1, 1, 1, 1]); // the new fact, then the request
});

test('trust moves a fact: between two that fit alike the trusted one comes first, and a distrusted one drops out', async () => {
  const { home, repo, project } = place();
  const [a, b] = applyChanges(project, { add: [{ text: 'The legend menu is drawn above the chart symbols.' }, { text: 'The symbols menu sits under the chart legend.' }] }).added;
  const embedder = new FakeEmbedder({ cut: 0.5, margin: 0.2 });
  changeTrust(project, [b.id], +1, 'the task passed its check');
  changeTrust(project, [b.id], +1, 'the task passed its check');
  let r = await recall(repo, 'the symbol menu and the legend', { embedder, home, mark: false });
  expect(r.facts[0].id).toBe(b.id);
  changeTrust(project, [b.id], -2, 'you corrected Agentic Coder');
  changeTrust(project, [b.id], -2, 'you corrected Agentic Coder');
  changeTrust(project, [a.id], +1, 'the task passed its check');
  r = await recall(repo, 'the symbol menu and the legend', { embedder, home, mark: false });
  expect(r.facts[0].id).toBe(a.id);
});

test('without the small model, or when it does not answer: by words, and it says so once', async () => {
  const { home, repo } = place();
  const r = await recall(repo, 'where are the flags read, in export.mjs?', { home });
  expect([r.how, texts(r)]).toEqual(['words', ['The flags are read in export.mjs.']]);
  expect(texts(await recall(repo, 'run the suite', { home }))).toEqual([]); // no word in common: the gap the small model closes
  const down = await recall(repo, 'where are the flags read, in export.mjs?', { home, embedder: new FakeEmbedder({ fail: true }) });
  expect([down.how, texts(down), down.note]).toEqual(['words', ['The flags are read in export.mjs.'], "The memory's matcher did not answer (not running); matching by words."]);
  expect(wordsOf('Running the tests of z-index')).toEqual(['running', 'test', 'zindex']);
  expect((await recall(mkdtempSync(join(tmpdir(), 'agentic-empty-')), 'anything', { home: mkdtempSync(join(tmpdir(), 'agentic-nohome-')) })).how).toBe('none');
});

test('what travels with the request says what each fact is, and that the files win', () => {
  const notes = recallNotes([{ kind: 'failed', text: 'Raising the z-index of #sym-menu did nothing.' }, { kind: 'recipe', text: 'Add a page.', steps: ['build it', 'save it in DOCS'] }]);
  expect(notes).toBe('From your memory, saved in earlier conversations here. Use what fits; the files are right where a memory and a file disagree.\n- (this failed before: do not try it again) Raising the z-index of #sym-menu did nothing.\n- (steps that worked before) Add a page. 1. build it 2. save it in DOCS');
  expect(recallNotes([])).toBe('');
});

async function converse(replies, said, { answer = 'yes', embedder = new FakeEmbedder(), abortAfterMs } = {}) {
  const { home, repo, project, you } = place();
  const fake = await startFakeServer(replies);
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd: repo, system: systemPrompt({ cwd: repo, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, confirmPlan: false,
    ask: async () => ({ choice: answer }), memory: { embedder, home } });
  const events = [];
  for (const t of ['note', 'memory', 'context', 'settled']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reasons = [];
  for (const s of said) {
    const ac = new AbortController();
    if (abortAfterMs) setTimeout(() => ac.abort(), abortAfterMs);
    reasons.push(await agent.send(s, { signal: ac.signal }));
  }
  await fake.close();
  return { agent, fake, events, reasons, home, repo, project, you };
}
const trustOf = (dir, start) => readFacts(dir).find((f) => f.text.startsWith(start))?.trust;

test('in a conversation: the fact goes into the request the model reads, stays there, and is left out of the digest', async () => {
  const { agent, fake, events } = await converse([{ text: 'They pass.' }, { text: 'Hello.' }], ['can you check the suite still passes', 'and what does export.mjs do?']);
  const first = fake.requests[0].messages.find((m) => m.role === 'user').content;
  expect(first).toBe('can you check the suite still passes\n\n(From your memory, saved in earlier conversations here. Use what fits; the files are right where a memory and a file disagree.\n- (this project) Run the tests with `node --test`.)');
  // the next turn: the first request reads exactly as before, so nothing already read is read again
  expect(fake.requests.at(-1).messages.filter((m) => m.role === 'user')[0].content).toBe(first);
  // on the screen: one Context line, the fact in its list
  expect(events.find((e) => e.type === 'context').items).toMatchObject([{ from: 'memory', text: 'Run the tests with `node --test`.' }]);
  expect(events.some((e) => e.type === 'note' && /^From memory/.test(e.text))).toBe(false);
  expect(digest(agent.messages)).toContain('User: can you check the suite still passes\nAgentic Coder: They pass.');
  expect(digest(agent.messages)).not.toContain('From your memory');
});

test('the turn passed its check: the facts it used gain trust, and what happened is written down', async () => {
  const { events, reasons, project, agent } = await converse(demoReplies, ['add a --json flag to export.mjs, then run the tests']);
  expect(reasons).toEqual(['done']);
  const s = events.find((e) => e.type === 'settled');
  expect(s).toMatchObject({ outcome: 'passed', reason: 'done', kind: 'change', files: ['export.mjs', 'export.test.mjs'], request: 'add a --json flag to export.mjs, then run the tests' });
  expect(s.check).toMatchObject({ ok: true });
  expect(s.recalled.map((f) => f.text)).toEqual(['The flags are read in export.mjs.']);
  expect([trustOf(project, 'The flags are read'), trustOf(project, 'Run the tests')]).toEqual([1, 0]);
  expect(trustOf(project, 'Every page')).toBe(0); // not used, not touched
  expect(agent.lessons).toHaveLength(1);
});

test('Agentic Coder got stuck: the facts it used lose trust; you stop it: they lose more; you correct it afterwards: the same, once', async () => {
  const same = { tool: { name: 'Read', args: { path: 'export.mjs' } } };
  const stuck = await converse([same, same, same, same, same, same], ['where are the flags read, the json export?']);
  expect(stuck.reasons).toEqual(['stuck']);
  expect(stuck.events.find((e) => e.type === 'settled')).toMatchObject({ outcome: 'stuck' });
  expect(stuck.events.find((e) => e.type === 'settled').warnings[0]).toContain('kept repeating');
  expect(trustOf(stuck.project, 'The flags are read')).toBe(-1);

  const stopped = await converse([{ reasoning: 'thinking about it '.repeat(200), text: 'Done.' }], ['where are the flags read, the json export?'], { abortAfterMs: 60 });
  expect(stopped.reasons).toEqual(['interrupted']);
  expect(trustOf(stopped.project, 'The flags are read')).toBe(-2);

  const told = await converse([{ text: 'In main().' }, { text: 'Sorry.' }, { text: 'Yes.' }], ['where are the flags read, the json export?', 'no, that is wrong', 'nope, still wrong']);
  expect(told.events.filter((e) => e.type === 'settled').map((e) => e.outcome)).toEqual(['done', 'done', 'done']);
  expect(told.agent.lessons[0].corrected).toBe('no, that is wrong');
  expect(trustOf(told.project, 'The flags are read')).toBe(-2); // the second "wrong" is about the second turn, which used no fact
});

test('with no memory given, a conversation is as before: nothing brought back, nothing written', async () => {
  const { home, repo, project } = place();
  const fake = await startFakeServer([{ text: 'They pass.' }]);
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd: repo, system: systemPrompt({ cwd: repo, git: 'test' }), thinking: false, ctx: 32768, mode: 'edits', flows: false, ask: async () => ({ choice: 'yes' }) });
  await agent.send('can you check the suite still passes');
  await fake.close();
  expect(fake.requests[0].messages.find((m) => m.role === 'user').content).toBe('can you check the suite still passes');
  expect(readFacts(project).every((f) => f.used === 0 && f.trust === 0)).toBe(true);
  expect(home).toBeTruthy();
});

test('a turn that went well on a fact it was given is marked as known, and a correction takes the mark away', async () => {
  const { events, agent } = await converse([{ text: 'In main().' }, { text: 'Sorry.' }], ['where are the flags read, the json export?', 'no, that is wrong']);
  const [first] = events.filter((e) => e.type === 'settled');
  expect(first.recalled).toHaveLength(1);
  expect(first.known).toBe(true); // nothing new to learn: no save would start
  expect(agent.lessons[0]).toMatchObject({ known: false, corrected: 'no, that is wrong' }); // until the user said it was wrong
});
