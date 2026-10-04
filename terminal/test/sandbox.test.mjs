// The command fence (tools/sandbox.mjs). Outbound network is closed: allow default
// used to leave it open, so a command could still phone home.
import { test, expect } from 'bun:test';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxProfile, fenceHint } from '../src/tools/sandbox.mjs';

test('the profile closes outbound network and still allows this Mac', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-sandbox-'));
  const p = sandboxProfile(root, { home: join(root, 'home') });
  const deny = p.indexOf('(deny network-outbound)');
  const local = p.indexOf('(allow network-outbound (remote ip "localhost:*"))');
  expect(deny).toBeGreaterThan(p.indexOf('(allow default)'));
  expect(local).toBeGreaterThan(deny);
  // sandbox-exec takes only localhost or * as the host.
  expect(p).not.toMatch(/remote ip "(?!localhost:|\*:)/);
  expect(p.indexOf('(allow network-outbound (remote unix-socket))')).toBeGreaterThan(deny);
  // What was already listening is still denied, and that rule comes last so it wins.
  const ports = p.lastIndexOf('(deny network-outbound (remote ip "localhost:');
  if (ports > 0) expect(ports).toBeGreaterThan(local);
});

// The order above is only text: sandbox-exec must also accept the profile, or every
// command fails (a "127.0.0.1:*" host stopped each one with exit 65).
test.if(process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'))('sandbox-exec accepts the profile and a command runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-sandbox-'));
  const r = spawnSync('/usr/bin/sandbox-exec', ['-p', sandboxProfile(root), '/bin/zsh', '-c', 'echo ok'], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  expect([r.status, r.stdout]).toEqual([0, 'ok\n']);
});

// Bypass permissions (the owner's pick, 3 Oct 2026): the folders and the internet open, what
// already runs on this Mac, the app's own folder and ~/.ssh stay closed.
test('the open profile (Bypass): any folder and the internet; apps, running services, the app\'s folder and ~/.ssh stay closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-sandbox-'));
  const home = join(root, 'home');
  const p = sandboxProfile(root, { home, open: true });
  expect(p).not.toContain('(deny network-outbound)\n');
  expect(p).not.toContain(`(deny file-read-data (subpath ${JSON.stringify(home)}))`);
  expect(p).toContain(`(deny file-write* (subpath ${JSON.stringify(join(home, '.agentic-coder'))})`);
  expect(p).toContain(`(deny file-read-data file-write* (subpath ${JSON.stringify(join(home, '.ssh'))}))`);
  expect(p).toContain('(deny process-exec (literal "/usr/bin/open")');
  expect(p).toContain('(deny signal)');
  // The hint for a blocked command says what is still closed, not "stay inside the project".
  expect(fenceHint('zsh: operation not permitted: x', { open: true })).toContain('even in Bypass');
  expect(fenceHint('zsh: operation not permitted: x')).toContain('stay inside the project');
});

test.if(process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'))('sandbox-exec accepts the open profile: a file outside the project is read there, and not without it', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-home-'));
  const project = join(home, 'proj');
  mkdirSync(project);
  writeFileSync(join(home, 'other.txt'), 'outside\n');
  const run = (open) => spawnSync('/usr/bin/sandbox-exec', ['-p', sandboxProfile(project, { home, open }), '/bin/zsh', '-c', `cat ${JSON.stringify(join(home, 'other.txt'))}`], { encoding: 'utf8', cwd: project });
  expect([run(true).status, run(true).stdout]).toEqual([0, 'outside\n']);
  expect(run(false).status).not.toBe(0);
});
