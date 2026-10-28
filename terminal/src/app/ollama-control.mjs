// Ollama on this Mac, run from the hub's Bonsai tab (27 Oct 2026, the owner's pick: full control): what runs and with
// which settings, and Restart with new ones, Stop, Start, and starting at login. The settings are Ollama's own
// environment: flash attention (OLLAMA_FLASH_ATTENTION), the format of what it remembers of a conversation
// (OLLAMA_KV_CACHE_TYPE: f16, q8_0, q4_0) and the context a request without its own gets (OLLAMA_CONTEXT_LENGTH).
// Started here, it runs on its own (a new session, its output in <home>/logs/ollama.log), so it outlives the hub and
// the window. At login it is a LaunchAgent of ours (LABEL), its settings in the plist; Stop there is launchd's.
// Every action that changes something is refused inside a test run unless the test points it at a stand-in
// (AGENTIC_OLLAMA_CONTROL=test plus AGENTIC_OLLAMA_BIN, AGENTIC_LAUNCH_AGENTS), so a test never touches the real one.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { HOME } from '../../../models/index.mjs';
import { loadSettings, saveSettings } from './store.mjs';

export const LABEL = 'com.agentic-coder.ollama';
export const OLLAMA_URL = () => process.env.AGENTIC_OLLAMA_URL || 'http://127.0.0.1:11434';
const PORT = () => Number(new URL(OLLAMA_URL()).port || 11434);
export const KV_TYPES = ['f16', 'q8_0', 'q4_0'];
export const CTX_STEPS = [8192, 16384, 32768, 65536, 131072];
const agentsDir = () => process.env.AGENTIC_LAUNCH_AGENTS || join(homedir(), 'Library', 'LaunchAgents');
export const plistPath = () => join(agentsDir(), `${LABEL}.plist`);
export const logPath = () => join(HOME, 'logs', 'ollama.log');

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
// What may act: everywhere but a test run, and a test run only on its own stand-in.
export function canAct(env = process.env) {
  if (env.NODE_ENV === 'test' || env.AGENTIC_TEST_HOME) return env.AGENTIC_OLLAMA_CONTROL === 'test' ? null : 'not in a test run';
  return env.AGENTIC_OLLAMA_CONTROL === 'off' ? 'switched off (AGENTIC_OLLAMA_CONTROL=off)' : null;
}
function ollamaBin(env = process.env) {
  if (env.AGENTIC_OLLAMA_BIN) return env.AGENTIC_OLLAMA_BIN;
  for (const p of ['/opt/homebrew/opt/ollama/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama']) if (existsSync(p)) return p;
  const w = run('/usr/bin/which', ['ollama']);
  return w.status === 0 ? w.stdout.trim() : null;
}

// The settings it runs with now, from its process's environment (ps shows a process's own user's), else its defaults.
export const settingsOf = (env) => ({
  flash: /^(1|true)$/i.test(env.OLLAMA_FLASH_ATTENTION ?? ''),
  kv: KV_TYPES.includes(env.OLLAMA_KV_CACHE_TYPE) ? env.OLLAMA_KV_CACHE_TYPE : 'f16',
  ctx: Number(env.OLLAMA_CONTEXT_LENGTH) || 0,
});
export const envOf = (s) => ({ OLLAMA_FLASH_ATTENTION: s.flash ? '1' : '0', OLLAMA_KV_CACHE_TYPE: KV_TYPES.includes(s.kv) ? s.kv : 'q8_0', ...(s.ctx ? { OLLAMA_CONTEXT_LENGTH: String(s.ctx) } : {}) });
// The process listening on its port, and what it was started with.
function listener() {
  const l = run('/usr/sbin/lsof', ['-nP', `-iTCP:${PORT()}`, '-sTCP:LISTEN', '-t']);
  const pid = Number(String(l.stdout ?? '').trim().split('\n')[0]) || null;
  if (!pid) return null;
  const ps = run('/bin/ps', ['eww', '-o', 'command=', '-p', String(pid)]);
  const words = String(ps.stdout ?? '').trim().split(/\s+/);
  const env = Object.fromEntries(words.filter((w) => /^OLLAMA_[A-Z_]+=/.test(w)).map((w) => [w.slice(0, w.indexOf('=')), w.slice(w.indexOf('=') + 1)]));
  return { pid, command: words.filter((w) => !/^[A-Z_]+=/.test(w)).slice(0, 2).join(' '), env };
}
const uid = () => userInfo().uid;
function launchdLoaded() { const r = run('/bin/launchctl', ['print', `gui/${uid()}/${LABEL}`]); return r.status === 0; }

