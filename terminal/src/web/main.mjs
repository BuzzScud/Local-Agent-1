// `coding web` (and the container's entry: bun terminal/src/web/main.mjs …).
//   coding web [run] [--port N] [--server] [--host ADDR]…   start it here (Ctrl+C stops it)
//   coding web on | off | status                            start it when this Mac starts (a LaunchAgent)
//   coding web invite <name> [--admin]                       a one-time invite link, from the terminal
//   coding web reset <name>                                  a one-time password-reset link
// The addresses of your AI services and calculator come from the web settings (Admin → Settings),
// filled the first time from AGENTIC_AI_URLS and AGENTIC_CALC_URL.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { startWeb, WEB_PORT } from './server.mjs';
import { openDb } from './db.mjs';
import { Auth } from './auth.mjs';
import { loadSettings } from './config.mjs';

export const LABEL = 'com.agentic-coder.web';
const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logFile = () => join(process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder'), 'logs', 'web.log');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The LaunchAgent: the installed app (never a copy on the Desktop: macOS does not let a login item read it).
export function launchPlist({ program, port }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${[...program, 'web', 'run', '--port', String(port)].map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(logFile())}</string>
  <key>StandardErrorPath</key><string>${xml(logFile())}</string>
</dict></plist>
`;
}

export function parseArgs(argv) {
  const o = { cmd: 'run', port: Number(process.env.AGENTIC_WEB_PORT ?? WEB_PORT), hosts: [], mode: null, admin: false, name: null, trustProxy: process.env.AGENTIC_WEB_TRUST_PROXY === '1' };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) o.cmd = rest.shift();
  if ((o.cmd === 'invite' || o.cmd === 'reset') && rest[0] && !rest[0].startsWith('-')) o.name = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--port') o.port = Number(rest[++i]);
    else if (a === '--host') o.hosts.push(rest[++i]);
    else if (a === '--server') o.mode = 'server';
    else if (a === '--mac') o.mode = 'mac';
    else if (a === '--admin') o.admin = true;
    else if (a === '--trust-proxy') o.trustProxy = true;
    else throw new Error(`coding web: no option ${a}`);
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error('coding web: --port takes a number from 0 to 65535');
  return o;
}

export async function webCommand(argv, { out = (s) => process.stdout.write(`${s}\n`) } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
  const s = loadSettings();
  const base = s.mode === 'server' && s.hosts.server ? `https://${s.hosts.server}` : `http://${s.hosts.mac ?? `localhost:${o.port}`}`;
  if (o.cmd === 'invite' || o.cmd === 'reset') {
    const db = openDb();
    const auth = new Auth(db);
    if (o.cmd === 'invite') {
      const r = auth.invite({ name: o.name, role: o.admin ? 'admin' : 'user', days: s.limits.inviteDays });
      if (!r.ok) { process.stderr.write(`${r.error}\n`); process.exit(1); }
      out(`Invite for ${o.name}${o.admin ? ' (admin)' : ''}, works once, until ${new Date(r.expires).toLocaleString()}:\n${base}/invite/${r.token}`);
    } else {
      const u = auth.userByName(o.name);
      if (!u) { process.stderr.write(`no user called ${o.name}\n`); process.exit(1); }
      const r = auth.resetLink(u.id);
      out(`Password reset for ${u.name}, works once, for 24 hours:\n${base}/reset/${r.token}`);
    }
    db.close();
    process.exit(0);
  }
  if (o.cmd === 'on' || o.cmd === 'off' || o.cmd === 'status') {
    if (process.platform !== 'darwin') { process.stderr.write('coding web on/off is for a Mac; elsewhere run it in a container or a service of your own\n'); process.exit(2); }
    const uid = process.getuid();
    if (o.cmd === 'status') {
      const r = spawnSync('launchctl', ['print', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
      out(r.status === 0 ? `on (starts with this Mac) · log ${logFile()}` : 'off');
      process.exit(0);
    }
    spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
    if (o.cmd === 'off') { rmSync(plistPath(), { force: true }); out('Agentic Coder Web will no longer start with this Mac (and is stopped).'); process.exit(0); }
    const app = join(homedir(), '.agentic-coder', 'app', 'agentic-coder');
    if (!existsSync(app)) { process.stderr.write('coding web on needs the installed app (bun run install-cli first)\n'); process.exit(1); }
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    mkdirSync(join(logFile(), '..'), { recursive: true });
    writeFileSync(plistPath(), launchPlist({ program: [app], port: o.port }));
    const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath()], { encoding: 'utf8' });
    out(r.status === 0 ? `Agentic Coder Web starts with this Mac now, on port ${o.port}. Log: ${logFile()}` : `launchctl said: ${(r.stderr || r.stdout).trim()}`);
    process.exit(r.status === 0 ? 0 : 1);
  }
  if (o.cmd !== 'run') { process.stderr.write(`coding web: no command ${o.cmd} (run, on, off, status, invite, reset)\n`); process.exit(2); }
  const w = startWeb({ port: o.port, hosts: o.hosts.length ? o.hosts : null, mode: o.mode, trustProxy: o.trustProxy, log: out });
  const s2 = w.settings();
  out(`Agentic Coder Web (${s2.mode === 'server' ? 'chat + calculator' : 'full, this Mac'}) on ${w.hosts.map((h) => `${h}:${w.port}`).join(', ')}`);
  if (!s2.services.length) out('No AI service yet: set AGENTIC_AI_URLS, or add one in Admin → Settings.');
  if (!s2.calc.url) out('No calculator yet: set AGENTIC_CALC_URL, or add it in Admin → Settings.');
  const stop = async () => { await w.stop().catch(() => {}); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

if (import.meta.main) await webCommand(process.argv.slice(2));
