// ps and top inside the command sandbox (25 Nov 2026, the owner's screenshot: hearth's model, asked why a server was
// slow, ran `ps aux | grep -iE "cline|ollama"` and got "zsh:1: operation not permitted: ps", in Bypass). Both are setuid
// programs, and macOS never starts one inside a sandbox, whatever its profile (sandbox-exec: "execvp() of '/bin/ps'
// failed: Operation not permitted"); pgrep, lsof, vm_stat and memory_pressure run there as usual.
// So the app runs each ps or top a command names, with the same words, itself, just before the command (they only read),
// and a stand-in of the same name first on the command's PATH prints that answer, its errors and its exit code. A ps or
// top whose words the app cannot know before (a variable, a glob, `$(…)`) gets a line saying how to write it instead
// (sandbox.mjs fenceHint says the same when /bin/ps is called by its path). Never ps's environment view (-E, e): it
// shows the keys in other programs' environments, which commands never get (run.mjs withoutSecrets).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOOKS = { ps: '/bin/ps', top: '/usr/bin/top' };
// At most this many different calls a command, each this long at most; top samples once a second (-l 3 is about 2 s).
const CALLS_MAX = 6;
const LOOK_MS = { ps: 5000, top: 15_000 };
const OUT_MAX = 8 * 1024 * 1024;

// A redirection's word ("2>/dev/null", ">", "&>out"): it and what follows are the shell's, not the program's.
const REDIRECT = /^(?:\d*>>?|\d*<|&>>?|\d*>&)/;
// The words after the program's name, quotes taken off, up to a redirection. null when one holds what the shell would
// change (a variable, a glob, a substitution, a ~), since the stand-in could not know them before the command runs.
function plainWords(text) {
  const out = [];
  const re = /'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] != null) { out.push(m[1]); continue; }
    if (m[2] != null) { if (/[$`]/.test(m[2])) return null; out.push(m[2].replace(/\\(.)/g, '$1')); continue; }
    if (REDIRECT.test(m[3])) break;
    if (/[$`*?[\]{}~\\'"]/.test(m[3])) return null;
    out.push(m[3]);
  }
  return out;
}

// ps's environment view: -E in a cluster of options, or e in old-style words (ps auxe, ps eww).
const envView = (args) => args.some((a, i) => /^-[A-Za-z]*E/.test(a) || (i === 0 && /^[a-zA-Z]+$/.test(a) && /e/.test(a)));

// Each ps and top the command names: { name, args, why }. args: its words (null when they cannot be known); why: why the
// app does not run it ('words', 'live': top's screen, 'env': ps -E), null when it does. Split at the shell's joins.
export function lookCalls(command) {
  const text = String(command ?? '');
  if (!/(?:^|[\s;&|(`/])(?:ps|top)(?=\s|$|[;&|)`])/.test(text)) return [];
  const calls = [];
  for (const seg of text.split(/\|\||&&|\$\(|[|;&\n()`]/)) {
    const m = /^(?:\w+=\S*\s+)*(?:(?:exec|command|nice|time)\s+)?(?:\/bin\/|\/usr\/bin\/)?(ps|top)(?=\s|$)(.*)$/s.exec(seg.trim());
    if (!m) continue;
    const args = plainWords(m[2]);
    const why = !args ? 'words' : m[1] === 'top' && !args.includes('-l') ? 'live' : m[1] === 'ps' && envView(args) ? 'env' : null;
    calls.push({ name: m[1], args, why });
  }
  return calls;
}

// The key a call is kept under: what `printf '%s\n' "$@" | md5 -q` gives in the stand-in (no words: one empty line).
export const lookKey = (args) => createHash('md5').update(args.length ? args.map((a) => `${a}\n`).join('') : '\n').digest('hex');

const WHY = {
  live: 'top without -l is its live screen, which never ends here. Use top -l 1 -n 15 -o cpu (one sample, the 15 busiest)',
  env: "ps's environment view (-E, e) shows the keys in other programs' environments, which commands never get. Leave -E out",
};
const stand = (out, name) => `#!/bin/sh
# Agentic Coder's stand-in for ${name}: macOS starts ${name} only outside the command's fence, so the app ran it before this command.
# (Its words never say "sandbox" or "not permitted": sandbox.mjs fenceHint would add a line for a block there was not.)
k=$(printf '%s\\n' "$@" | /sbin/md5 -q)
d=${JSON.stringify(out)}
if [ -f "$d/$k.code" ]; then cat "$d/$k.out"; cat "$d/$k.err" >&2; exit "$(cat "$d/$k.code")"; fi
if [ -f "$d/$k.why" ]; then cat "$d/$k.why" >&2; exit 1; fi
echo "${name}: these words were not known before the command ran (a variable, a loop), so the app could not run ${name} for it (macOS starts ${name} only outside the command's fence). Write ${name} with plain words, or use pgrep -lf <name> or lsof, which run here." >&2
exit 1
`;

// One ps or top run by the app, never waited on by the window (top -l 3 takes about 2 s): { status, stdout, stderr }.
function runLook(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, opts, (e, stdout = '', stderr = '') => {
      if (!e) resolve({ status: 0, stdout, stderr });
      else if (typeof e.code === 'number') resolve({ status: e.code, stdout, stderr });
      else resolve({ status: 1, stdout, stderr: `${stderr}${e.killed ? `stopped after ${opts.timeout / 1000} s` : e.message}\n` });
    });
  });
}

// Before a fenced command: runs what it names and writes the stand-ins. { path, done } (path: the folder to put first on
// PATH; done: removes it all), or null when the command names no ps or top.
export async function prepareLooks(command, { run = runLook, base = tmpdir() } = {}) {
  const calls = lookCalls(command);
  if (!calls.length) return null;
  const dir = mkdtempSync(join(base, 'agentic-look-'));
  const bin = join(dir, 'bin');
  const out = join(dir, 'out');
  mkdirSync(bin);
  mkdirSync(out);
  for (const name of new Set(calls.map((c) => c.name))) {
    writeFileSync(join(bin, name), stand(out, name));
    chmodSync(join(bin, name), 0o755);
  }
  const ran = new Map();
  for (const c of calls) {
    if (!c.args) continue;
    const k = lookKey(c.args);
    if (c.why) writeFileSync(join(out, `${k}.why`), `${c.name}: ${WHY[c.why]}.\n`);
    else if (!ran.has(k) && ran.size < CALLS_MAX) ran.set(k, c);
  }
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: process.env.LANG ?? 'en_US.UTF-8', COLUMNS: '400', TERM: 'dumb' };
  await Promise.all([...ran].map(async ([k, c]) => {
    const r = await run(LOOKS[c.name], c.args, { encoding: 'utf8', timeout: LOOK_MS[c.name], maxBuffer: OUT_MAX, env });
    writeFileSync(join(out, `${k}.out`), r.stdout ?? '');
    writeFileSync(join(out, `${k}.err`), r.stderr ?? '');
    writeFileSync(join(out, `${k}.code`), String(r.status ?? 1));
  }));
  return { path: bin, done: () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} } };
}
