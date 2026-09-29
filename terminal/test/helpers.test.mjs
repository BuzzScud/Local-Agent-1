// The context helpers (src/agent/helpers.mjs, src/tools/codeindex.mjs): what
// comes along with a request before the first step, within its share of the
// helpers' 6,000 tokens, and nothing when the helpers are off.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { helpersOn, shareOut, fixLike, talksAboutChanges, createdNames, testReport, gitChanges, changedFiles, whoUses, chars, CEILING } from '../src/agent/helpers.mjs';
import { CodeIndex, partsOf, sameAsIndexed, pack, unpack } from '../src/tools/codeindex.mjs';
import { repoMap } from '../src/tools/repomap.mjs';
import { questionFor, FIX_QUESTION } from '../src/flows/clarify.mjs';
import { syntaxError, pageScriptError } from '../src/agent/tools.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const TASKS = join(import.meta.dir, '..', '..', 'models', 'evals', 'bench', 'tasks');
const tmp = (name) => mkdtempSync(join(tmpdir(), `agentic-helpers-${name}-`));
const copyTask = (name) => { const d = join(tmp(name), 'project'); cpSync(join(TASKS, name, 'project'), d, { recursive: true }); return d; };
const copyFixture = (name) => { const d = join(tmp(name), 'project'); cpSync(join(import.meta.dir, name), d, { recursive: true }); return d; };
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });

// A stand-in for the small model: one number per word it knows, so a text
// is close to another when they share those words.
const WORDS = ['walk', 'skip', 'folder', 'money', 'format', 'tax', 'total', 'report'];
class WordEmbedder {
  constructor() { this.model = { id: 'words', file: 'words.gguf' }; this.texts = 0; }
  async embed(texts) {
    this.texts += texts.length;
    return texts.map((t) => {
      const low = String(t).toLowerCase();
      const v = new Float32Array(WORDS.length + 1);
      WORDS.forEach((w, i) => { if (low.includes(w)) v[i] = 1; });
      v[WORDS.length] = 0.3;
      const n = Math.hypot(...v);
      return v.map((x) => x / n);
    });
  }
}

async function run(cwd, prompt, replies, { helpers = 'all', embedder = null, ranker = null, flows = false, prewarm = false } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows, maxTries: 2, confirmPlan: false, helpers, embedder, ranker, indexDir: tmp('index'),
    ask: async () => ({ choice: 'yes' }) });
  for (const t of ['tool', 'note', 'context']) agent.on(t, (e) => events.push({ type: t, ...e }));
  if (prewarm) await agent.codeSearch()?.build();
  const reason = await agent.send(prompt);
  await fake.close();
  const first = fake.requests.find((r) => r.stream)?.messages ?? [];
  return { reason, events, agent, fake, first, given: events.filter((e) => e.type === 'tool' && e.given).map((e) => `${e.label}(${e.arg})`), helpers: events.find((e) => e.type === 'context' && e.title === 'Helpers'), readFirst: events.find((e) => e.type === 'note' && /^Read first/.test(e.text))?.text ?? null };
}

// ————— Which are on, and the share of 6,000 tokens —————

test('AGENTIC_HELPERS: unset or "all" is every helper, "off" none, or a list', () => {
  expect([...helpersOn('')]).toEqual(['named', 'tests', 'rag', 'lsp']);
  expect([...helpersOn('all')]).toEqual(['named', 'tests', 'rag', 'lsp']);
  expect([...helpersOn('off')]).toEqual([]);
  expect([...helpersOn('named, lsp,unknown')]).toEqual(['named', 'lsp']);
  expect([...helpersOn(['tests'])]).toEqual(['tests']);
});

test('each helper first takes its own share; what is left goes to what did not fit, and a smaller version is taken when the whole does not fit', () => {
  const it = (helper, n, small) => ({ helper, chars: n, name: `${helper}${n}`, ...(small ? { small: { helper, chars: small, name: `${helper}${n}-small` } } : {}) });
  // Shares in characters: named 9,000, tests 5,400, rag 5,400, lsp 1,800; all 21,600.
  const take = shareOut([it('tests', 3000), it('named', 12000, 4000), it('rag', 5000), it('rag', 5000), it('lsp', 500)]);
  // The named file is too big for its share, so its smaller version goes; the second
  // code part is over the code share but fits in what the others left.
  expect(take.map((x) => x.name)).toEqual(['tests3000', 'named12000-small', 'rag5000', 'rag5000', 'lsp500']);
  expect(take.reduce((s, x) => s + x.chars, 0)).toBeLessThanOrEqual(chars(CEILING));
  // Nothing goes past the ceiling, whatever the shares.
  expect(shareOut([it('named', 9000), it('rag', 9000), it('tests', 9000)]).map((x) => x.name)).toEqual(['named9000', 'rag9000']);
});

