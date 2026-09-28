// Claude's notes as a second place the memory looks (src/agent/claude-notes.mjs):
// read where they are and never changed, notes about sign-ins, servers and
// secrets left out, the right note found for a request, and its part that
// fits written into the request.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notesDir, readNotes, leftOut, holdsSecret, pieces, bestPart, recallClaude, claudeText, notesCount, wording, foldersOf } from '../src/agent/claude-notes.mjs';
import { CLAUDE_RULES } from '../src/agent/claude-rules.mjs';
import { openMemory, readFacts, memoryNotes, applyChanges, memoryDirs } from '../src/agent/facts.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';
import { FakeEmbedder } from './fake-embedder.mjs';

const note = (name, description, type, body) => `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;
const NOTES = {
  'MEMORY.md': '# Working style\n- [Explain simply](explain-simply.md) — status reports too · [PDF from HTML (START HERE for "make a pdf")](pdf-from-html.md)\n- [Droplet](equity-droplet.md) — deploy steps\n',
  'explain-simply.md': note('explain-simply', '"for how-does-it-work questions lead with the plain picture, outcome first"', 'feedback', 'When the user asks how something works, answer with the plain picture first.\n\n**Why:** a thorough answer with file references got "explain simply".\n\n**How to apply:** three to five short steps, one line each.'),
  'pdf-from-html.md': note('pdf-from-html', 'How to make a pdf from an html page with the browser the project already has', 'reference', 'Render the page in a headless browser and print it to a pdf.\n\n- Use the page size A4 and print the background.\n- The server runs on http://127.0.0.1:17530 while the pdf is made.\n- ssh orbit "cat /var/www/site/.env" shows the production values\n- The API key is sk-abcdefghijklmnopqrstuvwxyz012345\n- A reply holds at most 2,048 tokens, so long pages are written in parts.'),
  'legend-fix.md': note('legend-fix', 'The symbol list was hidden behind the legend; the fix was one z-index', 'project', 'The menu sat inside the header strip.\n\nRaising the strip above the legend fixed it.'),
  'equity-droplet.md': note('equity-droplet', 'Where the site runs and how a deploy is done', 'reference', 'ssh orbit, then run the deploy script.'),
  'desk-shared-secret.md': note('desk-shared-secret', 'How the desks prove who they are to the hub', 'project', 'Each desk sends a header.'),
  'users-page.md': note('users-page', 'What an admin sees when a user lost a password, and how it is reset', 'project', 'The admin opens the Users page.'),
  'check-a-page.md': note('check-a-page', 'How to look at a page without a browser window; pages behind login need a saved session', 'reference', 'Open it headless and take a picture.'),
};
function folder(files = NOTES) {
  const dir = mkdtempSync(join(tmpdir(), 'bonsai-claude-notes-'));
  for (const [n, text] of Object.entries(files)) writeFileSync(join(dir, n), text);
  return dir;
}
const store = () => mkdtempSync(join(tmpdir(), 'bonsai-claude-store-'));
const snapshot = (dir) => readdirSync(dir).sort().map((n) => `${n} ${statSync(join(dir, n)).mtimeMs} ${statSync(join(dir, n)).size}`).join('\n');

test('the notes are found in Claude Code\'s memory folder for the home folder, or where the setting says; "off" means none', () => {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-claude-home-'));
  const slug = home.replace(/[/.]/g, '-');
  const dir = join(home, '.claude', 'projects', slug, 'memory');
  mkdirSync(dir, { recursive: true });
  expect(notesDir({ home })).toBe(null); // no list of notes in it yet
  writeFileSync(join(dir, 'MEMORY.md'), '# notes\n');
  expect(notesDir({ home })).toBe(dir);
  const other = folder();
  expect(notesDir({ home, setting: other })).toBe(other);
  expect(notesDir({ home, setting: false })).toBe(null);
  expect(notesDir({ home, setting: 'off' })).toBe(null);
  expect(notesDir({ home, setting: join(home, 'nowhere') })).toBe(null);
});

test('a note is read with its name, summary, kind and what Claude\'s own list calls it', () => {
  const notes = readNotes(folder());
  expect(notes.map((n) => n.id).sort()).toEqual(['check-a-page', 'desk-shared-secret', 'equity-droplet', 'explain-simply', 'legend-fix', 'pdf-from-html', 'users-page']);
  const pdf = notes.find((n) => n.id === 'pdf-from-html');
  expect(pdf).toMatchObject({ name: 'pdf-from-html', type: 'reference', description: 'How to make a pdf from an html page with the browser the project already has', title: 'PDF from HTML (START HERE for "make a pdf")' });
  expect(notes.find((n) => n.id === 'explain-simply').description).toBe('for how-does-it-work questions lead with the plain picture, outcome first'); // the quotes are not part of it
  expect(wording(pdf)).toStartWith('PDF from HTML (START HERE for "make a pdf"). pdf from html: How to make a pdf');
});

test('notes about sign-ins, servers and secrets are left out whole; a word in passing does not leave a note out', () => {
  const dir = folder();
  const out = Object.fromEntries(readNotes(dir).map((n) => [n.id, leftOut(n)]));
  expect(out).toEqual({
    'explain-simply': null, 'pdf-from-html': null, 'legend-fix': null,
    'check-a-page': null, // "pages behind login" in a recipe for looking at a page
    'equity-droplet': 'it is about a server of yours',
    'desk-shared-secret': 'it is about signing in or a secret',
    'users-page': 'its summary names a secret',
  });
  expect(notesCount(dir)).toMatchObject({ all: 7, used: 4 });
});

test('in a note that is kept, a line that holds a secret or a way in is left out; counting tokens is not a secret', () => {
  for (const line of ['ssh orbit "cat /var/www/site/.env"', 'The API key is sk-abcdefghijklmnopqrstuvwxyz012345', 'the password is hunter2hunter2', 'it reads desks/ladder/.env for the names', 'the server at 164.92.10.7 answers', 'send the auth token with each request', 'token: 9f8e7d6c5b4a39281706f5e4d3c2b1a0']) expect([line, holdsSecret(line)]).toEqual([line, true]);
  for (const line of ['A reply holds at most 2,048 tokens', 'it writes 10 tokens a second', 'The server runs on http://127.0.0.1:17530', 'the secret scan found nothing', 'Open the page and take a picture']) expect([line, holdsSecret(line)]).toEqual([line, false]);
  const pdf = readNotes(folder()).find((n) => n.id === 'pdf-from-html');
  const text = pieces(pdf).join('\n');
  expect(text).toContain('http://127.0.0.1:17530');
  expect(text).toContain('2,048 tokens');
  expect(text).not.toContain('ssh orbit');
  expect(text).not.toContain('sk-abc');
});

test('the part of a note that goes along: its summary, then the pieces that share words with the request, cut to size', () => {
  const pdf = readNotes(folder()).find((n) => n.id === 'pdf-from-html');
  const part = bestPart(pdf, 'which page size do I print the pdf in, and with the background?', 260);
  expect(part).toStartWith('How to make a pdf from an html page with the browser the project already has\n');
  expect(part).toContain('Use the page size A4 and print the background.');
  expect(part.length).toBeLessThanOrEqual(262);
  expect(part).not.toContain('sk-abc');
});

test('by meaning: the note that fits comes back, nothing for a request about something else, and never a note that is left out', async () => {
  const dir = folder();
  const before = snapshot(dir);
  const keep = store();
  const embedder = new FakeEmbedder();
  const got = async (q) => (await recallClaude('/tmp/somewhere', q, { embedder, dir, store: keep })).notes.map((n) => n.id);
  expect(await got('the dropdown menu is under the legend again')).toEqual(['legend-fix']);
  expect(await got('turn this html report into a pdf')).toEqual(['pdf-from-html']);
  expect(await got('whats the capital of brazil')).toEqual([]);
  // The droplet note fits "deploy to the server over ssh" best, and it is left out.
  expect(await got('deploy to the server over ssh')).toEqual([]);
  const r = await recallClaude('/tmp/somewhere', 'turn this html report into a pdf', { embedder, dir, store: keep });
  expect(r).toMatchObject({ how: 'meaning', of: 4 });
  expect(r.notes[0].part).not.toContain('sk-abc');
  // Agentic Coder's numbers are kept in its own folder; Claude's folder is as it was, to the byte and the second.
  expect(existsSync(join(keep, 'vectors.json'))).toBe(true);
  expect(snapshot(dir)).toBe(before);
  // The notes' numbers were worked out once, then only the request's.
  expect(embedder.calls.filter((c) => c.length > 1).length).toBe(1);
});

test('read where they are: a note written after the first request is there for the next one', async () => {
  const dir = folder();
  const keep = store();
  const embedder = new FakeEmbedder();
  const ask = async () => (await recallClaude('/tmp/somewhere', 'commit and push it to github', { embedder, dir, store: keep })).notes.map((n) => n.id);
  expect(await ask()).toEqual([]);
  writeFileSync(join(dir, 'commit-rule.md'), note('commit-rule', 'Commit and push only when the user says so', 'feedback', 'Ask before a push.'));
  expect(await ask()).toEqual(['commit-rule']);
});

test('without the small model the notes are matched by the words they share with the request', async () => {
  const dir = folder();
  const r = await recallClaude('/tmp/somewhere', 'the symbol list is hidden behind the legend', { embedder: null, dir, store: store() });
  expect(r.how).toBe('words');
  expect(r.notes.map((n) => n.id)).toEqual(['legend-fix']);
  expect((await recallClaude('/tmp/somewhere', 'add a flag', { embedder: null, dir, store: store() })).notes).toEqual([]);
});

test('what goes with the request says whose notes these are and that the files are right', () => {
  const text = claudeText([{ name: 'pdf-from-html', type: 'reference', part: 'How to make a pdf.\nUse A4.' }]);
  expect(text).toStartWith("From Claude's notes. Claude Code wrote these for itself in earlier conversations with this user. The request above comes first:");
  expect(text).toContain('When the notes hold the answer to a question, answer from them now');
  expect(text).toContain('do not go looking for them');
  expect(text).toContain('where a file in THIS folder says otherwise, the file is right');
  expect(text).toContain('[pdf from html] (how something is done on this Mac)\nHow to make a pdf.\nUse A4.');
  expect(claudeText([])).toBe('');
});

async function converse(prompt, memory) {
  const cwd = mkdtempSync(join(tmpdir(), 'bonsai-claude-agent-'));
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  const fake = await startFakeServer([{ text: 'Print it from a headless browser, in A4.' }]);
  const events = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, memory, ask: async () => ({ choice: 'yes' }) });
  for (const t of ['note', 'memory', 'context']) agent.on(t, (e) => events.push({ type: t, ...e }));
  await agent.send(prompt);
  await fake.close();
  return { agent, fake, events };
}

test('in a conversation the note goes into the request itself, with one Context line on the screen', async () => {
  const dir = folder();
  const home = mkdtempSync(join(tmpdir(), 'bonsai-claude-you-'));
  const { agent, fake, events } = await converse('how do I turn this html report into a pdf?', { embedder: new FakeEmbedder(), home, save: false, claude: { dir, store: store() } });
  const sent = fake.requests.filter((r) => r.stream)[0].messages.find((m) => m.role === 'user').content;
  expect(sent).toStartWith('how do I turn this html report into a pdf?\n\n(From Claude\'s notes.');
  expect(sent).toContain('[pdf from html] (how something is done on this Mac)');
  expect(sent).not.toContain('sk-abc');
  expect(agent.messages[1].content).toBe(sent); // written into the request, so what was read stays read
  expect(events.find((e) => e.type === 'context').items).toMatchObject([{ from: 'Claude', text: 'pdf from html' }]);
  expect(events.find((e) => e.type === 'memory' && e.claude)).toMatchObject({ how: 'meaning', of: 4, claude: [{ id: 'pdf-from-html', type: 'reference' }] });
});

test('Claude\'s notes switched off, or a request no note fits: the request goes as it was typed', async () => {
  const dir = folder();
  const home = mkdtempSync(join(tmpdir(), 'bonsai-claude-you-'));
  const off = await converse('how do I turn this html report into a pdf?', { embedder: new FakeEmbedder(), home, save: false, claude: false });
  expect(off.agent.messages[1].content).toBe('how do I turn this html report into a pdf?');
  const none = await converse('whats the capital of brazil?', { embedder: new FakeEmbedder(), home, save: false, claude: { dir, store: store() } });
  expect(none.agent.messages[1].content).toBe('whats the capital of brazil?');
  expect(none.events.some((e) => e.type === 'memory')).toBe(false);
});

test('the thirteen lines on how the user likes things done are saved once, always read, and short enough to read at every start', () => {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-claude-rules-'));
  const repo = join(home, 'work', 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  expect(CLAUDE_RULES.length).toBe(13); // the user read the fifteen and dropped two (28 Sep)
  expect(CLAUDE_RULES.every((r) => r.always && r.kind === 'you' && r.text.length <= 130)).toBe(true);
  const first = openMemory(repo, { home, today: '2026-09-28', rules: CLAUDE_RULES });
  expect(first.rules.length).toBe(13);
  const { you } = memoryDirs(repo, home);
  expect(readFacts(you).filter((f) => f.always).length).toBe(15); // with the two rules the user gave Agentic Coder directly
  // A line the user removed does not come back at the next start.
  const gone = readFacts(you).find((f) => f.text.startsWith('Explain simply'));
  applyChanges(you, { retire: [{ id: gone.id, reason: 'removed by the user' }] });
  expect(openMemory(repo, { home, today: '2026-09-29', rules: CLAUDE_RULES }).rules).toEqual([]);
  expect(readFacts(you).some((f) => f.text.startsWith('Explain simply'))).toBe(false);
  // What is read at every start: about 1,700 characters, some 8 seconds of reading.
  const notes = memoryNotes(repo, { home }).text;
  expect(notes).toStartWith('Always\n- ');
  expect(notes).toContain('- Never say a check passed unless you ran it and read what it printed.');
  expect(notes.length).toBeLessThan(1900);
  // Without the rules handed in (tests, practice runs) nothing but the first two is saved.
  const bare = mkdtempSync(join(tmpdir(), 'bonsai-claude-rules-'));
  mkdirSync(join(bare, 'r', '.git'), { recursive: true });
  expect(openMemory(join(bare, 'r'), { home: bare }).rules).toEqual([]);
});

test('for work on the code here, a note about another project of the user\'s does not come along; their ways of working still do', async () => {
  const dir = folder({ ...NOTES, 'commit-rule.md': note('commit-rule', 'Commit and push only when the user says so', 'feedback', 'Ask before a push.') });
  const embedder = new FakeEmbedder();
  const ask = async (cwd, q, kind) => (await recallClaude(cwd, q, { embedder, dir, store: store(), kind })).notes.map((n) => n.id);
  // legend-fix is a note about a project: it fits the words, and this is another project.
  expect(await ask('/Users/someone/shop', 'fix it: the dropdown menu is under the legend', 'fix')).toEqual([]);
  expect(await ask('/Users/someone/shop', 'why was the dropdown menu under the legend?', 'question')).toEqual(['legend-fix']);
  // In the project the note is about (its folder is named in the note), it comes along for a fix too.
  writeFileSync(join(dir, 'shopfront-legend.md'), note('shopfront-legend', 'In shopfront the symbol menu sat under the legend until the strip was raised', 'project', 'Raise the strip.'));
  expect(await ask('/Users/someone/work/shopfront', 'fix it: the dropdown menu is under the legend', 'fix')).toEqual(['shopfront-legend']);
  // How the user likes things done holds in every project.
  expect(await ask('/Users/someone/shop', 'commit and push it to github', 'change')).toEqual(['commit-rule']);
  // A folder name any project could have is not a project's name.
  expect(foldersOf('/Users/someone/Desktop/MAIN2026/desks/chart', '/Users/someone')).toEqual(['main2026', 'chart']);
  expect(foldersOf('/private/var/folders/t7/abc123def/T/bonsai-eval-1-json-flag-x9Qr2k/project', '/Users/someone')).toEqual([]);
});
