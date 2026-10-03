// The Door check: background sessions and the door between Macs (terminal/src/app/sessions.mjs,
// door.mjs), measured on this Mac alone, with no model. It began as the audit of 3 Oct 2026
// ("was the remote control feature correctly implemented?"), whose three probes found a stalled
// window never let go, the door holding everything drawn for it, and the wrong-key limit skipped.
//
// A throwaway home; real session keepers running small stand-in programs; a real door on
// 127.0.0.1 with a test key. What it checks, and the rule each must meet (written before the run):
//   paste      a paste of 400,000 letters through a session arrives whole
//   list       the door's list needs the key, and shows a session's name, folder, age and windows only
//   keys       of 40 wrong keys sent together on connections opened first, 5 at most are looked at
//   stalled    a window that stops checking in is let go within 45 s; one from an older app is kept
//   memory     after it is let go, the door holds no more for it (under 5 MB more in the next 15 s)
//   flood      a window 16 MB behind on a screen that floods is let go within 10 s
//   back       a window whose link is cut is back by itself within 6 s, and what is typed then arrives
//   folder     a new session starts in the folder named; one that is not there is refused; "the last
//              conversation" starts where that was, carrying it on
//   window     a session another Mac opens gets one window on this Mac, at its size, and no second
//              one when the same window comes back
// It writes its results page into the DOCS folder (tests/) and its line in the test record.
//   node models/evals/tools/door-check.mjs [--no-record]
//   node models/evals/tools/door-check.mjs --rebuild <a run's folder>
// The Arena starts it with node; the door's own code needs Bun's pretend terminal for a session
// it starts, so it runs itself again under Bun.
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, realpathSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir, loadavg, homedir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const CLI = join(root, 'terminal', 'src', 'cli.jsx');
const args = process.argv.slice(2);
const BUN = (() => { const r = spawnSync('/usr/bin/which', ['bun'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : join(homedir(), '.bun', 'bin', 'bun'); })();
if (!globalThis.Bun) {
  const child = spawn(BUN, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit' });
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { try { child.kill(s); } catch {} });
  const code = await new Promise((r) => { child.on('exit', (c) => r(c ?? 1)); child.on('error', () => { console.error('the Door check needs Bun (bun.sh) on this Mac'); r(2); }); });
  process.exit(code);
}

const { recordTest, codeLabel } = await import('../../index.mjs');
const { openDoor, startHost, viewSession, SESSION_FRAMES: F, sessionFrame: frame, sessionFrameReader: frameReader, sessionJson: json } = await import('../../../terminal/index.mjs');
const { DOCS_DIR, docsPath } = await import('../../../docs/tools/to-docs.mjs');
const { doorPage } = await import('./door-page.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; }
const mb = () => process.memoryUsage().rss / 1e6;
const rawOf = (dir) => (dir.startsWith(`${root}/`) ? relative(root, dir) : /\/(models\/evals\/results\/.+)$/.exec(dir)?.[1] ?? dir.replace(homedir(), '~'));
const pad = (n) => String(n).padStart(2, '0');

function previous(out, summary) {
  let best = null;
  const beside = dirname(out);
  for (const d of readdirSync(beside)) {
    const dir = join(beside, d);
    if (!d.startsWith('door-check-') || dir === out || !existsSync(join(dir, 'summary.json'))) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
      if (s.stopped || !(s.finished < summary.finished)) continue;
      if (!best || s.finished > best.s.finished) best = { s, rows: JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) };
    } catch { /* a folder being written: skipped */ }
  }
  return best;
}
function writePage(out, rows, summary, prev) {
  mkdirSync(dirname(docsPath(summary.page)), { recursive: true });
  writeFileSync(docsPath(summary.page), doorPage({ summary, rows, prev, raw: [rawOf(out)] }));
}
if (args.includes('--rebuild')) {
  const dir = args[args.indexOf('--rebuild') + 1];
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error('that run has no results page'); process.exit(1); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, summary));
  console.log(`results page: ${summary.page}`);
  process.exit(0);
}

const t0 = Date.now();
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = join(root, 'models', 'evals', 'results', `door-check-${stamp}`);
mkdirSync(out, { recursive: true });

// The throwaway home, set once the models part has read the real one (the test record is kept
// there); the sessions and the door read it at each use, and so does every keeper started here.
const base = mkdtempSync(join(tmpdir(), 'agentic-door-check-'));
const home = join(base, 'home');
mkdirSync(home, { recursive: true });
const realHome = process.env.AGENTIC_HOME; // put back before the run is recorded: the record is found by it
process.env.AGENTIC_HOME = home;
process.env.AGENTIC_SESSIONS = 'on';
const KEY = 'acd-door-check';

