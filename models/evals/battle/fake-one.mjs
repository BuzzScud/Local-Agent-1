// A stand-in for run-one.mjs (AGENTIC_BATTLE_FAKE=1): no model, a few seconds, the same files
// (events.jsonl as it goes, result.json at the end, a page under files/ for a page test).
// For the tests and previews of the arena itself; its results say "practice run".
import { writeFileSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = opt('model'); const test = opt('test'); const out = opt('out');
const stepMs = Number(process.env.AGENTIC_BATTLE_FAKE_MS ?? 250);
let meta = {}; try { meta = JSON.parse(readFileSync(join(test, 'meta.json'), 'utf8')); } catch {}
mkdirSync(join(out, 'files'), { recursive: true });
const h = createHash('sha1').update(`${test}:${model}`).digest()[0];
const t0 = Date.now();
const ev = join(out, 'events.jsonl');
writeFileSync(ev, '');
const emit = (e) => appendFileSync(ev, `${JSON.stringify({ t: (Date.now() - t0) / 1000, ...e })}\n`);
const STEPS = [['Read', 'the starter files', 'read'], ['Search', 'where it is used', 'read'], ['Update', 'the main file', 'edit'], ['Bash', 'npm test', 'bash'], ['Update', 'a test', 'edit'], ['Bash', 'npm test', 'bash']].slice(0, 3 + (h % 4));
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
const steps = [];
for (const [label, arg, kind] of STEPS) {
  if (stopped) break;
  await new Promise((r) => setTimeout(r, stepMs));
  const s = { t: (Date.now() - t0) / 1000, label, arg, kind, err: '' };
  steps.push(s); emit({ type: 'step', ...s });
}
const pass = !stopped && h % 4 !== 0;
const pages = [];
if (meta.kind === 'page') { writeFileSync(join(out, 'files', 'page.html'), `<!doctype html><meta charset="utf-8"><title>Practice</title><body style="font:16px system-ui;padding:24px"><h1>Practice page</h1><p>A stand-in: no model made this.</p><button onclick="this.textContent='Clicked'">Click me</button></body>`); pages.push('page.html'); }
const secs = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
writeFileSync(join(out, 'result.json'), JSON.stringify({ model, practice: true, thinking: opt('think', 'off') === 'on', pass: stopped ? null : pass, checks: [{ label: 'Practice check', pass, why: pass ? '' : 'a practice fail' }], reason: stopped ? 'interrupted' : 'done', stopped, overLimit: false, secs, steps, stepCount: steps.length, errors: 0, tps: 10 + (h % 7), answer: "A practice answer from a stand-in. **No model ran.**", diffs: meta.kind === 'code' ? [{ path: 'main.mjs', created: false, hunk: [[' ', 'export function f(x) {'], ['-', '  return x;'], ['+', '  return x + 1;'], [' ', '}']] }] : [], pages, asked: [], changed: { added: pages, changed: [], removed: [] } }, null, 1));
emit({ type: 'done' });
process.exit(0);
