// A stand-in for a test the hub's ▶ Run a test starts (AGENTIC_BATTLE_FAKE=1): no model, a few
// seconds, lines in the shape the real one prints (so the page counts them the same way), and no
// line in the test record. For the tests and previews of the Tests tab and the runner.
//   node models/evals/battle/fake-test.mjs --test practice28 [--model gemma] [--n 10] [--think on]
// Stopped (SIGTERM or SIGINT), it says so and ends with what it has, like the real ones.
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pickTasks } from '../bench/pick-tasks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const test = opt('test'); const model = opt('model', 'gemma'); const n = Number(opt('n', 10));
const thinking = `thinking ${opt('think', 'off') === 'on' ? 'on (High)' : 'off (Low)'}`;
const ms = Number(process.env.AGENTIC_BATTLE_FAKE_MS ?? 250);
let stopped = false;
const onStop = () => { if (!stopped) { stopped = true; console.log('\nstopping: what ran is kept (a practice run: nothing is recorded)'); } };
process.on('SIGTERM', onStop);
process.on('SIGINT', onStop);
const wait = () => new Promise((r) => setTimeout(r, ms));
const good = (s) => createHash('sha1').update(`${model}:${s}`).digest()[0] % 5 !== 0; // 4 in 5 pass, the same each time
const say = (l) => console.log(l);
const folders = (d) => (existsSync(d) ? readdirSync(d).filter((x) => /^[a-z]\d\d-/.test(x)).sort() : []);

async function items(list, line, head, tail) {
  say(head);
  let ok = 0; let done = 0;
  for (const x of list) {
    if (stopped) break;
    await wait();
    const pass = good(x); ok += pass; done += 1;
    say(line(x, pass));
  }
  say(tail(ok, done));
}

if (test === 'practice28' || test === 'task') {
  const tasks = pickTasks(readdirSync(join(HERE, '..', 'bench', 'tasks')), test === 'task' ? { only: [String(n)] } : { set: 28 });
  await items(tasks, (t, p) => `    · Plan()\n    · Read(main.mjs)\n${p ? 'PASS' : 'FAIL'}  think=off  ${t.padEnd(16)} ${String(3 + (t.length % 9)).padStart(4)}s  6 steps (0 its own)  3 model calls  0 errors${p ? '' : '  a practice fail'}`,
    `server up on http://127.0.0.1:17600 · practice run: no model (${model}) · ${thinking}`,
    (ok, d) => `thinking off: ${ok}/${d} passed${stopped ? ' · stopped' : ''}\nnot recorded in the test record: a practice run (no model ran)`);
} else if (test === 'requests') {
  const asks = ['hello', 'thanks!', 'What does the API in export.mjs do?', 'explain the tests', 'run the tests', 'fix the test', 'delete trades.json'];
  await items(Array.from({ length: 28 }, (_, i) => `${i + 1}`), (i, p) => `${p ? 'OK  ' : 'FAIL'} #${i} [code] ${JSON.stringify(asks[i % asks.length])} → question, ${2 + (i % 5)}s${p ? '' : ' — a practice fail'}`,
    `server up · real requests · practice run: no model (${model}) · ${thinking}`, (ok, d) => `${ok} of ${d} OK · a practice run: nothing saved\nnot recorded in the test record: a practice run (no model ran)`);
} else if (test === 'long') {
  say(`${model} · practice run: no model · ${thinking}`); say('loading the model…'); await wait(); say('loaded in 0 s · getting ready…');
  for (const f of ['src/cli.jsx', 'src/agent/agent.mjs', 'src/agent/prompt.mjs', 'src/app/App.jsx']) { if (stopped) break; await wait(); say(`  0:0${f.length % 9} Read ${f}`); }
  say(`${stopped ? 'stopped' : 'done'} after 0:02 · 4 steps · a practice run`); say('not recorded in the test record: a practice run (no model ran)');
} else if (test === 'work28' || test === 'new28') {
  const list = folders(join(HERE, test));
  await items(list, (t, p) => `${p ? 'PASS' : 'FAIL'}  ${t.padEnd(26)} ${String(4 + (t.length % 7)).padStart(4)}s   5 steps${p ? '' : '  — a practice fail'}`,
    `${model} · ${test === 'work28' ? 'Work 28' : 'New 28'} · ${thinking} · ${list.length} tests, one at a time · practice run: no model`,
    (ok, d) => `${test === 'work28' ? 'Work 28' : 'New 28'}: ${ok} of ${d} passed${stopped ? ' · stopped' : ''}\nnot recorded in the test record: a practice run (no model ran)`);
} else if (test === 'unit') {
  await items(['app-menus', 'battle', 'record', 'hub-flow'], (f) => `(pass) ${f}.test.mjs`, 'bun test ./terminal/test ./models/test · practice run', (ok, d) => `\n ${d} pass\n 0 fail\nRan ${d} tests across ${d} files. · a practice run`);
} else if (test === 'check') {
  await items(['Nothing secret in the files', 'Packages', 'Where the code connects'], (c) => `✓ ${c}`, 'Repo check (fast) · practice run', (ok, d) => `${d} of ${d} fine · a practice run`);
} else { console.error(`no test "${test}"`); process.exit(2); }
process.exit(0);
