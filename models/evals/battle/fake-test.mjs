// A stand-in for a test the hub's ▶ Run a test starts (AGENTIC_BATTLE_FAKE=1): no model, a few
// seconds, lines in the shape the real one prints (so the page counts them the same way), and no
// line in the test record. For the tests and previews of the Tests tab and the runner.
//   node models/evals/battle/fake-test.mjs --test practice28 [--model gemma] [--n 10 | 18b] [--think on]
// Stopped (SIGTERM or SIGINT), it says so and ends with what it has, like the real ones.
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pickTasks } from '../bench/pick-tasks.mjs';
import { practiceChoice } from '../run-tests.mjs';
import { listMetas, practiceList, LEVELS } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const test = opt('test'); const model = opt('model', 'gemma'); const n = opt('n', '10');
const thinking = `thinking ${opt('think', 'off') === 'on' ? 'on (High)' : 'off (Low)'}`;
const ms = Number(process.env.AGENTIC_BATTLE_FAKE_MS ?? 250);
// The control panel's settings, as a real run gets them (AGENTIC_TEST_SETTINGS): said first, so a test sees them arrive.
if (process.env.AGENTIC_TEST_SETTINGS) console.log(`settings: ${process.env.AGENTIC_TEST_SETTINGS}`);
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

if (test === 'practice28') {
  const tasks = pickTasks(readdirSync(join(HERE, '..', 'bench', 'tasks')), { set: 28 });
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
} else if (test === 'work28' || test === 'new28' || test === 'task' || test === 'mine' || test === 'mytest' || /^mine-(easy|medium|hard)$/.test(test)) {
  // As run-set.mjs prints them: One practice task is one Practice 28 test (a copy of yours too), My tests yours
  // (My tests · Easy: the ones of that level; One of my tests: the one with that number).
  const level = /^mine-(easy|medium|hard)$/.exec(test)?.[1] ?? null;
  const name = level ? `My tests · ${LEVELS[level].name}` : { work28: 'Work 28', new28: 'New 28', task: 'Practice 28', mine: 'My tests', mytest: 'My tests' }[test];
  const only = practiceChoice(n)?.only ?? `p${n}`; // its folder, as the real one names it: p12-feature-currency
  const own = listMetas().filter((t) => t.suite === 'mine' && (!level || t.level === level) && (test !== 'mytest' || String(t.n) === String(n)));
  const list = test === 'task' ? [[...listMetas(), ...practiceList()].map((t) => t.id).find((id) => id.startsWith(`${only}-`)) ?? only] : test.startsWith('mine') || test === 'mytest' ? own.map((t) => t.id).sort() : folders(join(HERE, test));
  await items(list, (t, p) => `${p ? 'PASS' : 'FAIL'}  ${t.padEnd(26)} ${String(4 + (t.length % 7)).padStart(4)}s   5 steps${p ? '' : '  — a practice fail'}`,
    `${model} · ${name} · ${thinking} · ${list.length} test${list.length === 1 ? '' : 's'}, one at a time · practice run: no model`,
    (ok, d) => `${name}: ${ok} of ${d} passed${stopped ? ' · stopped' : ''}\nnot recorded in the test record: a practice run (no model ran)`);
} else if (test === 'unit') {
  await items(['app-menus', 'battle', 'record', 'hub-flow'], (f) => `(pass) ${f}.test.mjs`, 'bun test ./terminal/test ./models/test · practice run', (ok, d) => `\n ${d} pass\n 0 fail\nRan ${d} tests across ${d} files. · a practice run`);
} else if (test === 'check') {
  await items(['Nothing secret in the files', 'Packages', 'Where the code connects'], (c) => `✓ ${c}`, 'Repo check (fast) · practice run', (ok, d) => `${d} of ${d} fine · a practice run`);
} else if (['sorting', 'questions', 'done', 'twoatonce', 'prompt', 'thinking', 'components', 'edited', 'modelcheck', 'reader'].includes(test)) {
  // The checks with no lines of their own above: a few PASS and FAIL lines, the way each counts them.
  await items(Array.from({ length: 8 }, (_, i) => `#${i + 1}`), (x, p) => `${p ? 'PASS' : 'FAIL'} ${x} · a practice line${p ? '' : ' — a practice fail'}`,
    `${model} · ${test} · ${thinking} · practice run: no model`, (ok, d) => `${ok} of ${d} passed${stopped ? ' · stopped' : ''}\nnot recorded in the test record: a practice run (no model ran)`);
} else if (test === 'constantkv') {
  // Its four items, decided one by one, the way the real check prints them, after a load that takes a moment.
  say('Loading the model (a practice run: no model)…');
  await new Promise((r) => setTimeout(r, ms * 10));
  await items(['(a) it loads and answers', '(b) it reads 40+ tokens a second up to 16k', '(c) it holds 64k tokens at 12.5 GB or less', '(d) the app’s tool calls on 2 of 3 tries'], (x, p) => `${p ? 'PASS' : 'FAIL'}  ${x} · a practice line`,
    'ConstantKV check · practice run: no model', (ok, d) => `ConstantKV check: ${ok} of ${d}${stopped ? ' · stopped' : ''}\nnot recorded in the test record: a practice run (no model ran)`);
} else { console.error(`no test "${test}"`); process.exit(2); }
process.exit(0);
