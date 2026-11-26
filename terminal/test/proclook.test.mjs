// ps and top inside the command sandbox (tools/proclook.mjs). 25 Nov 2026, the owner's screenshot: hearth's model, asked
// why a server was slow, ran `ps aux | grep -iE "cline|ollama"` in Bypass and got "zsh:1: operation not permitted: ps":
// macOS never starts a setuid program inside a sandbox, so the app runs a plain ps or top for the command.
import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lookCalls, lookKey, prepareLooks } from '../src/tools/proclook.mjs';
import { runCommand } from '../src/tools/run.mjs';
import { fenceHint } from '../src/tools/sandbox.mjs';

const mac = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');

test('the ps and top a command names, with their words, and the ones the app cannot run for it', () => {
  expect(lookCalls('ps aux | grep -iE "cline|ollama" | grep -v grep | head -20; echo ---; ls ~')).toEqual([{ name: 'ps', args: ['aux'], why: null }]);
  expect(lookCalls('ps -axo pid,%cpu,%mem,command 2>/dev/null | sort -k2 -nr | head')).toEqual([{ name: 'ps', args: ['-axo', 'pid,%cpu,%mem,command'], why: null }]);
  expect(lookCalls('cd /tmp && /bin/ps -p 1 -o "pid=" > out.txt')).toEqual([{ name: 'ps', args: ['-p', '1', '-o', 'pid='], why: null }]);
  expect(lookCalls('top -l 1 -n 10 -o cpu | head -20')).toEqual([{ name: 'top', args: ['-l', '1', '-n', '10', '-o', 'cpu'], why: null }]);
  expect(lookCalls('top')[0].why).toBe('live');
  expect(lookCalls('ps -E -p 1')[0].why).toBe('env');
  expect(lookCalls('ps auxe')[0].why).toBe('env');
  expect(lookCalls('ps -ef')[0].why).toBe(null); // -e is every process, not the environment
  expect(lookCalls('ps -p $PID')).toEqual([{ name: 'ps', args: null, why: 'words' }]);
  expect(lookCalls('echo $(ps aux | wc -l)')).toEqual([{ name: 'ps', args: ['aux'], why: null }]);
  // Words that only name them are no call.
  for (const c of ['grep ps notes.md', 'echo top', 'cat /tmp/ps', 'npm run ps', 'git log --oneline | head']) expect([c, lookCalls(c)]).toEqual([c, []]);
});

test('a call is kept under what the stand-in works out from its own words', () => {
  for (const args of [['aux'], ['-axo', 'pid,%cpu,command'], ['-p', '1', '-o', 'pid='], []]) {
    const sh = spawnSync('/bin/sh', ['-c', 'printf \'%s\\n\' "$@" | /sbin/md5 -q', 'sh', ...args], { encoding: 'utf8' });
    if (sh.status === 0) expect([args, sh.stdout.trim()]).toEqual([args, lookKey(args)]);
  }
});

test('the calls run beside each other, each once, and the folder goes when done', async () => {
  const ran = [];
  const look = await prepareLooks('ps aux | head; ps aux | wc -l; top -l 1 -n 5; top', {
    base: mkdtempSync(join(tmpdir(), 'agentic-look-test-')),
    run: async (file, args) => { ran.push([file, ...args]); return { status: 0, stdout: `${file}\n`, stderr: '' }; },
  });
  expect(ran).toEqual([['/bin/ps', 'aux'], ['/usr/bin/top', '-l', '1', '-n', '5']]);
  expect(existsSync(join(look.path, 'ps'))).toBe(true);
  expect(existsSync(join(look.path, 'top'))).toBe(true);
  look.done();
  expect(existsSync(look.path)).toBe(false);
  expect(await prepareLooks('ls -la')).toBe(null);
});

test.if(mac)('inside the sandbox ps and top answer as they would outside it, in Bypass and in the fence', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-look-'));
  for (const sandbox of [{ open: true }, {}]) {
    const r = await runCommand(`ps -p ${process.pid} -o pid= | tr -d ' '; ps aux | wc -l`, { cwd, sandbox });
    expect([sandbox, r.fenced, r.code, r.lines[0]]).toEqual([sandbox, true, 0, String(process.pid)]);
    expect(Number(r.lines[1])).toBeGreaterThan(5);
  }
  const top = await runCommand('top -l 1 -n 3 -o cpu | grep -c "^PID"', { cwd, sandbox: { open: true } });
  expect([top.code, top.lines[0]]).toEqual([0, '1']);
  // The ones it does not run say why, and nothing else is added under them.
  const live = await runCommand('top', { cwd, sandbox: { open: true } });
  expect(live.lines.join('\n')).toContain('top without -l is its live screen');
  expect(live.lines.join('\n')).not.toContain('Blocked');
  const env = await runCommand('ps -E -p 1', { cwd, sandbox: { open: true } });
  expect([env.code, env.lines.join('\n')]).toEqual([1, expect.stringContaining("ps's environment view")]);
  const later = await runCommand('P=1; ps -p $P', { cwd, sandbox: { open: true } });
  expect(later.lines.join('\n')).toContain('these words were not known before the command ran');
  expect(later.lines.join('\n')).not.toContain('Blocked');
  // By its path it never reaches the stand-in: the hint says how to write it.
  const path = await runCommand('/bin/ps -p 1', { cwd, sandbox: { open: true } });
  expect(path.lines.join('\n')).toContain('ps and top never start inside the command sandbox');
  // A command run as you are (sandbox: false, "!" in the app) runs the real ps.
  expect((await runCommand(`ps -p ${process.pid} -o pid= | tr -d ' '`, { cwd, sandbox: false })).lines[0]).toBe(String(process.pid));
});

test('the hints for what the sandbox still turns away: ps by its path, the system log', () => {
  expect(fenceHint('zsh:1: operation not permitted: ps')).toContain('the app runs those itself');
  expect(fenceHint("sandbox-exec: execvp() of '/bin/ps' failed: Operation not permitted", { open: true })).toContain('pgrep -lf <name>');
  expect(fenceHint('zsh:1: operation not permitted: top', { open: true })).toContain('top -l 1 -n 15 -o cpu');
  expect(fenceHint('log: Cannot run while sandboxed', { open: true })).toContain('~/.ollama/logs/server.log');
});
