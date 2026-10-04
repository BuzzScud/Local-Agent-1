// The ladder check (▶ Run a test → Maps and notes check, `/test ladder`; 3 Oct 2026): what the code
// maps (docs/map/) and the pack of Claude's notes (~/.agentic-coder/claude-pack) add, asked the same
// way before and after they were built.
//   reach    the 16 questions about the user's work, without a model: does the note that comes along
//            hold the answer? Once as a model on this Mac gets the notes (all of them), once as a
//            service gets them (Memory sent: only notes about the project it works in).
//   where    20 "where is it?" questions, 10 in agentic-coder and 10 in MAIN2026, asked in the repo.
//            Right: the answer names the file of the answer key, and no file it names is made up.
//   notes    the questions whose notes belong to MAIN2026, asked inside MAIN2026 on the service.
//   privacy  three questions about the user asked on the service from an empty folder: after the
//            change no note about the user may go along (before, any that matched did).
// The set names the user's own notes and work, so it is kept on the Mac (models/remote/results,
// which git ignores), not in the repo.
//   node models/evals/tools/ladder-check.mjs --label before|after [--repo <app checkout>] [--parts reach,where,notes,privacy]
//        [--configs remote,local] [--only w3,n12] [--limit 240] [--remote <address> --remote-model <name>] [--out dir] [--no-record]
//   --model <id>  a model on this Mac instead of a service (the 9B: --model qwen), loaded for the run: no
//              shared service, so no other conversation can mix into its answers; the privacy part is
//              left out (nothing leaves the Mac) and every note may come, as for any model here
//   --repo     the checkout whose app is asked (its terminal/ and models/ are imported); its own folder is
//              the agentic-coder the "where" questions are asked in. Default: this one.
//   --configs  remote: the remote instructions, as /remote runs a big model (Who decides from its limits);
//              local: the local instructions with the app deciding, as a model on this Mac runs.
//   node models/evals/tools/ladder-check.mjs --page <before dir> <after dir>: the results page of both
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const home = process.env.AGENTIC_REPO ?? root; // where the results go
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
export const SET_FILE = join(home, 'models', 'remote', 'results', 'ladder-check-set.json');
export const MAIN2026 = process.env.AGENTIC_MAIN2026 ?? join(homedir(), 'Desktop', 'MAIN2026-main-2');

// A file named in an answer: a path or a name with a code or text extension.
const NAMED = /(?:[\w@.-]+\/)*[\w@.-]+\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|py|sh|css|html|sql|yml|yaml|swift)\b/g;
export function namedFiles(text) { return [...new Set(String(text).match(NAMED) ?? [])].filter((p) => !/^\d|^https?:/.test(p) && !/^[\d.]+$/.test(p)); }

