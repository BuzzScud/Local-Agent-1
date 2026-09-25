import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const R = new URL('../../../', import.meta.url).pathname.replace(/\/$/, ''); // the repo
const { MODELS, DEFAULT_MODEL } = await import(`${R}/models/registry.mjs`);
const { changeFlow } = await import(`${R}/terminal/src/flows/change.mjs`);
const { Scratch } = await import(`${R}/terminal/src/flows/scratch.mjs`);
const work = join(mkdtempSync(join(tmpdir(), 'dbgj-')), 'project');
cpSync(`${R}/models/evals/bench/tasks/1-json-flag/project`, work, { recursive: true });
let n = 0;
const W = Scratch.prototype.run;
Scratch.prototype.run = async function (cmd, o) { const r = await W.call(this, cmd, o); if (++n <= 40 && /✖/.test(r.out)) { const m = r.out.match(/✖ [^\n]+\n(?:[^\n]*\n){0,6}/g); if (m) console.log('RUN', n, m.slice(0, 2).join('').slice(0, 500)); } return r; };
const ctx = { url: 'http://127.0.0.1:17650', model: MODELS[DEFAULT_MODEL], cwd: work, testCmd: 'node --test', maxTries: 3, emit: (e, v) => { if (e === 'tries-done') console.log('tries-done', v.label, v.marks.join(''), v.summary); }, ask: async (req) => { if (req.name === 'Test') console.log('--- CHOSEN TEST (tail):\n' + req.prepared.after.split('\n').slice(-12).join('\n')); return { choice: 'yes' }; }, mode: () => 'edits', setMode() {}, tool() {}, note: (t) => console.log('note', t), plan: () => ({ step() {}, done() {} }), runReal: async () => ({ ok: true }) };
console.log(JSON.stringify(await changeFlow(ctx, 'add a --json flag to export.mjs that prints the rows as JSON, and add a test for it')));
process.exit(0);
