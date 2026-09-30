// The rules file check (the Arena → Rules file old vs new, `/test rules file`): whether the short
// AGENTS.md (30 Sep 2026: the rules on top, the background moved word for word to
// AGENTS-DETAILS.md) serves the model at least as well as the long one it replaced, and starts
// faster. Each file is tried in a folder of its own with nothing else in it (the new one beside its
// AGENTS-DETAILS.md and CLAUDE.md, as in the repo), thinking off, no memory, at 16k:
//   10 questions about working in this repo; every answer is in both files, and a right one
//      holds what QUESTIONS says (the words, never a model's judgement)
//   the instructions the model reads before a first message, timed on the engine with nothing
//      saved (the prompt as the app builds it for that folder)
//   one small real task on a copy of the repo at this code, once with each file: a test added to
//      terminal/test/room.test.mjs, which must pass after (run by this check, not timed)
// The rule, written before the first run: the new file gets at least as many right answers as the
// old, its start is faster, and the task passes with it in no more time than with the old.
// "The old file" is AGENTS.md as it was before AGENTS-DETAILS.md came in (from git), so a later run
// still compares against it. Nothing in ~/.agentic-coder is written but this run's line in the
// test record (a test run inside the copy is not recorded).
//   node models/evals/tools/rules-file-check.mjs --model qwen [--url http://127.0.0.1:PORT] [--no-record]
//   --url: on a server that is already up (no model is loaded or stopped)
//   --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, hasDraft, recordTest, codeLabel } from '../../index.mjs';
import { runHeadless, systemPrompt, projectNotes } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { rulesFilePage } from './rules-file-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const CTX = 16_384; // the Context the app runs Qwen at on this Mac (its shared server, 30 Sep)
const Q_LIMIT_MS = 3 * 60_000;
const TASK_LIMIT_MS = 10 * 60_000;
const pad = (n) => String(n).padStart(2, '0');
const shown = (p) => (p.startsWith(`${root}/`) ? relative(root, p) : p.replace(process.env.HOME, '~'));

