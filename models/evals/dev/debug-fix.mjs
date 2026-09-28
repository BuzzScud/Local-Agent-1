import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const R = new URL('../../../', import.meta.url).pathname.replace(/\/$/, ''); // the repo
const { MODELS, DEFAULT_MODEL } = await import(`${R}/models/registry.mjs`);
const L = await import(`${R}/terminal/index.mjs`);
const work = join(mkdtempSync(join(tmpdir(), 'dbgfix-')), 'project');
cpSync(`${R}/models/evals/bench/tasks/2-fix-bug/project`, work, { recursive: true });
const { Scratch, readResults, fixFlow } = L;
const sc = new Scratch(work);
const base = await sc.run('node --test');
console.log('base:', JSON.stringify(readResults(base.out, base.code)));
const ctx = { url: 'http://127.0.0.1:17650', model: MODELS[DEFAULT_MODEL], cwd: work, testCmd: 'node --test', maxTries: 3, emit: (n, e) => { if (n === 'tries-done') console.log('tries-done', e.marks.join(''), e.summary); }, ask: async () => ({ choice: 'yes' }), mode: () => 'edits', setMode() {}, tool: (l, a, v, err) => console.log('tool', l, a, v?.kind, err ? 'ERR' : ''), note: (t) => console.log('note', t), plan: () => ({ step() {}, done() {} }), runReal: async () => ({ ok: true }), describe: null };
// Wrap the scratch write to print each try's code.
const S = Scratch.prototype.write;
Scratch.prototype.write = function (rel, text) { if (rel === 'stats.mjs') console.log('--- TRY stats.mjs median:\n' + (text.match(/export function median[\s\S]*?\n}/)?.[0] ?? text.slice(0, 300))); return S.call(this, rel, text); };
const r = await fixFlow(ctx, 'The tests in this project fail. Find the bug and fix it (fix the code, not the tests).');
console.log(JSON.stringify(r));
process.exit(0);