test('what a request is about: something broken, the work in progress, a file to make', () => {
  expect(fixLike('fix', 'x')).toBe(true);
  expect(fixLike(undefined, 'the export crashes when the list is empty')).toBe(true);
  expect(fixLike(undefined, 'add a --json flag')).toBe(false);
  expect(fixLike(undefined, 'make the button red')).toBe(false);
  expect(fixLike(undefined, 'add error handling to export.mjs')).toBe(false);
  expect(fixLike(undefined, 'prefix every id with the page name')).toBe(false);
  expect(fixLike(undefined, 'I get an error when I save')).toBe(true);
  expect(fixLike(undefined, 'the tests are red since this morning')).toBe(true);
  expect(talksAboutChanges('what did I change in the parser?')).toBe(true);
  expect(talksAboutChanges('my last edit broke the build')).toBe(true);
  expect(talksAboutChanges('add a currency option')).toBe(false);
  expect(talksAboutChanges('explain the changes a rename would need')).toBe(false);
  expect([...createdNames('Create one self-contained HTML file called notes.html that works offline')]).toEqual(['notes.html']);
  expect([...createdNames('make a new file report.md with the totals')]).toEqual(['report.md']);
  expect([...createdNames('update report.mjs so it prints the total')]).toEqual([]);
});

test('a test run as the model reads it: one line when all pass, what fails and where when not', () => {
  expect(testReport('node --test', 'ℹ tests 4\nℹ pass 4\nℹ fail 0\n', 0, { secs: 1.2 })).toBe('$ node --test\nAll 4 tests pass (1 s).');
  const failing = testReport('node --test', '✖ median of an even count (1.2ms)\n  AssertionError: 3 !== 2.5\n    at stats.test.mjs:7:39\nℹ tests 4\nℹ pass 3\nℹ fail 1\n', 1);
  expect(failing).toStartWith('$ node --test\n1 of 4 tests fail: median of an even count.');
  expect(failing).toContain('3 !== 2.5');
  expect(testReport('npm test', 'a\nb\n', null, { timedOut: true, secs: 60 })).toContain('Stopped after 60 s');
});

// ————— Recent changes —————

test('the changes not yet committed: the smaller files first, the biggest named but cut when they do not fit, and new files listed', () => {
  const cwd = copyTask('19-multifile-symbol');
  git(cwd, 'init', '-q');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'start');
  expect(gitChanges(cwd)).toBe(null);
  expect(changedFiles(cwd)).toEqual([]);
  writeFileSync(join(cwd, 'config.mjs'), readFileSync(join(cwd, 'config.mjs'), 'utf8').replace('decimals: 2', 'decimals: 3'));
  writeFileSync(join(cwd, 'report.mjs'), `${readFileSync(join(cwd, 'report.mjs'), 'utf8')}\n${'// padding line\n'.repeat(400)}`);
  writeFileSync(join(cwd, 'notes.txt'), 'new');
  const ch = gitChanges(cwd, { maxChars: 1500 });
  expect(ch.files).toEqual(['config.mjs']);
  expect(ch.text).toContain("+export const DEFAULTS = { locale: 'en-US', decimals: 3 };");
  expect(ch.text).toContain('and 1 more changed file not shown: report.mjs');
  expect(ch.text).toContain('New files git does not track yet: notes.txt');
  expect(changedFiles(cwd)).toEqual(['config.mjs', 'report.mjs', 'notes.txt']);
  expect(gitChanges(tmp('nogit'))).toBe(null);
});

// ————— Who uses what —————

test('where each name the request uses is defined and used', () => {
  const cwd = copyTask('19-multifile-symbol');
  const w = whoUses(cwd, "use it in formatMoney in format.mjs and in the report header, so buildReport(rows, { symbol: '€' }) starts with 'Total in €'", repoMap(cwd).entries);
  expect(w.names).toEqual(['formatMoney', 'buildReport']);
  // A use in its own file counts too (here a comment: the words cannot tell).
  expect(w.text.split('\n').slice(1)).toEqual(['formatMoney: defined in format.mjs:4; used in format.mjs:3; report.mjs:2, 8, 9; report.test.mjs:3, 6, 7', 'buildReport: defined in report.mjs:5; used in report.test.mjs:4, 10, 11']);
  // Everyday words that happen to be names are not taken for them.
  expect(whoUses(cwd, 'add a report of the total', repoMap(cwd).entries)).toBe(null);
});