async function api(path, init = {}) {
  const r = await fetch(`${OLLAMA_URL()}${path}`, { ...init, signal: AbortSignal.timeout(init.timeout ?? 4000) });
  return r.ok ? r.json() : null;
}
// What runs now: { running, version, pid, settings, by: 'login item' | 'by hand' | 'another app', login, address, log }.
export async function ollamaStatus() {
  let version = null;
  try { version = (await api('/api/version'))?.version ?? null; } catch {}
  const l = listener();
  const login = existsSync(plistPath());
  const loaded = login && launchdLoaded();
  const by = !l ? null : loaded ? 'login item' : /ollama serve|ollama$/.test(l.command) || l.command.includes('ollama') ? 'by hand' : 'another app';
  return { running: Boolean(version), version, pid: l?.pid ?? null, settings: settingsOf(l?.env ?? {}), by, login, address: OLLAMA_URL().replace(/^https?:\/\//, ''), log: existsSync(logPath()) ? logPath() : null, bin: ollamaBin() };
}
export function logTail(lines = 12) {
  try { return readFileSync(logPath(), 'utf8').trim().split('\n').slice(-lines); } catch { return []; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(up, secs = 15) {
  for (let i = 0; i < secs * 5; i++) {
    let ok = false;
    try { ok = Boolean(await api('/api/version', { timeout: 800 })); } catch {}
    if (ok === up) return true;
    await sleep(200);
  }
  return false;
}
// The settings asked for, kept in settings.json so a Start uses them again.
const keep = (s) => saveSettings({ ollamaServer: { flash: Boolean(s.flash), kv: KV_TYPES.includes(s.kv) ? s.kv : 'q8_0', ctx: CTX_STEPS.includes(Number(s.ctx)) ? Number(s.ctx) : 0 } });
export const keptSettings = () => ({ flash: true, kv: 'q8_0', ctx: 65536, ...(loadSettings().ollamaServer ?? {}) });

function plist(s, bin) {
  const env = Object.entries(envOf(s)).map(([k, v]) => `      <key>${k}</key><string>${v}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${bin}</string><string>serve</string></array>
  <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${logPath()}</string>
  <key>StandardErrorPath</key><string>${logPath()}</string>
</dict>
</plist>
`;
}

// Stop: launchd's when it is our login item (it stays a login item), else the process on its port.
export async function stopOllama() {
  const no = canAct(); if (no) throw new Error(`Ollama is not changed here: ${no}`);
  const st = await ollamaStatus();
  if (!st.running && !st.pid) return { ok: true, said: 'Ollama was not running' };
  if (st.by === 'another app') throw new Error(`something other than Ollama listens on ${st.address}; it was left alone`);
  if (st.by === 'login item') run('/bin/launchctl', ['bootout', `gui/${uid()}/${LABEL}`]);
  else if (st.pid) { try { process.kill(st.pid, 'SIGTERM'); } catch {} }
  if (!(await waitFor(false, 10))) throw new Error('Ollama did not stop within 10 s');
  return { ok: true, said: 'Ollama stopped' };
}
// Start with these settings: as the login item when it is one, else on its own (a new session).
export async function startOllama(s = keptSettings()) {
  const no = canAct(); if (no) throw new Error(`Ollama is not changed here: ${no}`);
  const bin = ollamaBin(); if (!bin) throw new Error('Ollama is not installed here (brew install ollama)');
  keep(s);
  mkdirSync(join(HOME, 'logs'), { recursive: true });
  if (existsSync(plistPath())) {
    writeFileSync(plistPath(), plist(s, bin));
    run('/bin/launchctl', ['bootout', `gui/${uid()}/${LABEL}`]);
    const b = run('/bin/launchctl', ['bootstrap', `gui/${uid()}`, plistPath()]);
    if (b.status !== 0 && !(await waitFor(true, 2))) throw new Error(`launchd did not start it: ${(b.stderr || b.stdout).trim().slice(0, 200)}`);
  } else {
    const out = openSync(logPath(), 'a');
    const child = spawn(bin, ['serve'], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, ...envOf(s) } });
    child.unref(); closeSync(out);
  }
  if (!(await waitFor(true, 15))) throw new Error(`Ollama did not answer within 15 s (its log: ${logPath().replace(homedir(), '~')})`);
  return { ok: true, said: `Ollama started: flash attention ${s.flash ? 'on' : 'off'}, context memory ${s.kv}, default context ${s.ctx ? `${s.ctx / 1024}k` : 'its own'}` };
}
export async function restartOllama(s) {
  const st = await ollamaStatus();
  if (st.running) await stopOllama();
  const r = await startOllama(s);
  return { ...r, said: r.said.replace('started', 'restarted') };
}
// At login on: our LaunchAgent with these settings, which then runs it (the one started by hand gives way).
// Off: the LaunchAgent goes, and it goes on running by hand with the same settings.
export async function setLogin(on, s = keptSettings()) {
  const no = canAct(); if (no) throw new Error(`Ollama is not changed here: ${no}`);
  const bin = ollamaBin(); if (!bin) throw new Error('Ollama is not installed here (brew install ollama)');
  keep(s);
  if (on) {
    mkdirSync(agentsDir(), { recursive: true });
    const st = await ollamaStatus();
    if (st.running && st.by !== 'login item') await stopOllama();
    writeFileSync(plistPath(), plist(s, bin));
    const b = run('/bin/launchctl', ['bootstrap', `gui/${uid()}`, plistPath()]);
    if (!(await waitFor(true, 15))) throw new Error(`the login item did not start Ollama: ${(b.stderr || b.stdout).trim().slice(0, 200)}`);
    return { ok: true, said: 'Ollama starts at login now, with these settings' };
  }
  if (existsSync(plistPath())) { run('/bin/launchctl', ['bootout', `gui/${uid()}/${LABEL}`]); rmSync(plistPath(), { force: true }); await waitFor(false, 10); }
  await startOllama(s);
  return { ok: true, said: 'Ollama no longer starts at login; it runs on until this Mac restarts' };
}

// The model: loaded at its context, or let go of.
export async function loadModel(model, numCtx) {
  const no = canAct(); if (no) throw new Error(`Ollama is not changed here: ${no}`);
  const r = await fetch(`${OLLAMA_URL()}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: '30m', ...(numCtx ? { options: { num_ctx: numCtx } } : {}) }), signal: AbortSignal.timeout(5 * 60_000) });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return { ok: true, said: `${model} loaded` };
}
export async function unloadModel(model) {
  const no = canAct(); if (no) throw new Error(`Ollama is not changed here: ${no}`);
  const r = await fetch(`${OLLAMA_URL()}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
  return { ok: true, said: `${model} unloaded: its memory is back` };
}
