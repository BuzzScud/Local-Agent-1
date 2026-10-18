// ssh from a command (the owner's ask, 18 Oct 2026: "log in to the server: ssh root@…, just run the
// command. the mac should go once you enter that into the terminal"). In Bypass the model ran
// `ssh root@<server>` and it could not work: the fence kept ssh from its own config and known_hosts
// ("Host key verification failed"), the hint blamed apps and running services, and the model, which had
// read "Still refused: … .ssh" in the Bypass note, first spent 42 s arguing with itself whether it might
// try at all. Now, in Bypass:
// - ssh reads its own public files (sandbox.mjs) and logs in through this Mac's ssh agent; the private
//   keys stay closed to every command, ssh included, so nothing of a key can reach the model;
// - an agent with no key yet (the Mac restarted, no ssh since) is given the keys whose passphrase is in
//   the Keychain, as the user's own first ssh in Terminal does (keysReady);
// - a bare `ssh <server>` is a login check: commands get no keyboard here, so it would log in and out
//   again at once, printing the welcome text, and the model took its next command for one on the server
//   (sshLogin, loginAnswer);
// - each way ssh fails says what to do, or what to ask the user (sshHint).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { splitCommand } from '../agent/command-words.mjs';

// The word anywhere, so `timeout 20 ssh …` and `sh -c 'ssh …'` count too; a grep for the word costs one
// quick look at the agent at most, and a hint only answers ssh's own messages.
const SSH_FAMILY = /(?:^|[\s;&|(`'"])(?:\/usr\/bin\/)?(?:ssh|scp|sftp|rsync|ssh-copy-id)(?=[\s;&|)`'"]|$)/;
export const usesSsh = (command) => SSH_FAMILY.test(String(command ?? ''));

// ssh's options that take a value (the next word, or the rest of the same one: -p22), and those that do not.
const VALUE = 'BbcDEeFIiJLlmOoPpQRSWw';
const FLAGS = '46AaCfGgKkMNnqsTtVvXxYy';
// Not a login: a tunnel or forward (-L -R -D -W -N), into the background (-f), only a question to ssh
// (-G -V -Q), or a running connection's own command (-O). Those run as typed.
const NOT_LOGIN = 'LRDWNfGVQO';
// The login check's command, there: four lines in any shell (no $( ), so fish and csh read it too).
export const LOGIN_CHECK = 'whoami; hostname; uname -sr; pwd';

// The words of one plain command, as the shell would pass them: quotes taken off, nothing the shell would
// change ($, *, ~, a backslash…). null: not plain, so it runs as typed.
function plainWords(text) {
  const words = [];
  let cur = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) { if (cur !== null) words.push(cur); cur = null; continue; }
    cur ??= '';
    if (c === "'" || c === '"') {
      const j = text.indexOf(c, i + 1);
      const inside = j < 0 ? null : text.slice(i + 1, j);
      if (inside === null || (c === '"' && /[$`\\!]/.test(inside))) return null;
      cur += inside;
      i = j;
      continue;
    }
    if (/[$`*?~{}[\]\\!#]/.test(c)) return null;
    cur += c;
  }
  if (cur !== null) words.push(cur);
  return words;
}

// A server a request names as the ssh command a person types: "ssh root@203.0.113.9", "ssh -p 2222 deploy@box".
// A user@host or an address, so "ssh into it" or "the ssh key" names none. Answers the server, or null.
const NAMED = /(?:^|[\s:(`'"])ssh\s+(?:-\w+\s+(?:\d+\s+)?)*([\w.-]+@[\w.-]+|\d{1,3}(?:\.\d{1,3}){3})/i;
export const sshNamed = (text) => NAMED.exec(String(text ?? ''))?.[1].replace(/\.+$/, '') ?? null;

// The line that goes with such a request (agent-notes.mjs): in Bypass, that it runs from here and how; otherwise,
// where it would.
export function sshNote(server, { open = false } = {}) {
  return open
    ? `The request names a server (${server}), and commands reach it from here: run ssh with Bash, as typed. ssh ${server} alone checks the login and says how to go on; ssh ${server} '<command>' runs one there. This Mac's saved keys log in: never ask for a password or a key.`
    : `The request names a server (${server}). Commands reach other computers only in Bypass permissions: tell the user in one line to turn it on (/mode bypass), or to run the command themselves, typed after ! in the prompt.`;
}

// The server a command goes to (root@host, or a name from ~/.ssh/config), for the hints: ssh's first word
// that is not an option, or the host of scp's and rsync's host:path.
export function destOf(command) {
  for (const part of splitCommand(command).parts) {
    const words = plainWords(part.trim());
    if (!words) continue;
    const at = words.findIndex((w) => /^(?:\/usr\/bin\/)?(?:ssh|sftp|ssh-copy-id)$/.test(w));
    for (let i = at + 1; at >= 0 && i < words.length; i++) {
      const w = words[i];
      if (!w.startsWith('-') || w === '-') return w;
      const k = [...w.slice(1)].findIndex((f) => VALUE.includes(f));
      if (k >= 0 && k === w.length - 2) i++; // its value is the next word
    }
    if (at < 0 && words.some((w) => /^(?:\/usr\/bin\/)?(?:scp|rsync)$/.test(w))) {
      const remote = words.find((w) => !w.startsWith('-') && /^(?:[\w.-]+@)?[\w.-]+:/.test(w));
      if (remote) return remote.slice(0, remote.indexOf(':'));
    }
  }
  return null;
}

const quote = (w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`);

// A bare login, `ssh [options] <server>` with nothing to run there: { dest, command } with the login
// check to run in its place, or null when the command is anything else.
export function sshLogin(command) {
  const s = splitCommand(command);
  if (s.nested || s.writes || s.background || s.open || s.parts.length !== 1) return null;
  const words = plainWords(s.parts[0].trim());
  if (!words || !/^(?:\/usr\/bin\/)?ssh$/.test(words[0] ?? '')) return null;
  const opts = [];
  let dest = null;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (dest !== null) return null; // something to run on the server: it runs as typed
    if (!w.startsWith('-') || w === '-') { dest = w; continue; }
    let kept = '-';
    for (let k = 1; k < w.length; k++) {
      const f = w[k];
      if (NOT_LOGIN.includes(f) || !(VALUE.includes(f) || FLAGS.includes(f))) return null;
      if (VALUE.includes(f)) {
        const value = w.slice(k + 1) || words[++i];
        if (value === undefined) return null;
        if (kept !== '-') opts.push(kept);
        opts.push(`-${f}`, value);
        kept = '';
        break;
      }
      if (f !== 't') kept += f; // a terminal (-t) is what it cannot have: the check asks for none (-T)
    }
    if (kept.length > 1) opts.push(kept);
  }
  if (!dest) return null;
  // BatchMode: a password or a new server's key fails at once instead of asking a keyboard that is not
  // there. The ones given first win in ssh, so the model's own -o cannot undo them.
  const args = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', ...opts, dest, LOGIN_CHECK];
  return { dest, command: args.map(quote).join(' ') };
}

// What the model is told after a login check: who and where it logged in, and how to work there.
// null when the check did not get through (the command's failure and sshHint say why).
export function loginAnswer(login, r) {
  const lines = r.lines.map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
  if (r.code !== 0 || r.timedOut || lines.length < 4) return null;
  const [user, host, system, home] = lines.slice(-4);
  const said = `Logged in to ${login.dest}: ${user} on ${host} (${system}), home folder ${home}.`;
  const note = `(ssh with no command logs in and straight out again here, because commands get no keyboard, so Agentic Coder checked the login instead. Nothing stays open between commands: every Bash call starts on this Mac again. To work on this server, run each command through ssh, quoted: ssh ${login.dest} 'cd <folder> && ls'. Read, Edit and Write reach only this Mac's files; for the server's, use cat, sed or scp through ssh.)`;
  return { said, text: `${said}\n${note}` };
}

// Why an ssh failed, and what to do or ask next. '' when it did not fail in one of these ways.
export function sshHint(output, { open = false, command = '' } = {}) {
  if (!usesSsh(command)) return '';
  const out = String(output ?? '');
  const dest = destOf(command) ?? 'that server';
  if (/connect to host \S+ port \d+: Operation not permitted/i.test(out) && !open) {
    return '\n(Commands reach other computers only in Bypass permissions, which the user turns on (/mode bypass). Ask them to turn it on, or to run the command themselves: typed after ! in the prompt, it runs as they typed it.)';
  }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/.test(out)) {
    return `\n(${dest} answered with a different key from the one this Mac saved for it: it may have been rebuilt, or someone may be in between. Do not get around this (no StrictHostKeyChecking=no, no other known_hosts file). Tell the user exactly this and let them check.)`;
  }
  if (/Host key verification failed/.test(out)) {
    return `\n(This Mac has never connected to ${dest}, so ssh cannot check it is the right server. Use Ask: should this Mac trust it? If yes, the user types ! ssh -o StrictHostKeyChecking=accept-new ${dest} true in the prompt, which saves its key; then run your command again. Never turn the check off yourself.)`;
  }
  if (/Load key "[^"]*": Operation not permitted/.test(out) && /Permission denied/.test(out)) {
    return `\n(This Mac's ssh key is not unlocked yet, and commands here may not open key files. Never ask for the passphrase or the key. Ask the user to log in once in their own Terminal (ssh ${dest}), which unlocks the key until the Mac restarts; then run your command again.)`;
  }
  if (/Permission denied \([^)]*(?:password|keyboard-interactive)/.test(out)) {
    return `\n(${dest} wants a password, which commands here cannot type. Never ask for it in the chat. Ask the user to set up key login once (ssh-copy-id ${dest} in their own Terminal), or to run the command themselves.)`;
  }
  if (/Permission denied \(publickey/.test(out)) {
    return `\n(${dest} turned down this Mac's key for that login. Check the user name (root@, ubuntu@…) and the address; if they look right, Ask the user which login to use. Never ask for a password or a key.)`;
  }
  if (/Could not resolve hostname/.test(out)) {
    return '\n(No computer goes by that name. Check the spelling: a name from the user\'s ~/.ssh/config, or user@address. If you do not have the address, Ask the user for it.)';
  }
  if (/Operation timed out|Connection timed out|No route to host|Connection refused|Network is unreachable/.test(out)) {
    return `\n(${dest} did not answer from this Mac: it may be off, the address or port may be wrong, or a firewall or VPN is in the way. Ask the user; do not keep trying.)`;
  }
  return '';
}

// The ssh agent holds no key yet (the Mac restarted, no ssh since): it is given the keys whose passphrase
// the user saved in the Keychain (ssh-add --apple-load-keychain), as their own first ssh does with
// UseKeychain and AddKeysToAgent. Tried once per app; it runs nothing of the model's. AGENTIC_SSH_KEYS=off: never
// (the tests, test-env.mjs).
const SSH_ADD = '/usr/bin/ssh-add';
let tried = false;
export const forgetKeys = () => { tried = false; };
const exitOf = (file, args) => new Promise((done) => {
  const child = spawn(file, args, { stdio: 'ignore' });
  const timer = setTimeout(() => { child.kill('SIGKILL'); done(null); }, 5000);
  child.on('error', () => { clearTimeout(timer); done(null); });
  child.on('exit', (code) => { clearTimeout(timer); done(code); });
});
export async function keysReady({ sshAdd = SSH_ADD, on = process.env.AGENTIC_SSH_KEYS !== 'off' } = {}) {
  if (!on || tried || process.platform !== 'darwin' || !existsSync(sshAdd)) return false;
  if ((await exitOf(sshAdd, ['-l'])) !== 1) return false; // 0: it holds a key; 2: no agent to give one to
  tried = true;
  return (await exitOf(sshAdd, ['--apple-load-keychain'])) === 0;
}
