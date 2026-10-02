import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { findEdit, parseArgs, prepare, execute, display, resolvePath } from '../src/agent/tools.mjs';
import { diffLines } from '../src/tools/edit.mjs';

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-tools-'));
  writeFileSync(join(dir, 'a.js'), 'function add(a, b) {\n  return a + b;\n}\n\nfunction sub(a, b) {\n  return a - b;\n}\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'b.js'), 'export const port = 8790;\n');
});

test('edit: exact match once', () => {
  const r = findEdit('a\nb\nc\n', 'b\n', 'B\n');
  expect(r.ok).toBe(true);
  expect(r.after).toBe('a\nB\nc\n');
});

test('edit: more than one match asks for context or replace_all, naming the lines', () => {
  const r = findEdit('x = 1\ny = x\nz = x\n', 'x', 'w');
  expect(r.ok).toBe(false);
  expect(r.error).toContain('3 times');
  expect(r.error).toContain('replace_all');
  expect(findEdit('x = 1\ny = x\n', 'x', 'w', { replaceAll: true }).after).toBe('w = 1\ny = w\n');
});

test('edit: tolerates trailing spaces and wrong indentation, re-indenting the new text', () => {
  const src = 'if (a) {\n    call(1);   \n    done();\n}\n';
  expect(findEdit(src, '    call(1);\n', '    call(2);\n').after).toBe('if (a) {\n    call(2);\n    done();\n}\n');
  const r = findEdit(src, 'call(1);\ndone();', 'call(3);\ndone();');
  expect(r.ok).toBe(true);
  expect(r.after).toBe('if (a) {\n    call(3);\n    done();\n}\n');
});

test('edit: not found points at the closest line', () => {
  const r = findEdit('alpha\nreturn a + b;\n', 'return a + c;', 'x');
  expect(r.ok).toBe(false);
  expect(r.error).toContain('line 2');
});

test('diff puts an inserted blank line first', () => {
  const d = diffLines('a\n});\n', 'a\n});\n\ntest();\n');
  expect(d.additions).toBe(2);
  expect(d.hunk.filter((l) => l.type === '+').map((l) => l.text)).toEqual(['', 'test();']);
});

test('arguments: aliases, bad JSON, missing fields, unknown tool', () => {
  expect(parseArgs('Edit', JSON.stringify({ file_path: 'a.js', old_string: 'x', new_string: 'y' })).args).toEqual({ path: 'a.js', old_text: 'x', new_text: 'y' });
  expect(parseArgs('Read', '{"path": "a.js"').error).toContain('not valid JSON');
  expect(parseArgs('Bash', '{}').error).toContain('needs "command"');
  expect(parseArgs('Nope', '{}').error).toContain('no tool called');
  expect(parseArgs('TodoWrite', JSON.stringify({ todos: ['one', { content: 'two', status: 'completed' }] })).args.todos).toEqual([{ text: 'one', status: 'pending' }, { text: 'two', status: 'done' }]);
});

test('Read on a big model (big-model mode): a file up to 400 lines comes back whole, a part up to 1,000; else the 150 and 400 as before', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-read-big-'));
  writeFileSync(join(dir, 'long.js'), Array.from({ length: 300 }, (_, i) => `const v${i + 1} = ${i + 1};`).join('\n') + '\n');
  writeFileSync(join(dir, 'longer.js'), Array.from({ length: 1500 }, (_, i) => `const w${i + 1} = ${i + 1};`).join('\n') + '\n');
  const read = { whole: 400, part: 400, max: 1000 };
  const small = await execute('Read', { path: 'long.js' }, {}, { cwd: dir });
  expect(small.view.outline).toBe(true);
  const big = await execute('Read', { path: 'long.js' }, {}, { cwd: dir, read });
  expect(big.text).toContain('long.js (300 lines):\nconst v1 = 1;');
  expect(big.view).toMatchObject({ kind: 'read', lines: 300 });
  // a part: 400 by default, at most 1,000 (before: 150 and 400)
  expect((await execute('Read', { path: 'longer.js', offset: 1 }, {}, { cwd: dir, read })).view.lines).toBe(400);
  expect((await execute('Read', { path: 'longer.js', offset: 1, limit: 5000 }, {}, { cwd: dir, read, maxResultChars: 100_000 })).view.lines).toBe(1000);
  expect((await execute('Read', { path: 'longer.js', offset: 1 }, {}, { cwd: dir })).view.lines).toBe(150);
  expect((await execute('Read', { path: 'longer.js', offset: 1, limit: 5000 }, {}, { cwd: dir })).view.lines).toBe(400);
});

