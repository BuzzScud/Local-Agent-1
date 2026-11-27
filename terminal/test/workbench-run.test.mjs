// The workbench's newer server sides (27 Nov 2026): workbench-run.mjs (the project's code, a file for the preview, the
// tests: their runner, names, command, results and a real run), workbench-debug.mjs (a real node program stopped at a
// breakpoint), and the one-file review and undo of /rewind's copies (rewind.mjs beforeOf, restoreFile; bridge-wb.mjs
// wbTurn) behind workbench-ai.js. The page's side of each is window-workbench-parts.test.mjs.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourcesOf, siteFile, runnerOf, testsIn, testsOf, testCommand, resultsOf, countsOf, makeTestRuns } from '../src/window/workbench-run.mjs';
import { makeDebugger, runtimeFor, valueOf } from '../src/window/workbench-debug.mjs';
import { Rewind } from '../src/app/rewind.mjs';
import { wbTurn } from '../src/window/bridge-wb.mjs';

const folder = (files) => {
  const f = realpathSync(mkdtempSync(join(tmpdir(), 'wbx-run-')));
  for (const [p, text] of Object.entries(files)) { mkdirSync(join(f, p, '..'), { recursive: true }); writeFileSync(join(f, p), text); }
  return f;
};

test('the project\'s code for the language service: code files whole, never node_modules, a minified file or one too big', () => {
  const f = folder({ 'src/a.mjs': 'export const a = 1;\n', 'src/b.ts': 'export const b: number = 2;\n', 'README.md': '# x\n', 'node_modules/x/index.js': 'x', 'dist/app.min.js': 'x', 'src/big.js': 'x'.repeat(500_000) });
  const r = sourcesOf(f);
  expect(r.files.map((x) => x.path).sort()).toEqual(['src/a.mjs', 'src/b.ts']);
  expect(r.files.find((x) => x.path === 'src/a.mjs').text).toBe('export const a = 1;\n');
  expect(r.cut).toBe(true); // the big one was left out, and it says so
});

test('the preview serves a file of the folder by its type, a folder by its index.html, and nothing outside it', async () => {
  const f = folder({ 'page/index.html': '<h1>x</h1>', 'page/a.css': 'h1{}' });
  const css = siteFile(f, 'page/a.css');
  expect([css.status, css.headers.get('content-type'), await css.text()]).toEqual([200, 'text/css; charset=utf-8', 'h1{}']);
  expect(await siteFile(f, 'page').text()).toBe('<h1>x</h1>');
  expect(siteFile(f, '../../etc/passwd').status).toBe(404);
  expect(siteFile(f, '%2e%2e/%2e%2e/etc/hosts').status).toBe(404);
});

test('which runner a folder uses, and the command for everything, a file or one test', () => {
  expect(runnerOf(folder({ 'bunfig.toml': '' }))).toBe('bun');
  expect(runnerOf(folder({ 'package.json': '{"devDependencies":{"vitest":"1"}}', 'bun.lock': '' }))).toBe('vitest');
  expect(runnerOf(folder({ 'package.json': '{"devDependencies":{"jest":"29"}}' }))).toBe('jest');
  expect(runnerOf(folder({ 'go.mod': 'module x' }))).toBe('go');
  expect(runnerOf(folder({ 'pyproject.toml': '' }))).toBe('pytest');
  expect(runnerOf(folder({ 'package.json': '{}' }))).toBe('node');
  expect(runnerOf(folder({ 'notes.txt': '' }))).toBe(null);
  const f = folder({ 'package.json': '{"scripts":{"test":"node run.mjs"}}' });
  expect(testCommand(f, 'bun')).toEqual(['bun', 'run', 'test']);
  expect(testCommand(f, 'bun', { path: 'a.test.mjs', name: 'adds (2)' })).toEqual(['bun', 'test', './a.test.mjs', '-t', '^adds \\(2\\)$']);
  expect(testCommand(f, 'pytest', { path: 't/test_a.py', name: 'TestA::test_b' })).toEqual(['python3', '-m', 'pytest', '-rA', '-q', 't/test_a.py::TestA::test_b']);
  expect(testCommand(f, 'go', { path: 'pkg/a_test.go', name: 'TestA' })).toEqual(['go', 'test', '-v', '-run', '^TestA$', './pkg']);
  expect(testCommand(f, 'vitest', { path: 'a.test.ts', name: 'group > adds' })).toEqual(['npx', 'vitest', 'run', '--reporter=verbose', './a.test.ts', '-t', 'adds']);
});