// The questions, as someone working in the repo would ask them, and what a right answer holds
// (every pattern). Each is answered by both files.
const NO = /\b(no|not|never|don['’]t|do not|must not|shouldn['’]t|should not|can['’]t|cannot|only)\b/i;
export const QUESTIONS = [
  { id: 'page', q: 'I made a results page for a test run. Where do I save it?', want: [/docs/i, /\btests\b/i], right: 'the tests group of the pages folder' },
  { id: 'one', q: 'How do I run only the tests in terminal/test/room.test.mjs?', want: [/bun (run )?test\s+(\.\/)?terminal\/test\/room\.test\.mjs/], right: 'bun run test (or bun test) with that one file' },
  { id: 'parts', q: 'Can the agent code in the terminal part import models/runtime/warmup.mjs directly?', want: [NO, /models\/index\.mjs/], right: 'no: only through models/index.mjs' },
  { id: 'commit', q: 'What do I have to run before I commit?', want: [/bun run docs/], right: 'bun run docs' },
  { id: 'gemma', q: 'I am making a page about a Gemma test run. Where does it go?', want: [/gemma-docs\/test/], right: 'gemma-docs/test/' },
  { id: 'memory', q: 'My test saves a memory fact. How do I keep it from touching the real memory?', want: [/AGENTIC_HOME/], right: 'set AGENTIC_HOME' },
  { id: 'record', q: 'I ran a one-off speed probe. How do I record it?', want: [/recordTest/], right: 'recordTest() from models/evals/record.mjs' },
  { id: 'secret', q: 'Can I commit a file with an API key in it, to test /remote?', want: [NO, /public|secret/i], right: 'no: the repo is public' },
  { id: 'raw', q: 'Where do raw model results go, and are they committed?', want: [/models\/\S*results/i, NO], right: 'models/<model>/results/, not in git' },
  { id: 'older', q: 'A newer version replaces a page I made. Do I delete the old one?', want: [/older versions/i], right: 'no: it moves to older versions/' },
];
export const gradeAnswer = (q, text) => q.want.every((re) => re.test(String(text ?? '')));

const TASK = 'In terminal/test/room.test.mjs, add a test that a 128k window (131072 tokens) gets 36,000 characters of rules room from rulesRoomFor.';
// The task's grade: the test is there and the file passes with one test more than before.
export function gradeTask(file, out, code, before = 6) {
  const has = /rulesRoomFor\(\s*131_?072\s*\)/.test(file) && /36_?000/.test(file);
  const pass = Number(/(\d+) pass/.exec(out)?.[1] ?? 0);
  const fail = Number(/(\d+) fail/.exec(out)?.[1] ?? 0);
  return { ok: has && code === 0 && fail === 0 && pass > before, has, pass, fail };
}
// Which tests a run started: its own Bash calls, and the app's check at the end.
export const testsRun = (log) => log.flatMap((e) => (e.type === 'tool' && e.label === 'Bash' && /\btest\b/.test(String(e.arg ?? '')) ? [String(e.arg).slice(0, 120)] : e.type === 'note' && /^Checking the change: /.test(e.text ?? '') ? [`${e.text.replace(/^Checking the change: /, '')} (the app's check)`] : []));

// The two files: before (AGENTS.md from the commit before AGENTS-DETAILS.md came in; HEAD while it
// is not committed yet) and now (the working folder's).
function files() {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const added = git('log', '--diff-filter=A', '--format=%H', '--', 'AGENTS-DETAILS.md').stdout.trim().split('\n').filter(Boolean).at(-1);
  const old = git('show', `${added ? `${added}^` : 'HEAD'}:AGENTS.md`);
  if (old.status !== 0) throw new Error(`the old AGENTS.md is not in git here: ${old.stderr.trim()}`);
  const read = (n) => { try { return readFileSync(join(root, n), 'utf8'); } catch { return null; } };
  return {
    old: { label: 'old', files: { 'AGENTS.md': old.stdout }, from: added ? `${added.slice(0, 7)}^` : 'HEAD' },
    now: { label: 'new', files: { 'AGENTS.md': read('AGENTS.md'), ...(read('AGENTS-DETAILS.md') ? { 'AGENTS-DETAILS.md': read('AGENTS-DETAILS.md'), 'CLAUDE.md': read('CLAUDE.md') } : {}) }, from: 'this code' },
  };
}
const put = (dir, fs) => { for (const [n, t] of Object.entries(fs)) writeFileSync(join(dir, n), t); };

// The engine's own time for reading a prompt, nothing saved (the best of two).
async function readSecs(url, system) {
  let best = null;
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: 'hi' }], max_tokens: 1, cache_prompt: false, chat_template_kwargs: { enable_thinking: false } }) }).then((x) => x.json()).catch(() => null);
    const t = r?.timings;
    const got = t?.prompt_ms ? { secs: t.prompt_ms / 1000, tokens: t.prompt_n } : { secs: (Date.now() - t0) / 1000, tokens: r?.usage?.prompt_tokens ?? null };
    if (!best || got.secs < best.secs) best = got;
  }
  return best;
}

function previous(out, model) {
  const up = dirname(out);
  const runs = existsSync(up) ? readdirSync(up).filter((d) => d.startsWith('rules-file-') && join(up, d) !== out).sort() : [];
  for (const d of runs.reverse()) {
    try { const s = JSON.parse(readFileSync(join(up, d, 'summary.json'), 'utf8')); if (s.model === model && !s.stopped) return { s, rows: JSON.parse(readFileSync(join(up, d, 'rows.json'), 'utf8')) }; } catch {}
  }
  return null;
}

function finish(out, rows, s, look) {
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(s, null, 2));
  if (look) { console.log('a look only: no results page, no line in the test record'); return; }
  if (existsSync(DOCS_DIR)) { writeFileSync(docsPath(s.page), rulesFilePage({ summary: s, rows, prev: previous(out, s.model), raw: [shown(out)] })); console.log(`results page: ${s.page}`); }
  else { console.log(`no results page: the pages folder is not here (${DOCS_DIR})`); s.page = ''; }
  recordTest({
    kind: 'other', name: 'Rules file old vs new', model: s.model, effort: 'low', ctx: s.ctx, passed: rows.filter((r) => r.ok).length, total: rows.length, secs: s.secs, part: s.stopped,
    bar: 'the new AGENTS.md: as many right answers as the old, a faster start, the task passing in no more time',
    result: s.stopped ? 'stopped' : s.pass ? 'pass' : 'fail',
    note: `right answers: new ${s.right.new} of ${QUESTIONS.length}, old ${s.right.old} · start: new ${s.start.new?.secs?.toFixed(1)} s, old ${s.start.old?.secs?.toFixed(1)} s · task: new ${s.task.new?.ok ? 'passed' : 'failed'} in ${Math.round(s.task.new?.secs ?? 0)} s, old ${s.task.old?.ok ? 'passed' : 'failed'} in ${Math.round(s.task.old?.secs ?? 0)} s`,
    raw: shown(out), ...(s.page ? { page: s.page } : {}),
  });
}

