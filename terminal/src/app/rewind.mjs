// /rewind: put files, and the conversation, back to how they were before one
// of your messages.
//
// Before each message and when its work ends, the project is copied into a
// private store: a bare git folder in Agentic Coder's home, never the
// project's own git, so its staging, stashes and branches are not touched.
// Comparing the two copies says which files the message changed. Which of
// those were the model's comes from two more sources: the files its edits
// wrote (the agent's list) and a copy before and after each command it ran.
// A file that changed while it worked but by neither is someone else's and is
// left alone. Only the model's files go back, and only while nobody has
// changed them since.
//
// In the home folder (and a folder too big to copy quickly) nothing is
// copied: only the text of each file before the model's Edit or Write is kept.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, lstatSync, readlinkSync,
  rmSync, rmdirSync, symlinkSync, chmodSync, copyFileSync, unlinkSync, appendFileSync,
} from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { isHomeFolder } from '../agent/prompt.mjs';

export const KEEP_DAYS = 7; // a conversation's copies go 7 days after it was last used
export const MAX_FILES = 25_000; // more than this in a folder: its edits only
export const BIG_FILE = 25 * 1024 * 1024; // a file bigger than this is never copied
const LIST_MS = 10_000; // listing a folder for the first copy may take this long
// Never worth a copy: what a package manager or a build puts back by itself.
const EXCLUDE = ['.git', '.agentic/', '.bonsai/', 'node_modules/', '.venv/', 'venv/', '__pycache__/', '.next/', '.nuxt/', '.parcel-cache/', '.turbo/', '.DS_Store', '*.gguf', '.agentic-check/'];
// Stored byte for byte: no line-ending change, no LFS or other filter.
const ATTRIBUTES = '* -text -eol -filter -ident -working-tree-encoding -diff\n';
const NONE = '0000000000000000000000000000000000000000';
// A message waits this long at most for its copy; past it, only the model's
// own edits are kept for it (the copy finishes in the background).
export const BEGIN_WAIT_MS = 20_000;
const LATE = Symbol('late');
const within = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(LATE), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

const slug = (cwd) => cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100) || 'root';
export const keyOf = (text) => createHash('sha1').update(String(text)).digest('hex');
// The id git gives these bytes as a file.
export const blobId = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// git on the private store only: every GIT_ variable of the shell is dropped,
// so nothing points it at the project's own repository. Each call has a time
// limit, and ends at git's exit even if its output streams never report
// closing: in a full test run one write-tree of 1,110 never finished, and
// the message behind it waited for good.
export function git(store, args, { work, index, input, ms } = {}) {
  const limit = ms ?? (args[0] === 'add' || args[0] === 'ls-files' ? 120_000 : 20_000);
  return new Promise((resolve) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    Object.assign(env, { GIT_DIR: store, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
    if (work) env.GIT_WORK_TREE = work;
    if (index) env.GIT_INDEX_FILE = index;
    const conf = ['-c', 'core.quotepath=off', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'core.untrackedCache=false'];
    let child;
    try { child = spawn('git', [...conf, ...args], { cwd: work ?? store, env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: Buffer.alloc(0), err: e.message }); return; }
    const out = [];
    let err = '';
    let done = false;
    let grace = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      resolve({ code, out: Buffer.concat(out), err });
    };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} err += `git ${args[0]} took over ${limit / 1000} s`; finish(-1); }, limit);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    child.on('error', (e) => { err += e.message; finish(-1); });
    child.on('exit', (code) => { grace = setTimeout(() => finish(code), 1000); });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// A file as it is now: its id (null when there is none), or 'other' for a
// folder or anything that is not a file or a link.
export function currentId(abs) {
  let st;
  try { st = lstatSync(abs); } catch { return null; }
  if (st.isSymbolicLink()) return blobId(Buffer.from(readlinkSync(abs)));
  if (!st.isFile()) return 'other';
  return blobId(readFileSync(abs));
}
const modeOf = (abs) => { try { const st = lstatSync(abs); return st.isSymbolicLink() ? '120000' : st.mode & 0o111 ? '100755' : '100644'; } catch { return null; } };

// One literal path as an exclude line (anchored, special characters escaped).
const excludeLine = (rel) => `/${rel.split(sep).join('/').replace(/[\\*?[\]!#]/g, '\\$&').replace(/ $/, '\\ ')}`;

