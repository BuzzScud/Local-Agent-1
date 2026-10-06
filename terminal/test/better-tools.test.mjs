// The tools made better (5 Oct 2026, the owner: "can we make the tools better?"), from the failed steps of
// 40 runs on a service: an Edit turned back for a stale old_text was followed by a Read before the next
// try; one appearing several times had no way to name the one meant; the folder fence turned away regexes
// in node -e code and the project itself under /private/var; node errors left the model to guess; four
// tools were never called where they could not run anyway.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-better-tools-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { findEdit, prepare, execute, TOOL_DEFS, normalizeArgs } = await import('../src/agent/tools.mjs');
const { outsidePath, decide } = await import('../src/agent/permissions.mjs');
const { nodeHint } = await import('../src/agent/scripts.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentic-better-tools-')); });

test('Edit not found: the error shows the lines as they are now, numbered, and where they differ', () => {
  const file = 'x\nexport function plainRead(cmd, cwd) {\n  const w = words(cmd);\n  if (!w.length) return null;\n  return w;\n}\n';
  const r = findEdit(file, 'export function plainRead(cmd, cwd) {\n  const w = split(cmd);\n  if (!w.length) return null;', 'y');
  expect(r.ok).toBe(false);
  expect(r.error).toContain('The closest match is line 2');
  expect(r.error).toContain('differs from line 3 on');
  expect(r.error).toContain('    2\texport function plainRead(cmd, cwd) {\n    3\t  const w = words(cmd);\n    4\t  if (!w.length) return null;\n    5\t  return w;');
  expect(r.error).toContain('Copy old_text exactly from these lines');
  // Nothing close: no lines, only what to do.
  expect(findEdit('alpha\nbeta\n', 'something else entirely here', 'y').error).toBe('old_text was not found in the file. Read the file again and copy old_text exactly (or Search for it, if it is in another file).');
});

test('Edit with old_text in several places: line picks the one meant; the error names the lines', () => {
  const file = 'function one() {\n  return total;\n}\nfunction two() {\n  return total;\n}\n';
  const many = findEdit(file, '  return total;\n}', 'X');
  expect(many.error).toContain('appears 2 times (lines 2, 5)');
  expect(many.error).toContain('Pass line');
  const two = findEdit(file, '  return total;\n}', '  return 2;\n}', { line: 5 });
  expect(two).toMatchObject({ ok: true, how: 'line', at: 5 });
  expect(two.after).toBe('function one() {\n  return total;\n}\nfunction two() {\n  return 2;\n}\n');
  expect(findEdit(file, '  return total;\n}', 'X', { line: 40 }).error).toContain('None of them is at line 40');
  // The same with the indent off: line picks there too.
  const loose = findEdit(file, 'return total;', 'return 3;', { line: 2 });
  expect(loose).toMatchObject({ ok: true, at: 2 });
  expect(loose.after.split('\n')[1]).toBe('  return 3;');
  // Through the tool, as a model sends it (line_number is the same argument).
  writeFileSync(join(dir, 'a.mjs'), file);
  const args = normalizeArgs('Edit', { path: 'a.mjs', old_text: '  return total;', new_text: '  return 9;', line_number: '5' });
  const p = prepare('Edit', args, { cwd: dir });
  expect(p.error).toBeUndefined();
  expect(p.after).toContain('function two() {\n  return 9;');
});

test('Edit with old_text and new_text the same says where, and that the file may already be right', () => {
  writeFileSync(join(dir, 'b.mjs'), 'a\nb\nc\n');
  const p = prepare('Edit', { path: 'b.mjs', old_text: 'b', new_text: 'b' }, { cwd: dir });
  expect(p.error).toBe('old_text and new_text are the same, so nothing would change: line 2 already reads that way. If that is what you wanted, the file is already right: go on with the next step. Otherwise new_text must be the corrected version: write the changed lines out in full.');
});