// ————— Code found by meaning —————

test('a file is cut into its parts: a class by its methods, a long part in pieces', () => {
  const text = ['import { something } from "some-module";', '', 'export class Store {', '  constructor() {', '    this.a = 1;', '  }', '  save(item) {', '    return item;', '  }', '}', '', 'export function walk(dir) {', ...Array.from({ length: 170 }, (_, i) => `  const step${i} = ${i};`), '}'].join('\n');
  const parts = partsOf('src/store.mjs', text);
  // The class's head is one line ("export class Store {"): too little to say anything, so left out.
  expect(parts.map((p) => `${p.name} ${p.line}-${p.end}`)).toEqual(['imports and setup 1-2', 'Store › constructor 4-6', 'Store › save 7-11', 'walk (lines 12-91) 12-91', 'walk (lines 92-171) 92-171', 'walk (lines 172-183) 172-183']);
  expect(parts[0].wording).toStartWith('src/store.mjs · imports and setup\n');
  // A comment above a function goes with that function.
  const withComment = partsOf('a.mjs', 'export function one() {\n  return 1;\n}\n\n// adds two numbers\nexport function add(a, b) {\n  return a + b;\n}\n');
  expect(withComment.map((p) => `${p.name} ${p.line}-${p.end}`)).toEqual(['one 1-4', 'add 5-9']);
  const v = Float32Array.from([0.5, -0.25, 0.125, 0]);
  expect([...unpack(pack(v))].map((x) => Math.round(x * 100) / 100)).toEqual([0.5, -0.25, 0.13, 0]);
});

function codeProject() {
  const cwd = join(tmp('code'), 'project');
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
  writeFileSync(join(cwd, 'src/fs.mjs'), "const SKIP = new Set(['node_modules']);\n\n// walk a folder, and skip the ones in SKIP\nexport function walk(dir) {\n  return [dir].filter((d) => !SKIP.has(d));\n}\n");
  writeFileSync(join(cwd, 'src/money.mjs'), 'export function formatMoney(x) {\n  return `$${x.toFixed(2)}`;\n}\n');
  writeFileSync(join(cwd, 'src/tax.mjs'), 'export function addTax(x) {\n  return x * 1.2;\n}\n');
  writeFileSync(join(cwd, 'src/report.mjs'), "import { formatMoney } from './money.mjs';\nexport function totalLine(total) {\n  return `Total: ${formatMoney(total)}`;\n}\n");
  return cwd;
}

test('the index is built once and kept: a second build reads nothing again, an edited file is worked out again', async () => {
  const cwd = codeProject();
  const emb = new WordEmbedder();
  const dir = tmp('index');
  const a = new CodeIndex(cwd, emb, { dir });
  expect(a.ready).toBe(false);
  await a.build();
  expect(a.ready).toBe(true);
  const first = emb.texts;
  expect(first).toBe(a.parts.length);
  const r = await a.search('make walk skip the tmp folder too');
  expect(r.parts[0].rel).toBe('src/fs.mjs');
  expect(r.parts[0].close).toBeGreaterThan(0.9);
  expect([...r.files.keys()][0]).toBe('src/fs.mjs');
  // A new index of the same folder: all from what was kept.
  const b = new CodeIndex(cwd, emb, { dir });
  await b.build();
  expect(emb.texts).toBe(first + 1); // only the request of the search above
  // An edited file: only its parts again, and its old parts are no longer as indexed.
  const part = r.parts[0];
  writeFileSync(join(cwd, 'src/fs.mjs'), readFileSync(join(cwd, 'src/fs.mjs'), 'utf8').replace("'node_modules'", "'node_modules', 'tmp'"));
  utimesSync(join(cwd, 'src/fs.mjs'), new Date(), new Date(Date.now() + 5000));
  expect(sameAsIndexed(cwd, part)).toBe(false);
  await b.build();
  expect(emb.texts).toBeGreaterThan(first + 1);
  expect(emb.texts).toBeLessThan(first + 1 + a.parts.length);
});