// Every file of a project by its name, to tell a made-up file from a real one.
const ALL_SKIP = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__|\.venv|venv)(\/|$)/;
export function fileNames(dir) {
  const names = new Set();
  const paths = new Set();
  const walk = (d, rel, depth) => {
    if (depth > 14) return;
    let list = [];
    try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (ALL_SKIP.test(r)) continue;
      if (e.isDirectory()) walk(join(d, e.name), r, depth + 1);
      else { names.add(e.name); paths.add(r); }
    }
  };
  walk(dir, '', 0);
  return { names, paths };
}
// A named file is real when its path is in the project, or (a bare name) some file has that name.
// A file of Claude's notes (NOTES/…, a topic of the pack) is not a project file and is not judged here.
export const notesFile = (p, pack = packFiles()) => /^(\.\/)?NOTES\//.test(p) || pack.has(basename(p));
const packFiles = (() => { let s = null; return () => (s ??= new Set((() => { try { return readdirSync(join(process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder'), 'claude-pack')).filter((f) => f.endsWith('.md')); } catch { return []; } })())); })();
export function madeUp(named, files) {
  return named.filter((p) => {
    if (notesFile(p) || /^\.?\d*\.md$/.test(basename(p))) return false;
    const clean = p.replace(/^\.\//, '');
    if (files.paths.has(clean)) return false;
    if ([...files.paths].some((f) => f.endsWith(`/${clean}`))) return false;
    return !files.names.has(basename(clean));
  });
}

const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

async function run() {
  const label = opt('label', null);
  if (!['before', 'after'].includes(label)) { console.error('--label before or after'); process.exit(2); }
  const repo = resolve(opt('repo', root));
  const setFile = opt('set', SET_FILE);
  if (!existsSync(setFile)) { console.error(`the set is not on this Mac: ${setFile}`); process.exit(2); }
  const set = JSON.parse(readFileSync(setFile, 'utf8'));
  const parts = opt('parts', 'reach,where,notes,privacy').split(',');
  const configs = opt('configs', 'remote,local').split(',');
  const only = opt('only', null)?.split(',');
  const limit = Number(opt('limit', 240)) * 1000;
  const out = opt('out', join(home, 'models', 'remote', 'results', `ladder-${label}-${stampOf()}`));
  mkdirSync(out, { recursive: true });
  // The app under test, from its own checkout.
  const T = await import(pathToFileURL(join(repo, 'terminal', 'index.mjs')).href);
  const M = await import(pathToFileURL(join(repo, 'models', 'index.mjs')).href);
  const notesMod = T; // notesDir, notesCount, recallClaude: through terminal/index.mjs, the seam
  const cwdOf = (q) => (q.project === 'MAIN2026' ? MAIN2026 : q.project === 'agentic-coder' ? repo : null);
  const empty = () => { const d = join(mkdtempSync(join(tmpdir(), 'agentic-ladder-')), 'desk'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'README.md'), '# A folder to ask questions from\n'); return d; };
  const rows = [];
  const save = () => writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 1));
  const t0 = Date.now();
  let stopping = false;
  let ac = null;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: the question under way ends now'); ac?.abort(); });

  // 1 · reach: the matcher alone. 'all' as a model on this Mac; 'project' as a service (when the app knows how).
  if (parts.includes('reach')) {
    const dir = notesMod.notesDir();
    const count = dir ? notesMod.notesCount(dir) : { all: 0, used: 0 };
    console.log(`Claude's notes: ${dir ? dir.replace(homedir(), '~') : 'none found'} (${count.used} used of ${count.all})`);
    for (const [i, q] of set.notes.entries()) {
      const id = `n${i + 1}`;
      if (only && !only.includes(id)) continue;
      for (const sent of ['all', 'project']) {
        const cwd = q.project === 'MAIN2026' ? MAIN2026 : join(homedir(), 'Desktop', 'somewhere');
        let got = { notes: [] };
        // Before the change the matcher has no "sent": a service got what a model on this Mac gets.
        try { got = await notesMod.recallClaude(cwd, q.q, { dir, embedder: null, sent }); } catch (e) { got = { notes: [], error: e.message }; }
        const right = got.notes.some((n) => new RegExp(q.need, 'i').test(`${n.description}\n${n.part}`));
        const aboutUser = got.notes.filter((n) => n.type !== 'project' && !n.project).length;
        rows.push({ part: 'reach', id, sent, q: q.q, right, notes: got.notes.map((n) => n.id), aboutUser, want: q.notes });
        console.log(`${right ? 'PASS' : 'FAIL'} reach ${sent.padEnd(7)} ${id.padEnd(4)} ${q.q.slice(0, 56).padEnd(56)} → ${got.notes.map((n) => n.id).join(' · ') || '-'}`);
      }
    }
    save();
  }

  let conn = null;
  const modelParts = parts.filter((p) => p !== 'reach');
  if (!modelParts.length || stopping) return finish();
  const localId = opt('model', null);
  if (localId) {
    const model = M.MODELS[localId];
    if (!model) { console.error(`no model "${localId}"; one of: ${Object.keys(M.MODELS).join(', ')}`); process.exit(2); }
    const server = new M.ModelServer(model);
    const started = await server.start({ ctx: Number(opt('ctx', 32768)), share: false });
    conn = { url: server.url, model, ctx: started.ctx, info: { model: model.name }, stop: () => server.stop() };
    console.log(`on this Mac: ${model.name}, ${Math.round(conn.ctx / 1024)}k context`);
  } else {
    let saved = null;
    try { saved = JSON.parse(readFileSync(join(M.HOME, 'settings.json'), 'utf8')).remote ?? null; } catch {}
    const address = opt('remote', null) ?? (saved?.address ? M.directUrl(saved) : null);
    const name = opt('remote-model', 'Qwen3.6:35B-A3B');
    if (!address) { console.error('no service: give --remote <address>, or --model <id> for a model on this Mac'); process.exit(2); }
    conn = await M.connectRemote({ use: true, source: 'openai', kind: 'openai', connect: 'http', address, model: name, context: Number(opt('ctx', 32768)), key: false });
    console.log(`on the service: ${conn.info.model} at ${address}, ${Math.round(conn.ctx / 1024)}k context`);
  }
  const memHome = mkdtempSync(join(tmpdir(), 'agentic-ladder-memory-'));
  const fileLists = new Map();
  const filesOf = (dir) => { if (!fileLists.has(dir)) fileLists.set(dir, fileNames(dir)); return fileLists.get(dir); };
  const READ_ONLY = new Set(['Read', 'List', 'Search', 'Map', 'CodeSearch', 'Ask', 'TodoWrite', 'Agent']);

  async function ask(q, { id, part, config, cwd }) {
    process.env.AGENTIC_INSTRUCTIONS = config === 'local' ? 'local' : 'remote';
    const limits = T.readLimits({}, conn.model);
    const did = [];
    const claude = [];
    let opening = 0;
    ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), limit);
    let r;
    try {
      r = await T.runHeadless({ prompt: q.q, cwd, url: conn.url, model: conn.model, thinking: false, ctx: conn.ctx, limits, way: config === 'local' ? 'app' : undefined,
        autoApprove: true, approve: (req) => READ_ONLY.has(req.name) || (req.name === 'Bash' && /^(git (log|show|grep|ls-files)|ls|cat|head|grep|rg|find|wc)\b/.test(String(req.args?.command ?? '').trim())),
        answers: () => 'I do not know. Answer from what you have found.', signal: ac.signal,
        memory: { home: memHome, save: false, embedder: null, claude: true },
        onEvent: (type, ev) => {
          if (type === 'tool') { did.push(`${ev.given ? '+' : ''}${ev.name}(${String(ev.arg ?? '').slice(0, 70)})${ev.error ? ' ✗' : ''}`); if (ev.view?.kind === 'opening') opening = String(ev.view.content ?? '').length; }
          if (type === 'memory' && ev.claude) claude.push(...ev.claude);
        } });
    } catch (e) { r = { reason: `crash: ${e.message}`, finalText: '', secs: limit / 1000, steps: 0 }; }
    clearTimeout(timer);
    const answer = r.finalText ?? '';
    const named = namedFiles(answer);
    const wrong = part === 'where' ? madeUp(named, filesOf(cwd)) : [];
    const hit = new RegExp(q.need, 'i').test(answer);
    const userNotes = claude.filter((n) => n.type !== 'project' && !n.project).map((n) => n.id);
    const right = part === 'privacy' ? userNotes.length === 0 : hit && !wrong.length;
    const row = { part, id, config, q: q.q, right, hit, secs: Math.round(r.secs ?? 0), steps: r.steps ?? 0, reason: ac.signal.aborted ? 'time limit' : r.reason, named, wrong, notes: claude.map((n) => n.id), userNotes, opening, did, answer: answer.slice(0, 3000) };
    rows.push(row);
    save();
    console.log(`${right ? 'PASS' : 'FAIL'} ${part.padEnd(7)} ${config.padEnd(6)} ${id.padEnd(4)} ${String(row.secs).padStart(4)}s ${String(row.steps).padStart(2)} steps  ${q.q.slice(0, 60)}${wrong.length ? `  made up: ${wrong.join(', ')}` : ''}${claude.length ? `  [${claude.map((n) => n.id).join(', ')}]` : ''}`);
    console.log(`       ${answer.replace(/\s+/g, ' ').slice(0, 220)}`);
    return row;
  }

  try {
    for (const config of configs) {
      if (stopping) break;
      if (modelParts.includes('where')) for (const [i, q] of set.where.entries()) {
        const id = `w${i + 1}`;
        if (stopping) break;
        if (only && !only.includes(id)) continue;
        await ask(q, { id, part: 'where', config, cwd: cwdOf(q) });
      }
      // The notes and the privacy questions on the remote instructions only: the gate is the same for both.
      if (config !== 'remote') continue;
      if (modelParts.includes('notes')) for (const [i, q] of set.notes.entries()) {
        const id = `n${i + 1}`;
        if (stopping) break;
        if (q.project !== 'MAIN2026' || (only && !only.includes(id))) continue;
        await ask(q, { id, part: 'notes', config, cwd: MAIN2026 });
      }
      if (modelParts.includes('privacy') && !localId) for (const [i, q] of set.notes.entries()) {
        const id = `n${i + 1}`;
        if (stopping) break;
        if (!set.privacy.includes(id) || (only && !only.includes(`p${i + 1}`))) continue;
        await ask(q, { id: `p${i + 1}`, part: 'privacy', config, cwd: empty() });
      }
    }
  } finally {
    try { await conn.stop?.(); } catch {}
  }
  return finish();

  function finish() {
    const by = (p, c) => rows.filter((r) => r.part === p && (!c || r.config === c || r.sent === c));
    const sum = (list) => ({ right: list.filter((r) => r.right).length, of: list.length, secs: list.reduce((s, r) => s + (r.secs ?? 0), 0), steps: list.reduce((s, r) => s + (r.steps ?? 0), 0), wrong: list.reduce((s, r) => s + (r.wrong?.length ?? 0), 0) });
    const summary = { label, when: new Date().toISOString(), repo, ctx: conn?.ctx ?? null, code: M?.codeLabel ? safe(() => M.codeLabel(repo)) : null, model: opt('model', null) ?? opt('remote-model', 'Qwen3.6:35B-A3B'), local: Boolean(opt('model', null)), stopped: stopping, secs: Math.round((Date.now() - t0) / 1000),
      reach: { all: sum(by('reach', 'all')), project: sum(by('reach', 'project')), userToService: by('reach', 'project').reduce((s, r) => s + r.aboutUser, 0) },
      where: Object.fromEntries(configs.map((c) => [c, sum(by('where', c))])), notes: sum(by('notes')), privacy: sum(by('privacy')) };
    writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
    console.log(`\n${label}: reach ${summary.reach.all.right}/${summary.reach.all.of} (as a service ${summary.reach.project.right}/${summary.reach.project.of}, notes about the user sent: ${summary.reach.userToService})`);
    for (const c of configs) console.log(`where (${c}): ${summary.where[c].right}/${summary.where[c].of}, ${summary.where[c].secs} s, ${summary.where[c].steps} steps, ${summary.where[c].wrong} made-up files`);
    console.log(`notes in MAIN2026: ${summary.notes.right}/${summary.notes.of} · privacy: ${summary.privacy.right}/${summary.privacy.of}\nsaved in ${out}`);
    // After: the page against the run before the maps (--compare, else the newest ladder-before folder).
    if (label === 'after' && !stopping && !args.includes('--no-record')) {
      const results = join(home, 'models', 'remote', 'results');
      const compare = opt('compare', null) ?? readdirSync(results).filter((d) => d.startsWith('ladder-before') && existsSync(join(results, d, 'summary.json'))).map((d) => join(results, d)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (compare) return import('./ladder-page.mjs').then((m) => m.ladderPage(compare, out, { record: !args.includes('--no-record') })).then(() => summary);
      console.log('no run from before the maps to compare with: no page, no line in the test record');
    }
    return summary;
  }
}
const safe = (f) => { try { return f(); } catch { return null; } };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args[0] === '--page') {
    const { ladderPage } = await import('./ladder-page.mjs');
    await ladderPage(args[1], args[2], { record: !args.includes('--no-record') });
  } else {
    // Keeps the Mac awake for the run.
    try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    await run();
  }
  process.exit(0);
}