test('paths outside the project folder are refused for changes', () => {
  expect(resolvePath(dir, '../x').inside).toBe(false);
  expect(prepare('Write', { path: '/etc/hosts', content: 'x' }, { cwd: dir }).error).toContain('outside the project folder');
});

test('Read, List and Search', async () => {
  const env = { cwd: dir };
  const r = await execute('Read', { path: 'a.js' }, {}, env);
  expect(r.text).toContain('a.js (7 lines):\nfunction add(a, b) {\n  return a + b;');
  expect(r.text).not.toContain('\t');
  expect(r.view).toMatchObject({ kind: 'read', lines: 7 });
  expect((await execute('Read', { path: 'nope.js' }, {}, env)).error).toBe(true);
  expect((await execute('List', {}, {}, env)).text).toBe('a.js\nsrc/');
  expect((await execute('List', { pattern: '**/*.js' }, {}, env)).text).toBe('a.js\nsrc/b.js');
  expect((await execute('List', { path: 'a.js' }, {}, env)).text).toContain('is a file');
  expect((await execute('Search', { pattern: 'port' }, {}, env)).text).toContain('src/b.js:1:export const port = 8790;');
  expect((await execute('Search', { pattern: 'return', path: 'a.js' }, {}, env)).view.count).toBe(2);
});

test('Edit and Write change files and report a diff', async () => {
  const env = { cwd: dir };
  const args = { path: 'a.js', old_text: '  return a - b;', new_text: '  return a - b; // difference' };
  const p = prepare('Edit', args, env);
  const r = await execute('Edit', args, p, env);
  expect(r.view).toMatchObject({ kind: 'diff', additions: 1, removals: 1 });
  expect(readFileSync(join(dir, 'a.js'), 'utf8')).toContain('// difference');
  const w = { path: 'new/dir/c.txt', content: 'hi\n' };
  await execute('Write', w, prepare('Write', w, env), env);
  expect(existsSync(join(dir, 'new/dir/c.txt'))).toBe(true);
});

test('Bash runs in the project folder and reports the exit code', async () => {
  const r = await execute('Bash', { command: 'pwd; exit 3' }, {}, { cwd: dir });
  expect(r.text).toContain(dir.replace('/private', '').split('/').pop());
  expect(r.view.code).toBe(3);
  expect(r.error).toBe(true);
});

test('display names match Claude Code', () => {
  expect(display('Edit', { path: 'a.js' })).toEqual({ label: 'Update', arg: 'a.js' });
  expect(display('TodoWrite', {})).toEqual({ label: 'Update Todos', arg: '' });
});

test('line numbers copied from Read are taken off, tabs or spaces', async () => {
  const { stripLineNumbers } = await import('../src/agent/tools.mjs');
  expect(stripLineNumbers('    1\t// a\n    2\t\n    3\tcode();').text).toBe('// a\n\ncode();');
  expect(stripLineNumbers('    1    // a\n    2\n    3    export function f() {\n    4      return 1;\n    5    }').text).toBe('// a\n\nexport function f() {\n  return 1;\n}');
  expect(stripLineNumbers('const a = 1;\n  2\tnot really').stripped).toBe(false);
  expect(stripLineNumbers('10  apples\n3  pears\n7  plums').stripped).toBe(false);
  expect(stripLineNumbers('8790').stripped).toBe(false);
  expect(stripLineNumbers('1\n2\n3').stripped).toBe(true); // three bare rising numbers
  expect(stripLineNumbers('    1\n// a\n    2\n\n    3\nexport function f() {').text).toBe('// a\n\nexport function f() {');
  expect(stripLineNumbers('x = [\n  1,\n  2\n]').stripped).toBe(false);
});

test('List and Search accept the full folder path, and a bare name matches anywhere', async () => {
  const env = { cwd: dir };
  expect((await execute('List', { path: dir, pattern: 'b.js' }, {}, env)).text).toBe('src/b.js');
  expect((await execute('Search', { pattern: 'port', path: dir }, {}, env)).view.count).toBe(1);
});

test('a mistyped full path is forgiven', () => {
  expect(resolvePath(dir, dir.split('/').slice(0, -1).join('/')).abs).toBe(dir);
  expect(resolvePath(dir, `/somewhere/else/${dir.split('/').pop()}/src/b.js`).abs).toBe(join(dir, 'src/b.js'));
  expect(resolvePath(dir, '/etc/hosts').inside).toBe(false);
});

