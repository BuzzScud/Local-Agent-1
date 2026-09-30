// The memory's review at night: `coding memory-review`. While the Mac is
// idle it reads the day's conversations again, saves what the quick saves
// after each task missed, and tidies both memories. It is careful about
// when it runs:
//   - only between 1 and 6 in the morning, on power, after 30 minutes with
//     no key or mouse (it never wakes the Mac: a sleeping Mac runs nothing);
//   - not while an Agentic Coder window is open or a test run has the model;
//   - it stops the moment an Agentic Coder window starts.
// --now skips the clock, the power and the idle check (not the others).
// It is started by the Mac's own scheduler (launchd), once an hour in those
// hours; `coding memory-review --install` sets that up and --uninstall
// removes it. Nothing is installed unless you run that.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { HOME, LOG_DIR, MODELS, DEFAULT_MODEL, ModelServer, scanServers, liveUsers, chooseContext, Embedder, embedderReady, modelById } from '../../../models/index.mjs';
import { saveLessons, tidyDue } from '../agent/lessons.mjs';
import { memoryDirs } from '../agent/facts.mjs';
import { loadSettings } from './store.mjs';
import { memoryOn, jobsDir, saveModeOf, keepOrSave } from './autosave.mjs';

export const HOURS = [1, 2, 3, 4, 5];
export const IDLE_MINS = 30;
const LABEL = 'com.agentic-coder.memory-review';
const OLD_LABEL = 'com.bonsai-code.memory-review'; // the job's name before the rename: still cleaned up (leave this one as it is)
const plist = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const oldPlist = () => join(homedir(), 'Library', 'LaunchAgents', `${OLD_LABEL}.plist`);
const stateFile = () => join((process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? HOME, 'memory-review.json');
const readState = () => { try { return JSON.parse(readFileSync(stateFile(), 'utf8')); } catch { return { sessions: {} }; } };
const say = (text) => { try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(join(LOG_DIR, 'memory-review.log'), `${new Date().toISOString()} ${text}\n`); } catch { /* no log, no harm */ } };

// What the Mac says about itself right now.
export function look() {
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 }); return `${r.stdout ?? ''}`; };
  const idle = /"HIDIdleTime"\s*=\s*(\d+)/.exec(run('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4']));
  const servers = scanServers();
  return {
    hour: new Date().getHours(),
    onPower: /AC Power/.test(run('/usr/bin/pmset', ['-g', 'batt'])),
    idleMins: idle ? Number(idle[1]) / 1e9 / 60 : 0,
    windows: servers.reduce((n, s) => n + (s.users?.length ?? (s.owner ? 1 : 0)), 0),
    bench: /\b(evals\/bench|run-night|evals\/tools\/(soak|speed|reread))/.test(run('/bin/ps', ['-axo', 'command='])),
  };
}

// Why not now, or null when it may run.
export function whyNot(s, { now = false } = {}) {
  if (s.windows) return 'an Agentic Coder window is open';
  if (s.bench) return 'a test run has the model';
  if (now) return null;
  if (!HOURS.includes(s.hour)) return `it is not between ${HOURS[0]} and ${HOURS.at(-1) + 1} in the morning`;
  if (!s.onPower) return 'the Mac runs on its battery';
  if (s.idleMins < IDLE_MINS) return `the Mac was used ${Math.round(s.idleMins)} minutes ago`;
  return null;
}

