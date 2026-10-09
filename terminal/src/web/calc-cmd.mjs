// `coding calc`: the calculator link (calc-link.mjs) from a terminal, and where it runs.
//   coding calc [status]       what it is doing, where it runs, today's drops and the reports filed
//   coding calc on             run it as its own background service: starts with this Mac, restarts if it stops
//   coding calc off            the background service off: the link runs inside Agentic Coder Web again
//   coding calc run            the service itself (what the LaunchAgent runs; Ctrl+C stops it)
//   coding calc reconnect      drop the connection and open it again now
//   coding calc signin         sign in again now (after a new password, say)
// /calc in a window and the hub's Calculator tab do the same (calc-hub.mjs).
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadSettings, saveSettings } from './config.mjs';
import { linkHost, askLink, linkWhere, savedState } from './calc-link.mjs';

export const CALC_LABEL = 'com.agentic-coder.calc-link';
// AGENTIC_LAUNCH_DIR: another folder for the LaunchAgent's file (the tests'; never the real one there).
const launchDir = () => process.env.AGENTIC_LAUNCH_DIR ?? join(homedir(), 'Library', 'LaunchAgents');
const plistPath = () => join(launchDir(), `${CALC_LABEL}.plist`);
export const calcLog = () => join(process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder'), 'logs', 'calc-link.log');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function calcPlist({ program, webHome = process.env.AGENTIC_WEB_HOME }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${CALC_LABEL}</string>
  <key>ProgramArguments</key><array>${[...program, 'calc', 'run'].map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>${webHome ? `
  <key>EnvironmentVariables</key><dict><key>AGENTIC_WEB_HOME</key><string>${xml(webHome)}</string></dict>` : ''}
  <key>StandardOutPath</key><string>${xml(calcLog())}</string>
  <key>StandardErrorPath</key><string>${xml(calcLog())}</string>
</dict></plist>
`;
}

// What the LaunchAgent runs: this same Agentic Coder (a script run by Bun: that script; macOS keeps a login
// item out of Desktop, Documents and Downloads, so from there the installed app), else the installed app.
export function programNow({ argv = process.argv, execPath = process.execPath, home = homedir() } = {}) {
  const app = join(home, '.agentic-coder', 'app', 'agentic-coder');
  const script = argv[1];
  if (script && /\.(m?js|jsx)$/.test(script) && !/\/(Desktop|Documents|Downloads)\//.test(script)) return [execPath, script];
  return existsSync(app) ? [app] : null;
}

// The background service on this Mac: launchctl, put in a test's hands.
export const launchctl = (args) => spawnSync('launchctl', args, { encoding: 'utf8' });
export function serviceState({ run = launchctl } = {}) {
  if (process.platform !== 'darwin') return { mac: false, installed: false, loaded: false };
  return { mac: true, installed: existsSync(plistPath()), loaded: run(['print', `gui/${process.getuid()}/${CALC_LABEL}`]).status === 0 };
}

// Where the link runs: 'service' (the LaunchAgent on, the setting saved first so the service finds it its
// turn) or 'web' (the setting first, then the LaunchAgent off: the web's link starts within 5 s).
export function setWhere(where, { run = launchctl, program = programNow() } = {}) {
  if (where !== 'service' && where !== 'web') return { ok: false, error: 'the calculator link runs inside the web or as its own service' };
  if (process.platform !== 'darwin' && where === 'service') return { ok: false, error: 'the background service is for a Mac; elsewhere the link runs inside the web' };
  const calc = loadSettings().calc;
  if (where === 'service' && !program) return { ok: false, error: 'the background service needs the installed app (bun run install-cli first)' };
  saveSettings({ calc: { ...calc, link: where } });
  const uid = process.getuid?.() ?? 0;
  run(['bootout', `gui/${uid}/${CALC_LABEL}`]);
  if (where === 'web') { rmSync(plistPath(), { force: true }); return { ok: true, where }; }
  mkdirSync(launchDir(), { recursive: true });
  mkdirSync(join(calcLog(), '..'), { recursive: true });
  writeFileSync(plistPath(), calcPlist({ program }));
  const r = run(['bootstrap', `gui/${uid}`, plistPath()]);
  if (r.status !== 0) { saveSettings({ calc: { ...calc, link: 'web' } }); rmSync(plistPath(), { force: true }); return { ok: false, error: `launchctl said: ${(r.stderr || r.stdout || '').trim()}` }; }
  return { ok: true, where };
}

const clock = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const age = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

// The status in a few plain lines (coding calc status, /calc).
export function statusLines(st, { where = linkWhere(loadSettings().calc), service = serviceState() } = {}) {
  const lines = [];
  const place = where === 'service' ? 'its own background service' : 'inside Agentic Coder Web';
  if (!st) {
    lines.push(`Calculator link: not running. It is set to run ${place}${where === 'web' ? ', and no web copy is running it (coding web, or /calc on for its own service)' : ', which is not running (coding calc on starts it again)'}.`);
    const s = savedState();
    if (s.reports.length) lines.push(`Reports: ${s.reports.filter((r) => r.status === 'filed').length} filed, ${s.reports.filter((r) => r.status !== 'filed').length} waiting.`);
    return lines;
  }
  lines.push(`Calculator link: ${st.words} · ${st.where === 'service' ? 'its own background service' : 'inside Agentic Coder Web'} · since ${clock(st.since)}`);
  if (st.user) lines.push(`Signed in as ${st.user} at ${st.url}${st.session ? ` · session ${age(st.session.ageMs)} old${st.session.refreshAt ? ` · signs in again at ${clock(st.session.refreshAt)}` : ''}` : ''}`);
  if (st.lastError && st.state !== 'live') lines.push(`Last problem: ${st.lastError}`);
  const c = st.counts ?? {};
  const many = (k, w) => `${c[k] ?? 0} ${w}${(c[k] ?? 0) === 1 ? '' : 's'}`;
  lines.push(`Today: ${many('drops', 'drop')} · ${many('reconnects', 'reconnect')} · ${many('signIns', 'sign-in')} · reports filed ${st.reports.filter((r) => r.status === 'filed').length} of ${st.reports.length}`);
  lines.push(`Background service: ${service.loaded ? 'on (starts with this Mac)' : 'off'}`);
  return lines;
}

export async function calcCommand(argv, { out = (s) => process.stdout.write(`${s}\n`) } = {}) {
  const cmd = argv[0] ?? 'status';
  if (cmd === 'status') { for (const l of statusLines(await askLink('/status'))) out(l); process.exit(0); }
  if (cmd === 'on' || cmd === 'off') {
    const r = setWhere(cmd === 'on' ? 'service' : 'web');
    out(r.ok ? (cmd === 'on' ? `The calculator link runs as its own background service now: it starts with this Mac. Log: ${calcLog()}` : 'The background service is off: the calculator link runs inside Agentic Coder Web again.') : r.error);
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === 'reconnect' || cmd === 'signin') {
    const st = await askLink(`/${cmd}`, { method: 'POST' });
    out(st ? `${cmd === 'reconnect' ? 'Reconnecting' : 'Signing in again'}: ${st.words}` : 'The calculator link is not running here.');
    process.exit(st ? 0 : 1);
  }
  if (cmd !== 'run') { process.stderr.write(`coding calc: no command ${cmd} (status, on, off, run, reconnect, signin)\n`); process.exit(2); }
  let host = null;
  const leave = () => setTimeout(() => { out('calc link: the settings say it runs inside the web now, so the service stops'); host?.stop(); process.exit(0); }, 0);
  host = linkHost({ where: 'service', log: (s) => out(`${new Date().toISOString()} ${s}`), onLeave: leave });
  out(`${new Date().toISOString()} calc link: the background service started (pid ${process.pid})`);
  const stop = () => { host.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}