// The rule, from the rows.
export function summarize(rows, extra = {}) {
  const right = { old: 0, new: 0 };
  const task = {};
  for (const r of rows) {
    if (r.kind === 'question' && r.ok) right[r.file]++;
    if (r.kind === 'task') task[r.file] = { ok: r.ok, secs: r.secs, tests: r.tests };
  }
  const start = extra.start ?? {};
  const asked = rows.filter((r) => r.kind === 'question').length;
  const complete = asked === QUESTIONS.length * 2 && task.old && task.new && start.old && start.new;
  const pass = Boolean(complete && right.new >= right.old && start.new.secs < start.old.secs && task.new.ok && (!task.old.ok || task.new.secs <= task.old.secs));
  return { ...extra, right, task, start, pass, stopped: !complete };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const model = MODELS[opt('model', DEFAULT_MODEL)];
  if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }

  if (args.includes('--rebuild')) {
    const dir = opt('rebuild');
    const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    const rows = JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8'));
    if (!s.page || !existsSync(DOCS_DIR)) { console.error('no page to draw: this run has none, or the pages folder is not here'); process.exit(2); }
    writeFileSync(docsPath(s.page), rulesFilePage({ summary: s, rows, prev: previous(dir, s.model), raw: [shown(dir)] }));
    console.log(`results page drawn again: ${s.page}`);
    process.exit(0);
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const out = opt('out') ?? join(modelFolder(model), 'results', `rules-file-${stamp}`); // modelFolder is already whole
  mkdirSync(out, { recursive: true });
  const look = args.includes('--no-record');
  const F = files();
  if (!F.now.files['AGENTS.md']) { console.error('no AGENTS.md in the repo'); process.exit(2); }

  let stopping = false;
  let ac = null;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; ac?.abort(); console.log('stopping: keeping what is done so far…'); });

  let url = opt('url'), srv = null;
  const t0 = Date.now();
  if (!url) {
    const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
    const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
    if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
    for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
    const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
    if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
    try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    console.log(`${model.name} · the old AGENTS.md (${F.old.from}) against this code's · loading the model…`);
    srv = new ModelServer(model);
    await srv.start({ ctx: CTX, share: false, lingerSecs: 0 });
    url = srv.url;
  } else console.log(`${model.name} · on ${url}`);

  const rows = [];
  const start = {};
  const realHome = process.env.HOME;
  // Nothing the model runs may reach the user's test record or memory.
  process.env.AGENTIC_NO_RECORD = '1';
  process.env.AGENTIC_MEMORY_SAVE = 'off';
  const home = mkdtempSync(join(tmpdir(), 'rules-file-home-'));
  process.env.AGENTIC_HOME = join(home, '.agentic-coder');
  try {
    const kinds = [['old', F.old], ['new', F.now]];
    // 1. The start: the prompt the app builds for a folder with only that file.
    for (const [k, f] of kinds) {
      const dir = mkdtempSync(join(tmpdir(), `rules-file-${k}-`));
      put(dir, f.files);
      const notes = projectNotes(dir, undefined, { memory: false }).text;
      start[k] = { ...(await readSecs(url, systemPrompt({ cwd: dir, notes, git: '' }))), chars: notes.length };
      console.log(`start, ${k} file: ${start[k].secs.toFixed(1)} s to read ${start[k].tokens ?? '?'} tokens (${notes.length} characters of rules)`);
    }
    // 2. The questions, each in a fresh conversation, the files taking turns.
    for (const q of QUESTIONS) for (const [k, f] of kinds) {
      if (stopping) break;
      const dir = mkdtempSync(join(tmpdir(), `rules-file-q-${k}-`));
      put(dir, f.files);
      ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), Q_LIMIT_MS);
      process.env.HOME = home;
      const r = await runHeadless({ prompt: q.q, cwd: dir, url, model, thinking: false, effort: 'low', ctx: CTX, autoApprove: true, memory: false, rank: false, signal: ac.signal }).catch((e) => ({ finalText: '', secs: 0, reason: `crash: ${e.message}`, log: [] }));
      process.env.HOME = realHome;
      clearTimeout(timer);
      const ok = gradeAnswer(q, r.finalText);
      rows.push({ id: `${q.id}-${k}`, kind: 'question', file: k, q: q.id, name: `${k} file · ${q.q}`, ok, secs: Math.round(r.secs * 10) / 10, answer: String(r.finalText ?? '').slice(0, 600), detail: `${ok ? 'right' : `wanted ${q.right}`}: “${String(r.finalText ?? '').replace(/\s+/g, ' ').slice(0, 220)}”`, steps: r.steps ?? 0 });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${k} · ${q.id}: ${String(r.finalText ?? '').replace(/\s+/g, ' ').slice(0, 100)}`);
      rmSync(dir, { recursive: true, force: true });
    }
    // 3. The task, on a copy of the repo at this code with that file.
    const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: root, maxBuffer: 1 << 28 });
    for (const [k, f] of kinds) {
      if (stopping) break;
      const dir = mkdtempSync(join(tmpdir(), `rules-file-task-${k}-`));
      spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout });
      for (const n of ['AGENTS-DETAILS.md', 'CLAUDE.md']) rmSync(join(dir, n), { force: true });
      put(dir, f.files);
      if (!f.files['CLAUDE.md']) writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
      if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['add', '-A'], { cwd: dir });
      spawnSync('git', ['-c', 'user.name=check', '-c', 'user.email=check@localhost', 'commit', '-qm', 'start'], { cwd: dir });
      ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TASK_LIMIT_MS);
      process.env.HOME = home;
      const r = await runHeadless({ prompt: TASK, cwd: dir, url, model, thinking: false, effort: 'low', ctx: CTX, autoApprove: true, memory: false, rank: false, signal: ac.signal }).catch((e) => ({ finalText: '', secs: 0, reason: `crash: ${e.message}`, log: [] }));
      process.env.HOME = realHome;
      clearTimeout(timer);
      const check = spawnSync('bun', ['test', 'terminal/test/room.test.mjs'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
      const file = existsSync(join(dir, 'terminal/test/room.test.mjs')) ? readFileSync(join(dir, 'terminal/test/room.test.mjs'), 'utf8') : '';
      const g = gradeTask(file, `${check.stdout}${check.stderr}`, check.status);
      const tests = testsRun(r.log ?? []);
      rows.push({ id: `task-${k}`, kind: 'task', file: k, name: `${k} file · the task: a test added to room.test.mjs`, ok: g.ok, secs: Math.round(r.secs), tests, steps: r.steps ?? 0,
        detail: `${g.ok ? 'passed' : g.has ? 'the test is there but the file does not pass' : 'no such test was added'} (${g.pass} pass, ${g.fail} fail after) · tests it ran: ${tests.length ? tests.join('; ') : 'none'} · ${r.reason ?? ''}` });
      console.log(`${g.ok ? 'PASS' : 'FAIL'} ${k} · task in ${Math.round(r.secs)} s · tests it ran: ${tests.join('; ') || 'none'}`);
      writeFileSync(join(out, `task-${k}.diff`), spawnSync('git', ['diff'], { cwd: dir, encoding: 'utf8' }).stdout ?? '');
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    process.env.HOME = realHome;
    for (const k of ['AGENTIC_NO_RECORD', 'AGENTIC_MEMORY_SAVE', 'AGENTIC_HOME']) delete process.env[k];
    rmSync(home, { recursive: true, force: true });
    if (srv) { try { await srv.stop(); } catch {} }
  }

  const s = summarize(rows, { model: model.id, name: model.name, ctx: CTX, code: codeLabel(), oldFrom: F.old.from, started: new Date(t0).toISOString(), secs: (Date.now() - t0) / 1000, start,
    chars: { old: F.old.files['AGENTS.md'].length, new: F.now.files['AGENTS.md'].length },
    page: !look && existsSync(DOCS_DIR) ? `tests/agentic-coder-rules-file-${model.id}-${stamp}.html` : '' });
  finish(out, rows, s, look);
  console.log(`Rules file old vs new on ${model.name}: right answers new ${s.right.new}, old ${s.right.old} of ${QUESTIONS.length} · ${s.pass ? 'PASSED' : s.stopped ? 'STOPPED' : 'FAILED'}`);
  process.exit(0);
}