// The project's own ignore list that lives in its .git (not in a .gitignore
// file), when the folder is the top of a repository.
function projectExcludes(cwd) {
  try {
    const top = join(cwd, '.git');
    if (!existsSync(top)) return '';
    let gitDir = top;
    if (statSync(top).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(top, 'utf8'));
      if (!m) return '';
      gitDir = m[1].trim().startsWith('/') ? m[1].trim() : join(cwd, m[1].trim());
      const common = join(gitDir, 'commondir');
      if (existsSync(common)) { const c = readFileSync(common, 'utf8').trim(); gitDir = c.startsWith('/') ? c : join(gitDir, c); }
    }
    const f = join(gitDir, 'info', 'exclude');
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  } catch { return ''; }
}

export class Rewind {
  // maxFiles, bigFile, beginWaitMs: the limits above (tests make them small).
  constructor({ home, session, now = () => Date.now(), maxFiles = MAX_FILES, bigFile = BIG_FILE, beginWaitMs = BEGIN_WAIT_MS }) {
    this.home = home;
    this.beginWaitMs = beginWaitMs;
    this.maxFiles = maxFiles;
    this.bigFile = bigFile;
    this.root = join(home, 'rewind');
    this.session = session;
    this.now = now;
    this.stores = new Map(); // cwd → { cwd, dir, index, mode, ready }
    this.points = [];
    this.open = null; // the message being worked on
    this.chain = Promise.resolve(); // one store step at a time
    this.load();
  }