test('the tests of a file by name and line: a describe in front, quotes inside, skip and each; Python classes; Go', () => {
  const js = "import { test } from 'bun:test';\ndescribe('cart', () => {\n  test('adds one', () => {});\n  it.skip(\"won't add a negative\", () => {});\n  describe('tax', () => {\n    test.each([1])('rounds %d', () => {});\n  });\n});\ntest('alone', () => {});\n";
  expect(testsIn(js, 'js')).toEqual([
    { name: 'cart > adds one', short: 'adds one', line: 3 }, { name: "cart > won't add a negative", short: "won't add a negative", line: 4 },
    { name: 'cart > tax > rounds %d', short: 'rounds %d', line: 6 }, { name: 'alone', short: 'alone', line: 9 },
  ]);
  expect(testsIn("test('it\\'s fine', () => {});\n", 'js')[0].name).toBe("it's fine");
  expect(testsIn('def test_a():\n  pass\nclass TestB:\n    def test_c(self):\n        pass\ndef helper():\n    pass\n', 'py').map((t) => t.name)).toEqual(['test_a', 'TestB::test_c']);
  expect(testsIn('func TestA(t *testing.T) {}\nfunc helper() {}\n', 'go')).toEqual([{ name: 'TestA', short: 'TestA', line: 1 }]);
  const f = folder({ 'bunfig.toml': '', 'src/a.test.mjs': "test('x', () => {});\n", 'src/b.mjs': "test('not a test file', () => {});\n", 'node_modules/y/c.test.js': "test('y', () => {});\n" });
  expect(testsOf(f)).toEqual({ runner: 'bun', files: [{ path: 'src/a.test.mjs', tests: [{ name: 'x', short: 'x', line: 1 }] }] });
});

test('what a run printed → each test\'s result and the run\'s totals, for every runner', () => {
  expect(resultsOf('(pass) cart > adds one [1.50ms]\n(fail) alone\n(skip) later', 'bun')).toEqual([{ name: 'cart > adds one', state: 'pass', ms: 1.5 }, { name: 'alone', state: 'fail', ms: null }, { name: 'later', state: 'skip', ms: null }]);
  expect(resultsOf(' ✓ src/a.test.ts > cart > adds one 2ms\n × alone 5ms', 'vitest').map((r) => [r.name, r.state])).toEqual([['cart > adds one', 'pass'], ['alone', 'fail']]);
  expect(resultsOf('    ✓ adds one (3 ms)\n    ✕ alone (1 ms)', 'jest').map((r) => r.state)).toEqual(['pass', 'fail']);
  expect(resultsOf('PASSED t/test_a.py::test_a\nFAILED t/test_a.py::TestB::test_c - assert 1 == 2', 'pytest')).toEqual([{ name: 'test_a', file: 't/test_a.py', state: 'pass', ms: null }, { name: 'TestB::test_c', file: 't/test_a.py', state: 'fail', ms: null }]);
  expect(resultsOf('--- PASS: TestA (0.01s)\n--- FAIL: TestB (0.00s)', 'go').map((r) => [r.name, r.state])).toEqual([['TestA', 'pass'], ['TestB', 'fail']]);
  expect(countsOf('\n 3 pass\n 1 fail\n 9 expect() calls', 'bun')).toEqual({ pass: 3, fail: 1, skip: 0 });
  expect(countsOf(' Tests  1 failed | 2 passed (3)', 'vitest')).toEqual({ pass: 2, fail: 1, skip: 0 });
  expect(countsOf('==== 1 failed, 2 passed, 1 skipped in 0.1s ====', 'pytest')).toEqual({ pass: 2, fail: 1, skip: 1 });
  expect(countsOf('nothing ran', 'bun')).toBe(null);
});

test('a real run: what it prints comes as it goes, and its end with the results and totals', async () => {
  const f = folder({ 'bunfig.toml': '', 'a.test.mjs': "import { test, expect } from 'bun:test';\ntest('one', () => expect(1).toBe(1));\ntest('two', () => expect(1).toBe(2));\n" });
  const got = [];
  const end = new Promise((res) => { const runs = makeTestRuns({ folder: f, send: (m) => { got.push(m); if (m.ended) res(m); } }); expect(runs.run({ id: 'r1', path: 'a.test.mjs' })).toMatchObject({ ok: true, runner: 'bun' }); expect(runs.run({ id: 'r2', path: '../x.test.mjs' })).toMatchObject({ ok: false }); });
  const m = await end;
  expect(got[0].data).toBe('$ bun test ./a.test.mjs\n');
  expect(m).toMatchObject({ id: 'r1', ended: true, code: 1, counts: { pass: 1, fail: 1, skip: 0 } });
  expect(m.results.find((r) => r.name === 'two')?.state).toBe('fail');
}, 30_000);

test('the debugger: node by default, bun for a file that uses it; a value as the list shows it', () => {
  const f = folder({ 'a.mjs': 'console.log(1)\n', 'b.ts': "import { serve } from 'bun';\n", 'c.ts': 'const x: number = 1;\n' });
  expect([runtimeFor(f, 'a.mjs'), runtimeFor(f, 'b.ts'), runtimeFor(f, 'c.ts')]).toEqual(['node', 'bun', 'node']);
  expect(valueOf({ type: 'string', value: 'hi' })).toBe('"hi"');
  expect(valueOf({ type: 'number', value: 3 })).toBe('3');
  expect(valueOf({ type: 'object', subtype: 'null' })).toBe('null');
  expect(valueOf({ type: 'object', description: 'Array(3)' })).toBe('Array(3)');
  expect(valueOf({ type: 'function', description: 'function add(a, b) {\n…' })).toBe('ƒ add(a, b) {');
});

