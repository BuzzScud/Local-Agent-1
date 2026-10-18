// The command fence (tools/sandbox.mjs). Outbound network is closed: allow default
// used to leave it open, so a command could still phone home.
import { test, expect } from 'bun:test';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
  // ssh's own public files are read again after that deny (the last matching rule wins): never a key.
  const pub = p.indexOf(`(allow file-read-data (literal ${JSON.stringify(join(home, '.ssh', 'config'))})`);
  expect(pub).toBeGreaterThan(p.indexOf(`(deny file-read-data file-write* (subpath ${JSON.stringify(join(home, '.ssh'))}))`));
  expect(p.slice(pub)).toContain('known_hosts');
  expect(p).not.toMatch(/allow file-read-data[^\n]*id_ed25519"/);
  expect(sandboxProfile(root, { home })).not.toContain('.ssh/config');
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

// 18 Oct 2026: in Bypass, `ssh root@<server>` failed for every server ("hostkeys_foreach failed for
// ~/.ssh/known_hosts: Operation not permitted"). ssh may read what it needs to log in through the agent, and no more.
test.if(process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'))('the open profile lets ssh read its settings, known servers and public keys, never a key, and write nothing there', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-home-'));
  const project = join(home, 'proj');
  const ssh = join(home, '.ssh');
  mkdirSync(project);
  mkdirSync(join(ssh, 'config.d'), { recursive: true });
  const open = ['config', 'known_hosts', 'id_ed25519.pub', 'config.d/work'];
  for (const f of open) writeFileSync(join(ssh, f), `${f}\n`);
  for (const f of ['id_ed25519', 'deploy_key']) writeFileSync(join(ssh, f), 'PRIVATE\n');
  const run = (cmd, bypass = true) => spawnSync('/usr/bin/sandbox-exec', ['-p', sandboxProfile(project, { home, open: bypass }), '/bin/zsh', '-c', cmd], { encoding: 'utf8', cwd: project });
  for (const f of open) expect([f, run(`cat ${JSON.stringify(join(ssh, f))}`).stdout]).toEqual([f, `${f}\n`]);
  for (const f of ['id_ed25519', 'deploy_key']) expect([f, run(`cat ${JSON.stringify(join(ssh, f))}`).stdout]).toEqual([f, '']);
  expect(run(`ls ${JSON.stringify(ssh)}`).stdout).toBe('');
  expect(run(`echo x >> ${JSON.stringify(join(ssh, 'known_hosts'))}`).status).not.toBe(0);
  expect(readFileSync(join(ssh, 'known_hosts'), 'utf8')).toBe('known_hosts\n');
  expect(run(`cat ${JSON.stringify(join(ssh, 'config'))}`, false).stdout).toBe(''); // outside Bypass the home is closed
});