  // Runs fn after every earlier step, so two snapshots never share an index.
  queue(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  get file() { return join(this.root, 'sessions', `${this.session}.json`); }
  load() {
    try { this.points = JSON.parse(readFileSync(this.file, 'utf8')).points ?? []; } catch { this.points = []; }
    this.next = (this.points.at(-1)?.n ?? 0) + 1;
  }
  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const points = this.points.map(({ msg, ...p }) => p);
      writeFileSync(this.file, JSON.stringify({ id: this.session, updated: new Date(this.now()).toISOString(), points }));
    } catch { /* the list comes back empty next time */ }
  }
  // /clear and /resume: another conversation, its own list.
  setSession(id) {
    if (id === this.session) return;
    this.session = id;
    this.open = null;
    this.stores = new Map(); // each conversation copies with its own index
    this.load();
  }

  // The store for a folder, made ready (the first copy) in the background.
  store(cwd) {
    let st = this.stores.get(cwd);
    if (st) return st;
    const dir = join(this.root, 'stores', slug(cwd), 'store.git');
    st = { cwd, dir, index: join(dirname(dir), 'indexes', this.session), mode: isHomeFolder(cwd) ? 'edits' : 'full', why: isHomeFolder(cwd) ? 'home' : null };
    this.stores.set(cwd, st);
    if (st.mode === 'full') st.ready = this.queue(() => this.prepare(st));
    else st.ready = Promise.resolve();
    return st;
  }
  // Start copying a folder now, so the first message does not wait for it.
  warm(cwd) { return this.store(cwd).ready; }

  async prepare(st) {
    try {
      if (!existsSync(join(st.dir, 'HEAD'))) {
        mkdirSync(st.dir, { recursive: true });
        const r = await git(st.dir, ['init', '-q', '--bare', st.dir]);
        if (r.code !== 0) throw new Error(r.err || 'git init failed');
      }
      mkdirSync(join(st.dir, 'info'), { recursive: true });
      writeFileSync(join(st.dir, 'info', 'attributes'), ATTRIBUTES);
      const own = projectExcludes(st.cwd);
      const exFile = join(st.dir, 'info', 'exclude');
      // Big files found earlier stay out (lines after the marker).
      let big = '';
      try { big = readFileSync(exFile, 'utf8').split('# big files\n')[1] ?? ''; } catch {}
      writeFileSync(exFile, `${EXCLUDE.join('\n')}\n${own}\n# big files\n${big}`);
      mkdirSync(dirname(st.index), { recursive: true });
      // A new conversation starts from the newest index of this folder: only
      // what changed since is read again.
      if (!existsSync(st.index)) {
        const dir = dirname(st.index);
        const newest = readdirSync(dir).filter((f) => !f.endsWith('.lock')).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
        if (newest) copyFileSync(join(dir, newest.f), st.index);
      }
      // A folder with too many files is not copied (listing it has a time limit too).
      const listed = await Promise.race([
        git(st.dir, ['ls-files', '-o', '--exclude-standard', '-z'], { work: st.cwd, index: st.index }),
        new Promise((r) => setTimeout(() => r(null), LIST_MS)),
      ]);
      if (!listed || listed.code !== 0) { st.mode = 'edits'; st.why = listed ? 'git' : 'slow'; return; }
      const fresh = listed.out.toString().split('\0').filter(Boolean);
      if (fresh.length > this.maxFiles) { st.mode = 'edits'; st.why = 'big'; return; }
      this.skipBig(st, fresh);
      st.last = await this.snapshot(st, { listed: true });
    } catch (e) { st.mode = 'edits'; st.why = 'git'; st.error = e.message; }
  }

  // New files over the size limit join the exclude list before they are copied.
  skipBig(st, rels) {
    const big = rels.filter((rel) => { try { return statSync(join(st.cwd, rel)).size > this.bigFile; } catch { return false; } });
    if (big.length) appendFileSync(join(st.dir, 'info', 'exclude'), `${big.map(excludeLine).join('\n')}\n`);
  }

  // Copies the folder into the store; returns the id of the copy.
  async snapshot(st, { listed = false } = {}) {
    if (!listed) {
      const r = await git(st.dir, ['ls-files', '-o', '--exclude-standard', '-z'], { work: st.cwd, index: st.index });
      if (r.code === 0) this.skipBig(st, r.out.toString().split('\0').filter(Boolean));
    }
    const once = async () => {
      await git(st.dir, ['add', '-A', '--ignore-errors', '--', '.'], { work: st.cwd, index: st.index });
      return git(st.dir, ['write-tree'], { work: st.cwd, index: st.index });
    };
    const ok = (x) => x.code === 0 && /^[0-9a-f]{40}$/.test(x.out.toString().trim());
    let r = await once();
    // An index that names something the store no longer holds: read it all again.
    if (!ok(r)) { rmSync(st.index, { force: true }); r = await once(); }
    if (!ok(r)) throw new Error(r.err.trim() || 'write-tree failed');
    return r.out.toString().trim();
  }

  // What changed between two copies: [{ path, before, bmode, after, amode }].
  async changes(st, a, b) {
    const r = await git(st.dir, ['diff-tree', '-r', '-z', '--no-renames', a, b]);
    if (r.code !== 0) return [];
    const parts = r.out.toString().split('\0');
    const out = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) (\w)/.exec(parts[i]);
      if (!m) continue;
      out.push({ path: parts[i + 1], bmode: m[1] === '000000' ? null : m[1], amode: m[2] === '000000' ? null : m[2], before: m[3] === NONE ? null : m[3], after: m[4] === NONE ? null : m[4] });
    }
    return out;
  }

  // A message starts: the folder as it is now.
  async begin({ cwd, text, at }) {
    const st = this.store(cwd);
    const point = { n: this.next++, at: at ?? new Date(this.now()).toISOString(), cwd, text: String(text), files: [], commands: new Set(), edits: new Map() };
    this.open = point;
    const t0 = Date.now();
    if (await within(st.ready, this.beginWaitMs) === LATE) { point.mode = 'edits'; point.late = true; return point; }
    point.mode = st.mode;
    if (st.mode === 'full') {
      try {
        const before = await within(this.queue(() => this.snapshot(st)), Math.max(100, this.beginWaitMs - (Date.now() - t0)));
        if (before === LATE) { point.mode = 'edits'; point.late = true; } else point.before = before;
      } catch (e) { point.mode = 'edits'; st.mode = 'edits'; st.why = 'git'; st.error = e.message; }
    }
    return point;
  }

  // "Work in <project>?" moved the work to another folder: copy that one.
  moved(cwd) {
    const p = this.open;
    if (!p || p.cwd === cwd) return;
    p.cwd = cwd;
    p.before = null;
    p.edits = new Map();
    p.commands = new Set();
    const st = this.store(cwd);
    p.moving = (async () => {
      if (await within(st.ready, this.beginWaitMs) === LATE) { p.mode = 'edits'; p.late = true; return; }
      p.mode = st.mode;
      if (st.mode === 'full') { try { p.before = await this.queue(() => this.snapshot(st)); } catch { p.mode = 'edits'; } }
    })();
  }

  // Resolves once the folder moved to is copied.
  whenMoved() { return this.open?.moving ?? Promise.resolve(); }

  // Before the model's Edit or Write: the file's text as it was (null: new).
  edited(abs, before) {
    const p = this.open;
    if (!p || p.edits.has(abs)) return;
    p.edits.set(abs, before === null ? null : Buffer.from(before));
  }

  // A command the model runs: a copy before and after it says what it changed.
  async around(run) {
    const p = this.open;
    if (!p) return run();
    await p.moving;
    const st = this.stores.get(p.cwd);
    if (p.mode !== 'full' || !st) return run();
    let pre = null;
    try { pre = await this.queue(() => this.snapshot(st)); } catch {}
    const out = await run();
    if (pre) {
      try {
        const post = await this.queue(() => this.snapshot(st));
        for (const c of await this.changes(st, pre, post)) p.commands.add(c.path);
      } catch {}
    }
    return out;
  }

  // The message's work has ended: what changed, and whose it was.
  // files: the paths (from its folder) the model's edits wrote.
  async finish(point, { files = [], message = null } = {}) {
    const p = point ?? this.open;
    if (!p) return null;
    if (this.open === p) this.open = null;
    await p.moving;
    const st = this.store(p.cwd);
    const edits = new Set([...files].map(String));
    const out = [];
    const seen = new Set();
    if (p.mode === 'full' && p.before) {
      try {
        p.after = await this.queue(() => this.snapshot(st));
        for (const c of await this.changes(st, p.before, p.after)) {
          seen.add(c.path);
          out.push({ ...c, by: edits.has(c.path) ? 'edit' : p.commands.has(c.path) ? 'command' : 'other' });
        }
      } catch { /* only the edits below */ }
    }
    // Files the copies leave out (the home folder, an ignored file): from the
    // text kept before each Edit or Write.
    for (const [abs, before] of p.edits) {
      const rel = relative(p.cwd, abs);
      if (rel.startsWith('..') || seen.has(rel)) continue;
      const beforeId = before === null ? null : await this.keep(st, before);
      let now = null;
      try { const st2 = lstatSync(abs); if (st2.isFile()) now = readFileSync(abs); } catch {}
      const afterId = now === null ? null : await this.keep(st, now);
      if (beforeId === afterId) continue;
      out.push({ path: rel, before: beforeId, bmode: before === null ? null : modeOf(abs) ?? '100644', after: afterId, amode: now === null ? null : modeOf(abs), by: 'edit' });
    }
    delete p.edits;
    delete p.commands;
    delete p.moving;
    p.files = out;
    if (message) { p.key = keyOf(message.content); p.msg = message; }
    // Keep everything this message needs from the store, or a clean-up could drop it.
    await this.pin(st, p);
    this.points.push(p);
    this.save();
    return p;
  }

  // A text into the store; its id.
  async keep(st, buf) {
    if (!existsSync(join(st.dir, 'HEAD'))) {
      mkdirSync(st.dir, { recursive: true });
      await git(st.dir, ['init', '-q', '--bare', st.dir]);
    }
    const r = await git(st.dir, ['hash-object', '-w', '--stdin'], { input: buf });
    return r.code === 0 ? r.out.toString().trim() : null;
  }

  // One ref per message holds its copies and every file text it may put back.
  async pin(st, p) {
    try {
      const blobs = new Set(p.files.flatMap((f) => [f.before, f.after]).filter(Boolean));
      const lines = [...blobs].map((id, i) => `100644 blob ${id}\tf${i}`);
      if (p.before) lines.push(`040000 tree ${p.before}\tbefore`);
      if (p.after) lines.push(`040000 tree ${p.after}\tafter`);
      if (!lines.length) return;
      const t = await git(st.dir, ['mktree'], { input: `${lines.join('\n')}\n` });
      if (t.code === 0) await git(st.dir, ['update-ref', `refs/rw/${this.session}/${p.n}`, t.out.toString().trim()]);
    } catch { /* kept until the next clean-up at the least */ }
  }

  // The messages, newest first, for the picker.
  list() {
    return [...this.points].reverse().map((p) => {
      const mine = p.files.filter((f) => f.by !== 'other');
      return { n: p.n, at: p.at, text: p.text, cwd: p.cwd, mode: p.mode, files: mine.length, undone: mine.length > 0 && mine.every((f) => f.undone) };
    });
  }

  // What going back to before message n would do, without doing it.
  // put: files that go back; skip: files changed since (left alone);
  // others: files that changed while it worked, not by its edits or commands.
  plan(n) {
    const from = this.points.findIndex((p) => p.n === n);
    if (from < 0) return null;
    const touches = new Map();
    const others = [];
    for (const p of this.points.slice(from)) {
      for (const f of p.files) {
        const abs = join(p.cwd, f.path);
        if (f.by === 'other') { if (!others.some((o) => o.abs === abs)) others.push({ abs, rel: f.path, cwd: p.cwd }); continue; }
        if (f.undone) continue;
        if (!touches.has(abs)) touches.set(abs, []);
        touches.get(abs).push({ p, f });
      }
    }
    const put = [];
    const skip = [];
    const edits = this.points.slice(from).some((p) => p.mode !== 'full');
    for (const [abs, list] of touches) {
      const first = list[0];
      const item = { abs, rel: first.f.path, cwd: first.p.cwd, to: first.f.before, mode: first.f.bmode, before: first.p.before, list };
      let why = null;
      for (let i = 0; i + 1 < list.length && !why; i++) if (list[i].f.after !== list[i + 1].f.before) why = 'changed between your messages';
      if (!why && currentId(abs) !== list.at(-1).f.after) why = 'changed since, by you or another session';
      if (why) skip.push({ ...item, why });
      else put.push(item);
    }
    const byRel = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0); // git's order
    return { put: put.sort(byRel), skip: skip.sort(byRel), others: others.filter((o) => !touches.has(o.abs)).sort(byRel), edits };
  }

  // Puts the files back. Returns the plan it followed, with what failed.
  async restore(n) {
    const plan = this.plan(n);
    if (!plan) return null;
    const failed = [];
    const done = [];
    for (const it of plan.put) {
      try {
        const st = this.store(it.cwd);
        if (it.to === null) {
          rmSync(it.abs, { force: true });
          await this.dropEmptyFolders(st, it);
        } else {
          const r = await git(st.dir, ['cat-file', 'blob', it.to]);
          if (r.code !== 0) throw new Error('its copy is missing from the store');
          mkdirSync(dirname(it.abs), { recursive: true });
          if (it.mode === '120000') {
            try { unlinkSync(it.abs); } catch {}
            symlinkSync(r.out.toString(), it.abs);
          } else {
            try { if (lstatSync(it.abs).isSymbolicLink()) unlinkSync(it.abs); } catch {}
            writeFileSync(it.abs, r.out);
            const m = statSync(it.abs).mode & 0o777;
            if (it.mode === '100755' && !(m & 0o111)) chmodSync(it.abs, m | ((m & 0o444) >> 2));
            if (it.mode === '100644' && m & 0o111) chmodSync(it.abs, m & ~0o111);
          }
        }
        for (const t of it.list) t.f.undone = true;
        done.push(it);
      } catch (e) { failed.push({ ...it, why: e.message }); }
    }
    this.save();
    return { ...plan, put: done, failed };
  }

  // Folders a file the model made was the only thing in go with it, unless
  // they were there before the message.
  async dropEmptyFolders(st, it) {
    let dir = dirname(it.abs);
    while (dir.startsWith(it.cwd + sep) && dir !== it.cwd) {
      const rel = relative(it.cwd, dir).split(sep).join('/');
      if (it.before) { const r = await git(st.dir, ['cat-file', '-e', `${it.before}:${rel}`]); if (r.code === 0) break; }
      try { if (readdirSync(dir).length) break; rmdirSync(dir); } catch { break; }
      dir = dirname(dir);
    }
  }

  // Where message n is in the conversation now (-1: gone, as after /compact).
  // The same message object while this window has it; after /resume, the
  // message of yours with the same text (the same one of several: counted
  // from the newest, which a summary keeps longest).
  messageIndex(messages, n) {
    const p = this.points.find((x) => x.n === n);
    if (!p) return -1;
    if (p.msg) { const i = messages.indexOf(p.msg); if (i > 0) return i; }
    if (!p.key) return -1;
    const same = this.points.filter((x) => x.key === p.key);
    const found = [];
    messages.forEach((m, i) => { if (i > 0 && m.role === 'user' && typeof m.content === 'string' && keyOf(m.content) === p.key) found.push(i); });
    const at = found.length - (same.length - same.indexOf(p));
    return at >= 0 ? found[at] : -1;
  }

  // The conversation went back to before message n: it and the ones after
  // it leave the list (their files stay as they are now).
  dropFrom(n) {
    const from = this.points.findIndex((p) => p.n === n);
    if (from < 0) return;
    const gone = this.points.splice(from);
    this.save();
    for (const p of gone) {
      const st = this.stores.get(p.cwd);
      if (st) git(st.dir, ['update-ref', '-d', `refs/rw/${this.session}/${p.n}`]).catch(() => {});
    }
  }
}