test('the debugger stops a real node program at its breakpoint, shows its variables and values, and lets it end', async () => {
  const f = folder({ 'prog.mjs': 'function add(a, b) {\n  const sum = a + b;\n  return sum;\n}\nlet total = 0;\nfor (const n of [1, 2]) total = add(total, n);\nconsole.log("total", total);\n' });
  const seen = [];
  let dbg;
  const ended = new Promise((res) => {
    dbg = makeDebugger({ folder: f, send: async (m) => {
      seen.push(m);
      if (m.op === 'paused') {
        const local = m.frames[0].scopes.find((s) => s.type === 'local');
        await dbg.cmd({ id: 'd1', op: 'props', objectId: local.objectId, req: 'p' });
        await dbg.cmd({ id: 'd1', op: 'eval', expression: 'a + b * 10', callFrameId: m.frames[0].callFrameId, req: 'e' });
        await dbg.cmd({ id: 'd1', op: 'bp', path: 'prog.mjs', line: 2, on: false });
        dbg.cmd({ id: 'd1', op: 'resume' });
      }
      if (m.op === 'ended') res();
    } });
    expect(dbg.start({ id: 'd1', path: 'prog.mjs', bps: { 'prog.mjs': [2] } })).toEqual({ ok: true, id: 'd1', runtime: 'node' });
    expect(dbg.start({ id: 'd2', path: '../elsewhere.mjs' })).toMatchObject({ ok: false });
  });
  await ended;
  const paused = seen.filter((m) => m.op === 'paused');
  expect(paused.length).toBe(1); // the breakpoint was taken away at the first stop
  expect(paused[0].frames[0]).toMatchObject({ name: 'add', path: 'prog.mjs', line: 2 });
  expect(seen.find((m) => m.req === 'p').vars.map((v) => `${v.name}=${v.value}`)).toEqual(['a=0', 'b=1', 'sum=(not set yet)']);
  expect(seen.find((m) => m.req === 'e')).toMatchObject({ value: '10', bad: false });
  expect(seen.filter((m) => m.op === 'out').map((m) => m.text).join('')).toBe('total 3\n');
  expect(seen.at(-1)).toMatchObject({ op: 'ended', code: 0 });
}, 30_000);

test('one file of a reply: as it was before, put back alone, and not when someone changed it since', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wbx-rw-')));
  const cwd = join(base, 'proj'); mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'a.js'), 'a1\n'); writeFileSync(join(cwd, 'src', 'b.js'), 'b1\n');
  const rw = new Rewind({ home: join(base, 'home'), session: 's1' });
  const p = await rw.begin({ cwd, text: 'change both, add c' });
  writeFileSync(join(cwd, 'src', 'a.js'), 'a2\n'); writeFileSync(join(cwd, 'src', 'b.js'), 'b2\n'); writeFileSync(join(cwd, 'src', 'c.js'), 'c2\n');
  await rw.finish(p, { files: ['src/a.js', 'src/b.js', 'src/c.js'] });
  // the window's list of the reply's files
  expect(wbTurn({ rewindRef: { current: rw } })).toMatchObject({ n: p.n, files: [{ path: 'src/a.js', status: 'changed', undone: false }, { path: 'src/b.js', status: 'changed', undone: false }, { path: 'src/c.js', status: 'new', undone: false }] });
  expect(await rw.beforeOf(p.n, 'src/a.js')).toEqual({ text: 'a1\n' });
  expect(await rw.beforeOf(p.n, 'src/c.js')).toEqual({ gone: true });
  expect(await rw.beforeOf(p.n, 'src/nope.js')).toMatchObject({ why: expect.any(String) });
  // a.js back alone; b.js stays the reply's
  expect(await rw.restoreFile(p.n, 'src/a.js')).toEqual({ ok: true });
  expect([readFileSync(join(cwd, 'src', 'a.js'), 'utf8'), readFileSync(join(cwd, 'src', 'b.js'), 'utf8')]).toEqual(['a1\n', 'b2\n']);
  expect(wbTurn({ rewindRef: { current: rw } }).files[0].undone).toBe(true);
  // b.js changed by someone since: left alone, with why
  writeFileSync(join(cwd, 'src', 'b.js'), 'b3 by you\n');
  expect(await rw.restoreFile(p.n, 'src/b.js')).toMatchObject({ ok: false, why: expect.stringContaining('changed since') });
  expect(readFileSync(join(cwd, 'src', 'b.js'), 'utf8')).toBe('b3 by you\n');
  // a file the reply made goes away
  expect(await rw.restoreFile(p.n, 'src/c.js')).toEqual({ ok: true });
  expect(() => readFileSync(join(cwd, 'src', 'c.js'))).toThrow();
}, 30_000);