test('the fence: a regex in node -e code is not a path; real paths beside it still are', () => {
  const cwd = join(homedir(), 'p');
  // The five refused in the shootout, each a regex.
  for (const cmd of [
    `node -e "console.log([/x|y|z/.test('find')]);"`,
    `node -e "\nconst match = code.match(/if \\(\\s*\\/(.*?)\\/\\)/);\nconsole.log(match);\n"`,
    `node -e "console.log(require('fs').readFileSync('./tools.mjs', 'utf8').match(/const match = next.match\\\\(.*\\\\);/)[0])"`,
    `cat > _debug7.mjs << 'SCRIPT'\nconst match = code.match(/export function plainRead\\([^)]*\\)\\s*\\{([\\s\\S]*?)^\\}/m);\nSCRIPT`,
    `node -e "const raw = cmd.replace(/'(?:[^'\\\\\\\\]|\\\\\\\\.)*'/g, ' ');"`,
    `node -e "if (/^-./.test(w)) {}"`,
  ]) expect([cmd, outsidePath(cmd, cwd)]).toEqual([cmd, null]);
  expect(outsidePath(`node -e "const r = /x|y/; require('fs').readFileSync('/Users/x/a')"`, cwd)).toBe('/Users/x/a');
  expect(outsidePath(`node -e "s.replace(/a/g, '/Users/x/b')"`, cwd)).toBe('/Users/x/b');
  expect(outsidePath(`sh -c "DIR=/Users/; ls $DIR"`, cwd)).toBe('/Users/');
  expect(outsidePath(`sh -c "x=1;/Users/me/run.sh"`, cwd)).toBe('/Users/me/run.sh');
});

test('the fence: a division by a number in code is not a path; real paths beside it still are', () => {
  const cwd = join(homedir(), 'p');
  // Four refused in one task of the Fewer steps check (6 Oct 2026, Qwen3.6 on the service): money rounded
  // to cents in node -e code, each "/100 is outside the project folder".
  for (const cmd of [
    `node -e "\nconsole.log('round2(10.005) =', Math.round(10.005 * 100) / 100);\nconsole.log('Math.round((0.1+0.2)*100)/100 =', Math.round((0.1+0.2)*100) / 100);\n"`,
    `node --input-type=module -e "\nconsole.log(v.toFixed(3), '*,100→', floatMul, 'rounded→', rounded, '/100→', round2(v));\n"`,
    `node --input-type=module -e '\nconsole.log(v.toFixed(3), "*,100=" + floatMul, "round=" + rounded, "/100=" + round2(v));\n'`,
    `node --input-type=module -e '\nconsole.log("Math.floor(x*100)/100:", Math.floor(val * 100) / 100);\n'`,
    `python3 -c "print(total*100/100, x /2.5)"`,
    `awk '{ print $1/100 }' data.txt`,
  ]) expect([cmd, outsidePath(cmd, cwd)]).toEqual([cmd, null]);
  // A path that starts with a number, or goes on past it, is still a path.
  expect(outsidePath(`node -e "require('fs').readFileSync('/100/notes.txt')"`, cwd)).toBe('/100/notes.txt');
  expect(outsidePath(`node -e "require('fs').readFileSync('/2024-report.pdf')"`, cwd)).toBe('/2024-report.pdf');
  expect(outsidePath(`node -e "const x = a * 100 / 100; require('fs').readFileSync('/Users/x/a')"`, cwd)).toBe('/Users/x/a');
  expect(outsidePath(`cat /100`, cwd)).toBe('/100');
});

test('the fence: the project under another name for the same place is inside', () => {
  // tmpdir() on a Mac is /var/folders/…, which is really /private/var/folders/…; node's process.cwd() gives the second.
  const project = join(dir, 'project');
  mkdirSync(project);
  const real = realpathSync(project);
  const other = real === project ? null : real;
  if (other) {
    expect(outsidePath(`cd "${other}" && node -e "1"`, project)).toBe(null);
    expect(outsidePath(`node -e "const cwd = '${other}/x';"`, project)).toBe(null);
  }
  // A link to somewhere else is still outside.
  expect(outsidePath(`cat ${join(realpathSync(dir), 'elsewhere.txt')}`, project)).toBe(join(realpathSync(dir), 'elsewhere.txt'));
});

test('the fence: a path that is not there is refused with what to use instead', () => {
  const cwd = join(homedir(), 'p');
  const d = decide('Bash', { command: `node -e "plainRead('ls', '/fake')"` }, { mode: 'ask', cwd });
  expect(d).toEqual({ decision: 'deny', reason: '/fake is outside the project folder; commands stay inside it. Nothing is there now: for a file of your own, or a made-up path in code, use a name inside the project, such as "fake"' });
  // A place that is there keeps the short line.
  expect(decide('Bash', { command: 'ls /tmp' }, { mode: 'ask', cwd }).reason).toBe('/tmp is outside the project folder; commands stay inside it');
});

