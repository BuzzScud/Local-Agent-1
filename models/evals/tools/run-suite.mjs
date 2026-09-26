// `bun run test`: the unit tests of both parts, as before, and one line in
// the test record when a full run ends. A run narrowed by extra arguments
// (a file, -t "name") runs the same way and is not recorded.
//   node models/evals/tools/run-suite.mjs [anything bun test takes]
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordTest, codeLabel } from '../record.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const extra = process.argv.slice(2);
const t0 = Date.now();
const child = spawn('bun', ['test', './terminal/test', './models/test', ...extra], { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: '1' } : {}) } });
let tail = '';
const keep = (d) => { tail = (tail + d).slice(-4000); };
child.stdout.on('data', (d) => { process.stdout.write(d); keep(d); });
child.stderr.on('data', (d) => { process.stderr.write(d); keep(d); });
child.on('error', (e) => { process.stderr.write(`could not start bun test: ${e.message}\n`); process.exit(1); });
child.on('close', (code) => {
  const plain = tail.replace(/\x1b\[[0-9;]*m/g, '');
  const n = (word) => { const m = new RegExp(`^\\s*(\\d+) ${word}\\b`, 'm').exec(plain); return m ? Number(m[1]) : null; };
  const pass = n('pass'), fail = n('fail') ?? 0, files = /across (\d+) files/.exec(plain)?.[1];
  if (!extra.length && !process.env.CI && !process.env.BONSAI_NO_RECORD && pass != null) {
    recordTest({ kind: 'suite', name: 'Unit tests, both parts', code: codeLabel(root), passed: pass, total: pass + fail, secs: (Date.now() - t0) / 1000,
      result: code === 0 && fail === 0 ? 'pass' : 'fail', note: [files ? `${files} files` : '', code !== 0 && fail === 0 ? `bun test ended with code ${code}` : ''].filter(Boolean).join(' · '), raw: '' });
  }
  process.exit(code ?? 1);
});