// How long ago, in the picker's words.
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const names = (list, max = 4) => (list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} and ${list.length - max} more`);

// A row of the picker's list. talk: the conversation still holds this message.
export function rowNote(m, now = Date.now()) {
  const files = m.undone ? 'files put back' : m.files ? plural(m.files, 'file') : 'no file changes';
  return `${files} · ${ago(m.at, now)}${m.talk ? '' : ' · summarized since'}`;
}

// The picker's second step: the choices there are, then what they would do.
export function rewindChoices(plan, talk) {
  const files = plan.put.length > 0;
  return [
    ...(files && talk ? [{ id: 'both', label: 'Files and conversation', note: 'both go back to before this message' }] : []),
    ...(files ? [{ id: 'files', label: 'Files only', note: 'the conversation stays as it is' }] : []),
    ...(talk ? [{ id: 'talk', label: 'Conversation only', note: 'the files stay as they are now' }] : []),
    { id: 'cancel', label: 'Never mind', note: '' },
  ];
}
export function planLines(plan, talk) {
  const out = [];
  out.push(plan.put.length ? { text: `Files that go back: ${names(plan.put.map((f) => f.rel))}` } : { text: "No file of the model's to put back from here on.", tone: 'dim' });
  for (const f of plan.skip) out.push({ text: `Left alone: ${f.rel} (${f.why})`, tone: 'warn' });
  if (plan.others.length) out.push({ text: `Not the model's, left alone: ${names(plan.others.map((f) => f.rel))} (changed while it worked, not by its edits or commands)`, tone: 'dim' });
  if (plan.edits) out.push({ text: 'In this folder only its Edit and Write changes were kept; what its commands changed is not followed.', tone: 'dim' });
  if (!talk) out.push({ text: 'The conversation was summarized after this message, so only the files can go back.', tone: 'dim' });
  return out;
}