test('the index waits while the model answers, and goes on when it is done', async () => {
  const emb = new WordEmbedder();
  let answering = true;
  // Code no other test has read (numbers already worked out in this process are not asked for again).
  const cwd = codeProject();
  writeFileSync(join(cwd, 'src/fresh.mjs'), `export function fresh${Date.now()}() {\n  return 'nothing like it has been read yet';\n}\n`);
  const index = new CodeIndex(cwd, emb, { dir: tmp('index'), paused: () => answering });
  const built = index.build();
  await new Promise((r) => setTimeout(r, 600));
  expect(emb.texts).toBe(0);
  expect(index.ready).toBe(false);
  answering = false;
  await built;
  expect(index.ready).toBe(true);
  expect(emb.texts).toBeGreaterThan(0);
});

// ————— In a request, step by step —————

test('files you name: Read first reads them before the first step; switched off with /helpers, it does not', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const prompt = "Add a symbol option (default '$') to the defaults in config.mjs.";
  const on = await run(cwd, prompt, [{ text: 'Done.' }], { helpers: 'named' });
  expect(on.given).toEqual(['List(the project map)', 'Read(config.mjs)']);
  expect(on.readFirst).toBe('Read first · Scout: config.mjs');
  const read = on.first.find((m) => m.role === 'tool' && m.content.startsWith('config.mjs ('));
  expect(read.content).toContain(readFileSync(join(cwd, 'config.mjs'), 'utf8').trim());
  // /helpers shows what it brought to the last request.
  expect(on.agent.lastHelpers.map((x) => `${x.from}: ${x.text}`)).toEqual(['file: config.mjs']);
  const off = await run(copyTask('19-multifile-symbol'), prompt, [{ text: 'Done.' }], { helpers: 'off' });
  expect(off.given).toEqual(['List(the project map)']);
  expect(off.readFirst).toBe(null);
});

test('a file the request asks to make is never swapped for a look-alike that exists', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const r = await run(cwd, 'Create a new file called formats.mjs with a formatDate function.', [{ text: 'Done.' }], { helpers: 'named' });
  expect(r.given).toEqual(['List(the project map)']);
});

test('tests: a fix request gets the failing run before the first step, as a run it made itself', async () => {
  const cwd = copyFixture('fixture-fix');
  const r = await run(cwd, 'The tests fail, fix the bug.', [{ text: 'Done.' }], { helpers: 'tests' });
  expect(r.given).toEqual(['Bash(node --test)']);
  const bash = r.first.find((m) => m.role === 'tool');
  expect(bash.content).toStartWith('(Agentic Coder ran the tests before your first step; nothing has changed since.)\n$ node --test\n1 of 4 tests fail: median of an even count');
  expect(r.events.some((e) => e.type === 'note' && /Running node --test first/.test(e.text))).toBe(true);
  expect(r.helpers.items[0]).toMatchObject({ from: 'tests', text: 'node --test · 1 of 4 fail' });
  // A request that is not about something broken: no run.
  const add = await run(copyFixture('fixture-fix'), 'Add a mode function to stats.mjs.', [{ text: 'Done.' }], { helpers: 'tests' });
  expect(add.given).toEqual([]);
});

// A long file whose opening says nothing about the task: Read first can only
// give its outline, and the code search brings the function that matters.
function bigFile(cwd) {
  const filler = (from, n) => Array.from({ length: n }, (_, i) => `export function part${from + i}() {\n  return ${from + i};\n}\n`).join('');
  writeFileSync(join(cwd, 'src/big.mjs'), `${filler(0, 180)}// walk every folder in the tree, and skip the tmp one\nexport function walkFolders(dir) {\n  return [dir].filter((d) => d !== 'tmp');\n}\n${filler(180, 180)}`);
  return cwd;
}

