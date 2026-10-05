// The hidden check of 40-hard-harness-reads, run in the model's copy (cwd). Six parts, each ✓ or ✗ with
// why; the last line is "PARTS n/6". A part is judged by what the mapped tool returns, not by the shape
// of the arguments (Read with offset 1 and no limit is as good as Read alone for cat).
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const work = process.cwd();
const parts = [];
const part = async (name, fn) => { try { const why = await fn(); parts.push({ name, ok: !why, why: why || '' }); } catch (e) { parts.push({ name, ok: false, why: `threw: ${e.message}` }); } };
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'check40-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'cart.mjs'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\nexport const tax = (x) => x * 0.2;\n');
  writeFileSync(join(dir, 'src', 'ship.mjs'), 'export const ship = 5;\n');
  writeFileSync(join(dir, 'notes.txt'), Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  writeFileSync(join(dir, 'three.txt'), 'one\ntwo\nthree\n');
  return dir;
};
const nums = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${from + i}: line ${from + i}`).join('\n');

let tools, agent;
try { tools = await import(resolve(work, 'tools.mjs')); agent = await import(resolve(work, 'agent.mjs')); } catch (e) { console.log(`✗ the project does not load: ${e.message}`); console.log('PARTS 0/6'); process.exit(1); }
const { plainRead, runTool } = tools;
const mapped = (c, cwd) => { const r = plainRead(c, cwd); return r ? { r, out: runTool(r.name, r.args, cwd) } : null; };

await part('the tests pass, with new ones', () => {
  const r = spawnSync('node', ['--test'], { cwd: work, encoding: 'utf8', timeout: 120_000 });
  const out = `${r.stdout}${r.stderr}`;
  const n = Number(/^ℹ tests (\d+)/m.exec(out)?.[1] ?? 0);
  if (!/^ℹ fail 0/m.test(out)) return 'node --test has failures';
  return n >= 6 ? '' : `only ${n} tests (3 were there; at least 3 new ones wanted)`;
});
if (typeof plainRead !== 'function') { console.log('✗ tools.mjs exports no plainRead'); for (const p of parts) console.log(`${p.ok ? '✓' : '✗'} ${p.name}${p.why ? `: ${p.why}` : ''}`); console.log(`PARTS ${parts.filter((p) => p.ok).length}/6`); process.exit(1); }

await part('cat, head and sed -n are Read of the right lines', () => {
  const cwd = fixture();
  const cases = [['cat notes.txt', nums(1, 12)], ['head -n 3 notes.txt', nums(1, 3)], ['head -4 notes.txt', nums(1, 4)], ['head notes.txt', nums(1, 10)], ["sed -n '5,7p' notes.txt", nums(5, 7)]];
  for (const [c, want] of cases) { const m = mapped(c, cwd); if (!m || m.r.name !== 'Read') return `${c}: not a Read`; if (m.out.text !== want) return `${c}: read ${JSON.stringify(m.out.text.slice(0, 60))}`; }
  return '';
});
await part('tail is the last lines, with the right offset', () => {
  const cwd = fixture();
  const cases = [['tail -n 2 notes.txt', nums(11, 12)], ['tail -3 notes.txt', nums(10, 12)], ['tail -n 2 three.txt', '2: two\n3: three'], ['tail -n 40 three.txt', '1: one\n2: two\n3: three']];
  for (const [c, want] of cases) { const m = mapped(c, cwd); if (!m || m.r.name !== 'Read') return `${c}: not a Read`; if (m.out.text !== want) return `${c}: read ${JSON.stringify(m.out.text.slice(0, 60))}`; }
  return '';
});
await part('grep -r is Search; ls and find -name are List', () => {
  const cwd = fixture();
  const s = (c) => { const m = mapped(c, cwd); return m && m.r.name === 'Search' ? m.out.text : null; };
  for (const c of ['grep -rn tax src', 'grep -r "tax" src', "grep -nr 'tax' src"]) if (!String(s(c)).includes('src/cart.mjs:2: export const tax')) return `${c}: ${s(c) === null ? 'not a Search' : 'did not find the line'}`;
  if (!String(s('grep -rn ship')).includes('src/ship.mjs:1:')) return 'grep -rn ship (no folder): not a Search of the project';
  const l = (c) => { const m = mapped(c, cwd); return m && m.r.name === 'List' ? m.out.text : null; };
  if (l('ls src') !== 'cart.mjs\nship.mjs' || l('ls -la src') !== 'cart.mjs\nship.mjs') return 'ls src / ls -la src: not the folder\'s list';
  if (!String(l('ls')).includes('notes.txt')) return 'ls alone: not the project folder';
  if (l("find src -name '*.mjs'") !== 'cart.mjs\nship.mjs' || l("find src -type f -name 'c*.mjs'") !== 'cart.mjs') return 'find -name: not a List by glob';
  return '';
});
await part('anything else runs as typed', () => {
  const cwd = fixture();
  for (const c of ['cat notes.txt | head -1', 'cat notes.txt > copy.txt', 'cat notes.txt; ls', 'ls && cat notes.txt', 'cat $(echo notes.txt)', 'head -c 5 notes.txt', 'grep -i tax src', 'grep tax src/cart.mjs', 'cat notes.txt three.txt', 'cat missing.txt', 'ls nowhere', 'find src -mtime -1', 'wc -l notes.txt', '']) {
    if (plainRead(c, cwd) !== null) return `${JSON.stringify(c)} was mapped`;
  }
  return '';
});
await part('step runs a mapped Bash call as the tool, with the line first', async () => {
  const cwd = fixture();
  const a = await agent.step({ name: 'Bash', args: { command: 'cat three.txt' } }, { cwd });
  if (a.text !== '(Run as Read)\n1: one\n2: two\n3: three') return `cat three.txt gave ${JSON.stringify(a.text.slice(0, 60))}`;
  const s = await agent.step({ name: 'Bash', args: { command: 'grep -rn tax src' } }, { cwd });
  if (!s.text.startsWith('(Run as Search)\nsrc/cart.mjs:2:')) return `grep gave ${JSON.stringify(s.text.slice(0, 60))}`;
  const b = await agent.step({ name: 'Bash', args: { command: 'cat three.txt | head -1' } }, { cwd });
  if (b.text !== 'one') return `a pipe gave ${JSON.stringify(b.text.slice(0, 60))} (it should run as typed)`;
  const r = await agent.step({ name: 'Read', args: { path: 'three.txt', offset: 2, limit: 1 } }, { cwd });
  if (r.text !== '2: two') return 'Read itself changed';
  return '';
});
for (const p of parts) console.log(`${p.ok ? '✓' : '✗'} ${p.name}${p.why ? `: ${p.why}` : ''}`);
const n = parts.filter((p) => p.ok).length;
console.log(`PARTS ${n}/6`);
process.exit(n === 6 ? 0 : 1);
