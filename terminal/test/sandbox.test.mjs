// The command fence (tools/sandbox.mjs). Outbound network is closed: allow default
// used to leave it open, so a command could still phone home.
import { test, expect } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxProfile } from '../src/tools/sandbox.mjs';

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