test('node errors say what to change: require in a module, an import outside one, a name from the wrong module', async () => {
  expect(nodeHint("SyntaxError: The requested module 'node:path' does not provide an export named 'readFileSync'")).toBe("(readFileSync is in node:fs, not node:path: import { readFileSync } from 'node:fs'.)");
  expect(nodeHint("SyntaxError: The requested module 'path' does not provide an export named 'tmpdir'")).toBe("(tmpdir is in node:os, not path: import { tmpdir } from 'node:os'.)");
  expect(nodeHint("SyntaxError: The requested module './tools.mjs' does not provide an export named 'parseArgs'")).toBe('(./tools.mjs has no export named parseArgs: Search for "export" in it to see the names it gives.)');
  expect(nodeHint("SyntaxError: The requested module 'lodash' does not provide an export named 'x'")).toBe('');
  expect(nodeHint('ReferenceError: require is not defined in ES module scope, you can use import instead')).toContain('use import for everything');
  expect(nodeHint('SyntaxError: Cannot use import statement outside a module')).toContain('node --input-type=module -e');
  expect(nodeHint('3 passed')).toBe('');
  // On a real failed run, the hint ends the result.
  const env = { cwd: dir };
  const args = { command: `node --input-type=module -e "import { tmpdir } from 'node:path'; console.log(tmpdir())"` };
  const r = await execute('Bash', args, prepare('Bash', args, env), env);
  expect(r.error).toBe(true);
  expect(r.text).toContain("(tmpdir is in node:os, not node:path: import { tmpdir } from 'node:os'.)");
}, 30_000);

test('Edit, Write, Bash and TodoWrite each show one call as an example; Edit takes line', () => {
  for (const name of ['Edit', 'Write', 'Bash', 'TodoWrite']) {
    const d = TOOL_DEFS.find((t) => t.name === name).description;
    const example = JSON.parse(d.slice(d.indexOf('Example: ') + 'Example: '.length));
    // The example's arguments are the tool's own.
    expect(Object.keys(example).every((k) => k in TOOL_DEFS.find((t) => t.name === name).parameters.properties)).toBe(true);
  }
  expect(TOOL_DEFS.find((t) => t.name === 'Edit').parameters.properties.line.type).toBe('integer');
});

test('Map, Rename, TestFirst and Remember are offered only where they can run, and the list holds for the conversation', () => {
  const model = MODELS[DEFAULT_MODEL];
  const names = (a) => a.tools().map((t) => t.function.name);
  const on = (cwd, memory = false) => new Agent({ url: 'http://127.0.0.1:1', model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory, flows: false, way: 'model', thinking: false, ctx: 32768 });
  const code = join(dir, 'code');
  mkdirSync(code);
  writeFileSync(join(code, 'a.mjs'), 'export const a = 1;\n');
  const empty = join(dir, 'empty');
  mkdirSync(empty);
  const inCode = on(code);
  expect(names(inCode)).toEqual(expect.arrayContaining(['Map', 'Rename', 'TestFirst']));
  expect(names(inCode)).not.toContain('Remember');
  expect(names(on(empty))).toContain('Map');
  expect(names(on(empty))).not.toContain('Rename');
  expect(names(on(empty))).not.toContain('TestFirst');
  expect(names(on(homedir()))).not.toContain('Map');
  expect(names(on(code, { home: process.env.AGENTIC_HOME, embedder: null }))).toContain('Remember');
  // A code file made during the conversation does not move the list; the next conversation has it.
  const later = on(empty);
  names(later);
  writeFileSync(join(empty, 'b.mjs'), 'export const b = 2;\n');
  expect(names(later)).not.toContain('Rename');
  later.reset();
  expect(names(later)).toContain('Rename');
});

test('the remote Tool use lines gain the two on failed Edits and trying out code; the read-together line stays last', () => {
  const text = readFileSync(join(import.meta.dir, '..', 'rules', 'remote', 'TOOLS.md'), 'utf8');
  const lines = text.slice(text.indexOf('## Tool use'), text.indexOf('## Web tools')).trim().split('\n').filter((l) => l.startsWith('- '));
  expect(lines).toContain('- When an Edit is turned back, copy old_text from the lines its error shows. After two misses on the same lines, Read them again, or Write the file whole if it is short.');
  expect(lines.some((l) => l.startsWith('- To try out code, put it in a test or a script file'))).toBe(true);
  expect(lines.at(-1)).toStartWith('- Send the reads and searches a step needs together');
});