// The conversations of the last day that were not read yet (or changed since).
export function sessionsToRead({ sessionsDir = join((process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? HOME, 'sessions'), since = Date.now() - 24 * 3600_000, read = readState().sessions } = {}) {
  const out = [];
  if (!existsSync(sessionsDir)) return out;
  for (const folder of readdirSync(sessionsDir)) {
    const dir = join(sessionsDir, folder);
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const p = join(dir, f);
      if (statSync(p).mtimeMs < since) continue;
      let s;
      try { s = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      if (!s.cwd || !existsSync(s.cwd) || read[`${folder}/${s.id}`] === s.updated) continue;
      if (!(s.messages ?? []).some((m) => m.role === 'user')) continue;
      out.push({ key: `${folder}/${s.id}`, cwd: s.cwd, updated: s.updated, title: s.title ?? '', messages: s.messages, lessons: (s.lessons ?? []).map(({ saved: _s, ...l }) => l) });
    }
  }
  return out.sort((a, b) => String(a.updated).localeCompare(String(b.updated)));
}

// The review. url: a server that is already there (tests); otherwise the
// model is started, and stopped again when the review is done.
export async function review({ now = false, url = null, model = null, state = look(), stillAlone = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const no = whyNot(state, { now });
  if (no) { say(`not now: ${no}`); return { ran: false, why: no }; }
  const sessions = sessionsToRead().filter((s) => memoryOn(loadSettings(s.cwd)));
  if (!sessions.length) {
    const tidied = [...new Set(Object.keys(readState().projects ?? {}))].flatMap((cwd) => (existsSync(cwd) ? tidyDue(memoryDirs(cwd), today) : []));
    say(`nothing new to read${tidied.length ? `; tidied ${tidied.length} memory folder${tidied.length === 1 ? '' : 's'}` : ''}`);
    return { ran: true, read: 0, added: 0, tidied: tidied.length };
  }
  model ??= modelById(loadSettings().model) ?? MODELS[DEFAULT_MODEL];
  let server = null;
  let slot;
  if (!url) {
    server = new ModelServer(model);
    const st = await server.start({ ctx: chooseContext(model, {}).ctx, share: false });
    url = server.url;
    if (st.slots > 1) slot = 1;
  }
  // A window that opened since: it gets the model, the review stops.
  const alone = stillAlone ?? (() => !server || liveUsers(server.port).filter((p) => p !== process.pid).length === 0) ;
  const embedder = embedderReady() ? new Embedder() : null;
  const st = readState();
  st.projects ??= {};
  const out = { ran: true, read: 0, added: 0, replaced: 0, retired: 0, stopped: false, lines: [] };
  try {
    for (const s of sessions) {
      if (!alone()) { out.stopped = true; say('an Agentic Coder window opened; stopping'); break; }
      // Asking first (the default): what it would save is kept and asked
      // about at the next start in that folder, as the review at quit does.
      if (saveModeOf(loadSettings(s.cwd)) === 'ask') {
        mkdirSync(jobsDir(), { recursive: true });
        const k = await keepOrSave({ file: join(jobsDir(), `review-${Date.now()}-${out.read}.json`), job: { cwd: s.cwd, review: true, ask: true, slot, lessons: s.lessons, messages: s.messages }, url, model, embedder });
        out.read++; out.kept = (out.kept ?? 0) + (k.kept ?? 0);
        st.sessions[s.key] = s.updated;
        st.projects[s.cwd] = today;
        say(`read "${s.title.slice(0, 50)}" in ${s.cwd}: ${k.kept ?? 0} kept to ask about, ${k.refused.length} refused, ${(k.secs ?? 0).toFixed(0)} s`);
        continue;
      }
      const r = await saveLessons({ url, model, slot, cwd: s.cwd, lessons: s.lessons, messages: s.messages, today, embedder, review: true, why: 'night review' });
      out.read++; out.added += r.added.length; out.replaced += r.replaced.length; out.retired += r.retired.length;
      st.sessions[s.key] = s.updated;
      st.projects[s.cwd] = today;
      if (r.added.length || r.replaced.length || r.retired.length) {
        mkdirSync(jobsDir(), { recursive: true });
        writeFileSync(join(jobsDir(), `review-${Date.now()}-${out.read}.done`), JSON.stringify({ at: new Date().toISOString(), cwd: s.cwd, line: `Memory: reviewed last night, ${r.added.length} saved${r.replaced.length ? `, ${r.replaced.length} replaced` : ''}${r.retired.length ? `, ${r.retired.length} retired` : ''}${r.added[0] ? ` · "${r.added[0].text.slice(0, 70)}"` : ''} · /memory shows it` }));
      }
      say(`read "${s.title.slice(0, 50)}" in ${s.cwd}: ${r.added.length} saved, ${r.refused.length} refused, ${r.secs.toFixed(0)} s`);
    }
  } finally {
    mkdirSync(join(stateFile(), '..'), { recursive: true });
    // Only the last 400 conversations are kept in mind.
    st.sessions = Object.fromEntries(Object.entries(st.sessions).slice(-400));
    writeFileSync(stateFile(), JSON.stringify(st, null, 1));
    await embedder?.stop({ keep: false }).catch(() => {});
    await server?.stop().catch(() => {});
  }
  return out;
}

// The scheduler's file: once an hour in the review's hours. It runs the
// installed `coding` app and does nothing when the review says "not now".
export function plistText(bin) {
  const times = HOURS.map((h) => `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>10</integer></dict>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${LABEL}</string>\n  <key>ProgramArguments</key>\n  <array><string>${bin}</string><string>memory-review</string></array>\n  <key>StartCalendarInterval</key>\n  <array>\n${times}\n  </array>\n  <key>EnvironmentVariables</key>\n  <dict><key>AGENTIC_NO_UPDATE</key><string>1</string></dict>\n  <key>ProcessType</key><string>Background</string>\n  <key>LowPriorityIO</key><true/>\n  <key>StandardOutPath</key><string>/dev/null</string>\n  <key>StandardErrorPath</key><string>/dev/null</string>\n</dict>\n</plist>\n`;
}

// A job left under the old name would run a second time (and points at an app that is gone).
function removeOld() {
  spawnSync('/bin/launchctl', ['bootout', `gui/${String(process.getuid())}/${OLD_LABEL}`], { encoding: 'utf8' });
  const was = existsSync(oldPlist());
  rmSync(oldPlist(), { force: true });
  return was;
}
export function install({ bin = join(homedir(), '.agentic-coder', 'app', 'agentic-coder') } = {}) {
  if (!existsSync(bin)) throw new Error(`the Agentic Coder app is not installed at ${bin} (bun run install-cli)`);
  removeOld();
  mkdirSync(join(plist(), '..'), { recursive: true });
  writeFileSync(plist(), plistText(bin));
  const uid = String(process.getuid());
  spawnSync('/bin/launchctl', ['bootout', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
  const r = spawnSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plist()], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the scheduler did not take it: ${(r.stderr || r.stdout).trim()}`);
  return plist();
}
export function uninstall() {
  spawnSync('/bin/launchctl', ['bootout', `gui/${String(process.getuid())}/${LABEL}`], { encoding: 'utf8' });
  const was = existsSync(plist());
  rmSync(plist(), { force: true });
  return removeOld() || was;
}
export const installed = () => existsSync(plist());