// Clean-up at start: conversations not used for KEEP_DAYS lose their copies;
// a folder's store goes once no conversation uses it. Returns what went.
export async function pruneRewind(home, { days = KEEP_DAYS, now = Date.now() } = {}) {
  const root = join(home, 'rewind');
  const sessions = join(root, 'sessions');
  const gone = new Set();
  try {
    for (const f of readdirSync(sessions)) {
      if (!f.endsWith('.json')) continue;
      if (now - statSync(join(sessions, f)).mtimeMs > days * 86_400_000) { rmSync(join(sessions, f), { force: true }); gone.add(f.slice(0, -5)); }
    }
  } catch { /* nothing kept yet */ }
  const live = new Set();
  try { for (const f of readdirSync(sessions)) if (f.endsWith('.json')) live.add(f.slice(0, -5)); } catch {}
  let stores = [];
  try { stores = readdirSync(join(root, 'stores')); } catch {}
  for (const s of stores) {
    const base = join(root, 'stores', s);
    const dir = join(base, 'store.git');
    // Indexes of conversations that are gone (an open one keeps its own).
    let indexes = [];
    try { indexes = readdirSync(join(base, 'indexes')); } catch {}
    for (const i of indexes) if (!live.has(i) && now - statSync(join(base, 'indexes', i)).mtimeMs > days * 86_400_000) rmSync(join(base, 'indexes', i), { force: true });
    const refs = await git(dir, ['for-each-ref', '--format=%(refname)', 'refs/rw/']);
    if (refs.code !== 0) continue;
    const names = refs.out.toString().split('\n').filter(Boolean);
    const drop = names.filter((r) => !live.has(r.split('/')[2]));
    if (drop.length) await git(dir, ['update-ref', '--stdin'], { input: `${drop.map((r) => `delete ${r}`).join('\n')}\n` });
    let left = [];
    try { left = readdirSync(join(base, 'indexes')); } catch {}
    // A store made in the last day may be a window's first copy, still going.
    let young = true;
    try { young = now - statSync(join(dir, 'HEAD')).mtimeMs < 86_400_000; } catch {}
    if (names.length === drop.length && !left.length && !young) { rmSync(base, { recursive: true, force: true }); continue; }
    // Only what no ref holds and is older than two hours: another window may
    // be halfway through a copy.
    if (drop.length) await git(dir, ['prune', '--expire=2.hours.ago']);
  }
  return [...gone];
}