test('a wrong folder in a path finds the file by name; Write will not replace a long file', async () => {
  const env = { cwd: dir };
  const r = await execute('Read', { path: 'lib/b.js' }, {}, env);
  expect(r.text).toContain('(lib/b.js does not exist; this is src/b.js)');
  expect(r.text).toContain('export const port');
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  writeFileSync(join(dir, 'long.txt'), long);
  expect(prepare('Write', { path: 'long.txt', content: 'x' }, env).error).toContain('Use Edit');
  expect(prepare('Edit', { path: 'lib/b.js', old_text: '8790', new_text: '8791' }, env).rel).toBe('src/b.js');
});

test('a *.js filter also finds .mjs files', async () => {
  const { globToRegExp } = await import('../src/tools/fs.mjs');
  expect(globToRegExp('**/*.js').test('src/server.mjs')).toBe(true);
  expect(globToRegExp('**/*.js').test('src/server.json')).toBe(false);
  expect(globToRegExp('*.ts').test('App.tsx')).toBe(true);
});

test('an edit that would break a working file is refused; the file stays as it was', async () => {
  const { syntaxError } = await import('../src/agent/tools.mjs');
  expect(syntaxError('x.mjs', 'export const a = 1;')).toBe(null);
  expect(syntaxError('x.mjs', 'return 1;')).toContain('Illegal return');
  expect(syntaxError('x.json', '{"a": }')).toBeTruthy();
  const env = { cwd: dir };
  writeFileSync(join(dir, 'ok.mjs'), 'export function f() {\n  return 1;\n}\n');
  const bad = prepare('Edit', { path: 'ok.mjs', old_text: 'export function f() {', new_text: 'export function f() {\n  return 2;\n}\nreturn 3;\n{' }, env);
  expect(bad.error).toContain('would break ok.mjs');
  expect(bad.error).toContain('REPLACES');
  expect(readFileSync(join(dir, 'ok.mjs'), 'utf8')).toBe('export function f() {\n  return 1;\n}\n');
  expect(prepare('Edit', { path: 'ok.mjs', old_text: 'return 1;', new_text: 'return 2;' }, env).error).toBeUndefined();
});

test('near-copies with a typo match, and the lines meant to stay are restored exactly', () => {
  const file = "export function slugify(text) {\n  return text.toLowerCase().replace(/^-|-$/g, '');\n}\n\nexport function truncate(t) {\n  return t;\n}\n";
  const typoOld = "export function slugify(text) {\n  return text.toLowerCase().replace(/^-|-$/g, ');\n}";
  const typoNew = "export function slugify(text) {\n  return text.toLowerCase().replace(/^-|-$/g, ');\n}\n\nexport function titleCase(t) {\n  return t;\n}";
  const r = findEdit(file, typoOld, typoNew);
  expect(r.how).toBe('fuzzy');
  expect(r.after).toContain("replace(/^-|-$/g, '');");
  expect(r.after).toContain('export function titleCase(t) {');
  expect(r.after).not.toContain("g, ');");
  // too different → no match
  expect(findEdit(file, 'export function other(x) {\n  return x * 2;\n}', 'y').ok).toBe(false);
});

// 28 Sep: Gemma wrote "~/Desktop/notes.html" from the home folder; the path was
// read as a folder named "~" inside it, so the page landed in ~/~/Desktop and
// Bash's "ls ~/Desktop/notes.html" could not find it.
test('a path starting with ~ means the home folder, as in the shell', () => {
  const home = homedir();
  expect(resolvePath(home, '~/Desktop/notes.html').abs).toBe(join(home, 'Desktop/notes.html'));
  expect(resolvePath(home, '~/Desktop/notes.html').inside).toBe(true);
  expect(resolvePath(home, '~').abs).toBe(home);
  expect(resolvePath(dir, '~/Desktop/notes.html').abs).toBe(join(home, 'Desktop/notes.html'));
  expect(resolvePath(dir, '~/Desktop/notes.html').inside).toBe(false);
  expect(resolvePath(dir, '~notes.js').abs).toBe(join(dir, '~notes.js'));
});

test("Read's header line copied into content is taken off", async () => {
  const { stripLineNumbers } = await import('../src/agent/tools.mjs');
  expect(stripLineNumbers('strings.mjs (10 lines):\n// a\nexport const b = 1;').text).toBe('// a\nexport const b = 1;');
});

test("the folder's own name as a path means the folder", () => {
  const own = dir.split('/').pop();
  expect(resolvePath(dir, own).abs).toBe(dir);
  expect(resolvePath(dir, `${own}/src/b.js`).abs).toBe(join(dir, 'src/b.js'));
  expect(prepare('Edit', { path: own, old_text: 'x', new_text: 'y' }, { cwd: dir }).error).toContain('is a folder');
  expect(prepare('Edit', { path: 'nope.js', old_text: 'x', new_text: 'y' }, { cwd: dir }).error).toContain('List or Search');
});