const rows = [];
const checks = {}; // what one check measured for the next
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const hosts = [];
const record = (name) => { try { return JSON.parse(readFileSync(join(home, 'background', `${name}.json`), 'utf8')); } catch { return null; } };
// A session whose program is `cmd`, in a keeper of its own (the app's, started as the app starts it).
async function host(name, cmd, { cols = 100, rows: r = 30 } = {}) {
  const spec = { name, folder: base, cmd, cols, rows: r };
  const p = spawn(BUN, [CLI, 'session-host'], { cwd: base, stdio: 'ignore', env: { ...process.env, AGENTIC_HOST_SPEC: JSON.stringify(spec) } });
  hosts.push(p);
  if (!(await until(() => { const rec = record(name); return rec?.socket && existsSync(rec.socket); }, 10_000))) throw new Error(`the keeper of ${name} did not start`);
  return p;
}
// A window of the check's own, through the door: what it was sent, and when it was let go.
function windowTo(port, hello) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const w = { sock: s, frames: [], out: '', closedAt: 0, bytes: 0 };
    const read = frameReader((kind, body) => { if (kind === F.OUTPUT) { w.out += Buffer.from(body).toString('latin1').slice(0, 4000); w.out = w.out.slice(-8000); } else w.frames.push([kind, json(body)]); });
    s.on('data', (c) => { w.bytes += c.length; try { read(c); } catch {} });
    s.on('close', () => { w.closedAt = Date.now(); });
    s.on('error', () => {});
    s.on('connect', () => { s.write(frame(F.HELLO, { key: KEY, cols: 100, rows: 30, ...hello })); resolve(w); });
    setTimeout(() => reject(new Error('the door did not take the connection')), 5000);
  });
}
async function check(id, name, fn) {
  if (stopping) return;
  const at = Date.now();
  let ok = false;
  let detail = '';
  let more = {};
  try { ({ ok, detail, ...more } = await fn()); } catch (e) { detail = `it stopped: ${e.message}`; }
  const secs = (Date.now() - at) / 1000;
  rows.push({ id, name, ok: Boolean(ok), detail, secs, ...more });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${detail} · ${secs.toFixed(1)} s`);
}

const said = [];
const windows = [];
const links = new Set();
const doorOpts = {
  host: '127.0.0.1', key: KEY, mac: 'server-1', peerName: () => 'mac-mini', log: (t) => said.push(t),
  show: (name, size) => windows.push({ name, ...size }),
  // A session the door starts: the app's keeper, running the stand-in below in the app's place.
  start: (o) => startHost({ ...o, self: [BUN, CLI] }),
};
const door = await openDoor({ ...doorOpts, port: 0 });
door.on('connection', (s) => { links.add(s); s.on('close', () => links.delete(s)); });
const port = door.address().port;

try {
  await check('paste', 'A paste of 400,000 letters arrives whole', async () => {
    const file = join(base, 'paste.bin');
    await host('paste-1', ['/bin/sh', '-c', `stty raw -echo; exec cat > '${file}'`]);
    const w = await windowTo(port, { op: 'attach', name: 'paste-1', v: 2 });
    await sleep(500);
    const size = 400_000;
    const body = Buffer.alloc(size, 'a');
    for (let i = 0; i < size; i += 1024) w.sock.write(frame(F.INPUT, body.subarray(i, Math.min(size, i + 1024))));
    let got = 0;
    await until(() => { got = existsSync(file) ? statSync(file).size : 0; return got >= size; }, 10_000);
    w.sock.destroy();
    return { ok: got === size, detail: `${got.toLocaleString('en-US')} of ${size.toLocaleString('en-US')} letters arrived`, got };
  });

  await check('list', 'The list needs the key and shows little', async () => {
    const ask = (key) => new Promise((res) => {
      const s = net.connect({ host: '127.0.0.1', port });
      const read = frameReader((kind, body) => { s.destroy(); res({ kind, body: json(body) }); });
      s.on('data', (c) => read(c));
      s.on('error', () => res({ kind: 0, body: {} }));
      s.on('connect', () => s.write(frame(F.HELLO, { key, op: 'list', v: 2 })));
    });
    const wrong = await ask('acd-not-it');
    const right = await ask(KEY);
    const fields = [...new Set((right.body.sessions ?? []).flatMap((x) => Object.keys(x)))].sort();
    const ok = wrong.kind === F.NOTE && wrong.body.text === 'wrong key' && right.kind === F.LIST && fields.join() === 'folder,name,started,viewers' && right.body.sessions.length === 1;
    return { ok, detail: `a wrong key: “${wrong.body.text ?? 'no answer'}”; the right one: ${right.body.sessions?.length ?? 0} session, showing ${fields.join(', ') || 'nothing'}` };
  });

  await check('stalled', 'A window that stops checking in is let go', async () => {
    // A screen that keeps drawing, 100 KB a second: slow enough that only its silence can end the
    // window in this check (16 MB behind, the flood check's rule, would take over two minutes).
    await host('busy-1', [BUN, '-e', "const b = 'x'.repeat(3300) + '\\n'; setInterval(() => process.stdout.write(b), 33);"]);
    await host('still-1', ['/bin/sh', '-c', 'sleep 300']);
    const a = await windowTo(port, { op: 'attach', name: 'busy-1', v: 2, cols: 60, rows: 20 });
    const old = await windowTo(port, { op: 'attach', name: 'still-1' });
    await until(() => record('busy-1')?.viewers === 1, 5000);
    const shared = record('busy-1')?.shared;
    await sleep(1000);
    // From here it takes nothing and says nothing: a Mac asleep, a link that stalled.
    a.sock.pause();
    const stalledAt = Date.now();
    const from = said.length;
    const gone = await until(() => record('busy-1')?.viewers === 0, 50_000);
    // Why it was let go, in the door's own words: for going quiet, not for a backlog.
    const why = said.slice(from).find((t) => t.includes('let go')) ?? '';
    const letGo = (Date.now() - stalledAt) / 1000;
    const kept = !old.closedAt && record('still-1')?.viewers === 1;
    old.sock.destroy();
    a.sock.destroy();
    return { ok: gone && letGo <= 45 && why.includes('went quiet') && kept && shared?.mac === 'server-1', detail: gone ? `let go after ${letGo.toFixed(0)} s, ${why.includes('went quiet') ? 'for going quiet' : `but not for going quiet (${why || 'no reason logged'})`}; an older app’s window (no check-in) was ${kept ? 'kept' : 'dropped too'}` : 'still counted after 50 s', letGo: gone ? letGo : null };
  });

  await check('memory', 'After it is let go, the door holds no more for it', async () => {
    // A busy screen (600 KB a second) and a door that lets a quiet window go after 3 s, so the
    // 15 s after it tell the two apart: nothing more held, or 9 MB more.
    const d4 = await openDoor({ ...doorOpts, port: 0, staleMs: 3000 });
    try {
      await host('busy-2', [BUN, '-e', "const b = 'x'.repeat(20000) + '\\n'; setInterval(() => process.stdout.write(b), 33);"]);
      const w = await windowTo(d4.address().port, { op: 'attach', name: 'busy-2', v: 2 });
      await until(() => record('busy-2')?.viewers === 1, 5000);
      await sleep(500);
      w.sock.pause();
      const m0 = mb();
      const gone = await until(() => record('busy-2')?.viewers === 0, 8000);
      const m1 = mb();
      await sleep(15_000);
      const after = mb() - m1;
      w.sock.destroy();
      return { ok: gone && after < 5, detail: `${gone ? '' : 'it was never let go; '}${Math.max(0, Math.round(m1 - m0))} MB held while stalled (a screen drawing 600 KB a second); ${Math.max(0, Math.round(after))} MB more in the 15 s after`, held: m1 - m0, after };
    } finally { d4.close(); }
  });

  await check('flood', 'A window 16 MB behind on a flood is let go', async () => {
    await host('flood-1', ['/bin/sh', '-c', `yes ${'x'.repeat(200)}`]);
    const w = await windowTo(port, { op: 'attach', name: 'flood-1', v: 2 });
    const beat = setInterval(() => { try { w.sock.write(frame(F.PING)); } catch {} }, 2000); // it checks in: only its backlog can end it
    await sleep(300);
    w.sock.pause();
    const at = Date.now();
    const m0 = mb();
    const from = said.length;
    let peak = 0;
    const gone = await until(() => { peak = Math.max(peak, mb() - m0); return record('flood-1')?.viewers === 0; }, 20_000);
    peak = Math.max(peak, mb() - m0);
    clearInterval(beat);
    const secs = (Date.now() - at) / 1000;
    w.sock.destroy();
    for (const h of hosts.splice(0)) { try { h.kill('SIGTERM'); } catch {} }
    const why = said.slice(from).find((t) => t.includes('let go')) ?? '';
    return { ok: gone && secs <= 10 && why.includes('16 MB behind'), detail: gone ? `let go after ${secs.toFixed(1)} s, ${why.includes('16 MB behind') ? 'for being 16 MB behind' : `but not for its backlog (${why || 'no reason logged'})`}, with ${Math.round(peak)} MB held at most` : 'still open after 20 s', floodSecs: gone ? secs : null, floodPeak: peak };
  });

  await check('keys', 'Of 40 wrong keys sent together, 5 at most are looked at', async () => {
    // Its own door: the address is refused for a minute afterwards.
    const seen = [];
    const d2 = await openDoor({ ...doorOpts, port: 0, log: (t) => seen.push(t) });
    try {
      const p2 = d2.address().port;
      const socks = [];
      for (let i = 0; i < 40; i++) { const s = net.connect({ host: '127.0.0.1', port: p2 }); s.on('error', () => {}); await new Promise((r) => s.on('connect', r)); socks.push(s); }
      for (const [i, s] of socks.entries()) s.write(frame(F.HELLO, { key: `acd-guess-${i}`, op: 'list' }));
      await sleep(1500);
      const looked = seen.filter((t) => t.startsWith('wrong key')).length;
      for (const s of socks) s.destroy();
      const late = net.connect({ host: '127.0.0.1', port: p2 });
      const refused = await new Promise((res) => { late.on('close', () => res(true)); late.on('error', () => res(true)); setTimeout(() => res(false), 1500); });
      late.destroy();
      return { ok: looked <= 5 && refused, detail: `${looked} of 40 looked at; a new connection right after was ${refused ? 'refused' : 'let in'}`, looked };
    } finally { d2.close(); }
  });

  await check('back', 'A cut link comes back by itself', async () => {
    await host('echo-1', ['/bin/sh', '-c', 'stty raw -echo; exec cat']);
    const input = new PassThrough();
    const output = new PassThrough();
    output.columns = 100; output.rows = 30;
    let shown = '';
    output.on('data', (c) => { shown = (shown + c).slice(-20_000); });
    const view = viewSession({
      name: 'echo-1', where: 'server-1', input, output,
      connect: () => net.connect({ host: '127.0.0.1', port }),
      hello: { key: KEY, v: 2, op: 'attach', name: 'echo-1' },
      again: (n) => ({ key: KEY, v: 2, op: 'attach', name: n, again: true }),
    });
    if (!(await until(() => record('echo-1')?.viewers === 1, 8000))) return { ok: false, detail: 'the window never opened the session' };
    input.write('typed first\n');
    if (!(await until(() => shown.includes('typed first'), 5000))) return { ok: false, detail: 'what was typed did not come back before the cut' };
    const before = windows.filter((x) => x.name === 'echo-1').length;
    for (const s of links) s.destroy();
    const cut = Date.now();
    await until(() => record('echo-1')?.viewers === 0, 3000);
    const back = await until(() => record('echo-1')?.viewers === 1, 15_000);
    const secs = (Date.now() - cut) / 1000;
    const saidSo = shown.includes('Connection to server-1 lost, reconnecting');
    input.write('typed after\n');
    const arrived = await until(() => shown.includes('typed after'), 5000);
    checks.windows = { before, after: windows.filter((x) => x.name === 'echo-1').length, size: windows.find((x) => x.name === 'echo-1') };
    input.write('\x02'); // ctrl+b: the window leaves
    await Promise.race([view, sleep(3000)]);
    return { ok: back && secs <= 6 && saidSo && arrived, detail: back ? `back ${secs.toFixed(1)} s after the cut; it ${saidSo ? 'said' : 'did not say'} “reconnecting” meanwhile; typing then ${arrived ? 'arrived' : 'did not arrive'}` : 'not back after 15 s', backSecs: back ? secs : null };
  });

  await check('folder', 'A new session starts where it is told to', async () => {
    // The app's stand-in: it says where it was started and with what, then waits.
    const standIn = join(base, 'stand-in-app.sh');
    writeFileSync(standIn, '#!/bin/sh\nwhile :; do echo "AT $(pwd)"; echo "ARGS $* ."; sleep 0.3; done\n', { mode: 0o755 });
    const project = join(base, 'my project');
    mkdirSync(project);
    // A conversation had in the repo's folder, the latest: "the last conversation there".
    mkdirSync(join(home, 'sessions', 'repo'), { recursive: true });
    const conv = join(home, 'sessions', 'repo', 'a.json');
    writeFileSync(conv, JSON.stringify({ id: 'a', cwd: root, title: 'the door', updated: new Date().toISOString(), messages: [] }));
    utimesSync(conv, new Date(), new Date());
    const d3 = await openDoor({ ...doorOpts, port: 0, startEnv: { ...process.env, AGENTIC_LAUNCHER: standIn } });
    try {
      const p3 = d3.address().port;
      const named = await windowTo(p3, { op: 'new', folder: project, v: 2 });
      const okNamed = await until(() => named.out.includes('ARGS'), 12_000) && named.out.includes(`AT ${realpathSync(project)}`) && named.out.includes(`ARGS --folder ${project} .`);
      const missing = await windowTo(p3, { op: 'new', folder: join(base, 'not-here'), v: 2 });
      await until(() => missing.closedAt, 5000);
      const refusal = (missing.frames.find(([k]) => k === F.NOTE)?.[1].text ?? '').replace(base, '<the check’s folder>');
      const last = await windowTo(p3, { op: 'new', last: true, v: 2 });
      const okLast = await until(() => last.out.includes('ARGS'), 12_000) && last.out.includes(`AT ${realpathSync(root)}`) && last.out.includes('ARGS -c .');
      // The two sessions the door started, by the names it gave them: a window was asked for each.
      const started = [named, last].map((w) => w.frames.find(([k]) => k === F.NAMED)?.[1].name);
      checks.newWindows = windows.filter((x) => started.includes(x.name)).length;
      for (const w of [named, missing, last]) w.sock.destroy();
      return { ok: okNamed && /^No folder /.test(refusal) && okLast, detail: `a folder named: ${okNamed ? 'started there' : 'not started there'}; one not there: ${/^No folder /.test(refusal) ? 'refused (“No folder … on server-1.”)' : refusal ? `“${refusal}”` : 'no refusal'}; the last conversation: ${okLast ? 'carried on in its folder' : 'not carried on'}` };
    } finally { d3.close(); }
  });

  await check('window', 'One window on this Mac for a session opened from another', async () => {
    const w = checks.windows;
    if (!w) return { ok: false, detail: 'not measured: the check before it stopped' };
    const sized = w.size?.cols === 100 && w.size?.rows === 30;
    return { ok: w.before === 1 && w.after === 1 && sized && checks.newWindows === 2, detail: `opened with no window here: ${w.before} asked for, at ${w.size?.cols ?? '?'}×${w.size?.rows ?? '?'}; after it came back: ${w.after}; two sessions started from the other Mac: ${checks.newWindows ?? 0} (Terminal’s own window is not opened by a check)` };
  });
} finally {
  door.close();
  // Every keeper started here is stopped, and the throwaway home goes.
  for (const f of (() => { try { return readdirSync(join(home, 'background')).filter((x) => x.endsWith('.json')); } catch { return []; } })()) { try { process.kill(JSON.parse(readFileSync(join(home, 'background', f), 'utf8')).pid, 'SIGTERM'); } catch {} }
  for (const h of hosts) { try { h.kill('SIGTERM'); } catch {} }
  await sleep(500);
  for (const h of hosts) { try { h.kill('SIGKILL'); } catch {} }
  try { rmSync(base, { recursive: true, force: true }); } catch {}
  // The test record is the real one again (it was written into the throwaway home once, 3 Oct 2026).
  if (realHome === undefined) delete process.env.AGENTIC_HOME; else process.env.AGENTIC_HOME = realHome;
}

const OF = 9;
const full = !stopping && rows.length === OF;
const pass = full && rows.every((r) => r.ok);
const code = codeLabel();
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const by = Object.fromEntries(rows.map((r) => [r.id, r]));
const summary = {
  name: 'this Mac', code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: OF, passed: rows.filter((r) => r.ok).length, pass, stopped: !full,
  letGo: by.stalled?.letGo ?? null, held: by.memory?.held ?? null, after: by.memory?.after ?? null, looked: by.keys?.looked ?? null, backSecs: by.back?.backSecs ?? null, floodSecs: by.flood?.floodSecs ?? null,
  load: Math.round(loadavg()[0] * 10) / 10,
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-door-check-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'Door check', passed: summary.passed, total: OF, secs, part: !full, bar: 'all 9 checks: a stalled window let go within 45 s, 5 wrong keys looked at, back within 6 s',
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `A stalled window was let go after ${summary.letGo?.toFixed(0) ?? '?'} s; ${summary.looked ?? '?'} of 40 wrong keys looked at; back ${summary.backSecs?.toFixed(1) ?? '?'} s after a cut link.${rows.filter((r) => !r.ok).map((r) => ` Failed: ${r.name} (${r.detail}).`).join('')}`,
  raw: rawOf(out), page: summary.page,
});
console.log(`Door check: ${summary.passed} of ${OF} · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(pass ? 0 : 1);