test('code by meaning: Read first gives the closest file whole, and the code search adds the closest function of a long one', async () => {
  const emb = new WordEmbedder();
  const r = await run(bigFile(codeProject()), 'make walk skip the tmp folder too', [{ text: 'Done.' }], { helpers: 'rag', embedder: emb, ranker: emb, prewarm: true });
  expect(r.readFirst).toBe('Read first · Oracle, by meaning: src/fs.mjs');
  expect(r.given).toEqual(['List(the project map)', 'Read(src/fs.mjs)', 'Read(src/big.mjs)']);
  expect(r.helpers.items.map((x) => x.text)).toEqual(['src/big.mjs · walkFolders']);
  expect(r.helpers.items[0].close).toBeGreaterThan(0.9);
  const part = r.first.findLast((m) => m.role === 'tool');
  expect(part.content).toMatch(/^src\/big\.mjs \(lines 541-544 of \d+; pass offset to read more\):\n\/\/ walk every folder/);
  expect(r.agent.lastHelpers.map((x) => `${x.from}: ${x.text}`)).toEqual(['code: src/fs.mjs', 'code: src/big.mjs · walkFolders']);
  // Nothing close: nothing comes.
  const none = await run(codeProject(), 'update the licence year', [{ text: 'Done.' }], { helpers: 'rag', embedder: new WordEmbedder(), prewarm: true });
  expect(none.given).toEqual(['List(the project map)']);
  // Not built yet (code no one has read): the request goes on without it, and the build starts.
  const fresh = bigFile(codeProject());
  writeFileSync(join(fresh, 'src/fresh.mjs'), `export function fresh${Date.now()}() {\n  return 'nothing like it has been read yet';\n}\n`);
  const early = await run(fresh, 'make walk skip the tmp folder too', [{ text: 'Done.' }], { helpers: 'rag', embedder: new WordEmbedder() });
  expect(early.given).toEqual(['List(the project map)']);
  expect(early.helpers.items[0]).toMatchObject({ from: 'code', skipped: expect.stringMatching(/^still indexing: \d+ of \d+ parts$/) });
});

test('who uses what comes as one search the model did not have to make', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const r = await run(cwd, 'Make formatMoney round to whole numbers.', [{ text: 'Done.' }], { helpers: 'lsp' });
  expect(r.given).toEqual(['List(the project map)', 'Search(formatMoney)']);
  expect(r.first.findLast((m) => m.role === 'tool').content).toContain('formatMoney: defined in format.mjs:4; used in format.mjs:3; report.mjs:2, 8, 9; report.test.mjs:3, 6, 7');
});

// ————— The light checks —————

test('a syntax check for JSX, TypeScript and a page\'s own scripts, only when asked for', () => {
  expect(syntaxError('a.jsx', 'export const A = () => <div>hi</div>;\n', { more: true })).toBe(null);
  expect(syntaxError('a.jsx', 'export const A = () => <div>hi</div>;\nfunction (\n', { more: true })).toMatch(/\(line 2\)$/);
  expect(syntaxError('a.ts', 'function f(a: string {\n}\n', { more: true })).toMatch(/Expected "\)"/);
  expect(syntaxError('a.jsx', 'function (\n')).toBe(null); // the way before: JSX not checked
  const page = '<!doctype html>\n<title>x</title>\n<script src="https://x/y.js"></script>\n<script>\nconst ok = 1;\n</script>\n<script>\nfunction (\n</script>\n';
  expect(pageScriptError(page)).toMatch(/of the page\)$/);
  expect(pageScriptError(page.replace('function (', 'function f() {}'))).toBe(null);
});

test('a Write whose file does not parse says so in its own reply; an Edit that would break a page is turned away', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const r = await run(cwd, 'Create a page called view.html that shows the report.', [
    { tool: { name: 'Write', args: { path: 'view.html', content: '<!doctype html>\n<meta charset="utf-8">\n<script>\nconst rows = [;\n</script>\n' } } },
    { tool: { name: 'Edit', args: { path: 'view.html', old_text: 'const rows = [;', new_text: 'const rows = [];' } } },
    { tool: { name: 'Edit', args: { path: 'view.html', old_text: 'const rows = [];', new_text: 'const rows = [[;' } } },
    { text: 'Done.' },
  ], { helpers: 'lsp' });
  const results = r.agent.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  expect(results.find((c) => c.startsWith('Created view.html'))).toMatch(/But it does not parse yet: .*of the page\)\. Fix that with Edit before going on\.$/);
  expect(results.some((c) => c.startsWith('Updated view.html'))).toBe(true);
  expect(results.find((c) => c.startsWith('That edit would break view.html'))).toBeTruthy();
});

// ————— The question before starting —————

test('"fix the bug" with passing tests names the files changed since the last commit when the tests helper is on', async () => {
  const cwd = copyTask('22-vague-fix-the-bug');
  git(cwd, 'init', '-q');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'start');
  writeFileSync(join(cwd, 'slug.mjs'), `${readFileSync(join(cwd, 'slug.mjs'), 'utf8')}\n// changed\n`);
  const ctx = { cwd, testCmd: 'npm test', helpers: new Set(['tests']) };
  expect((await questionFor(ctx, 'fix the bug')).question).toBe(`${FIX_QUESTION} (Changed since the last commit: slug.mjs.)`);
  expect((await questionFor({ ...ctx, helpers: new Set() }, 'fix the bug')).question).toBe(FIX_QUESTION);
});
