// /jumptomac alone in the app: the "Jump to a Mac" box (Design 2 of docs/design rounds/agentic-coder-jumptomac-saved-macs-
// 2-designs-2026-10-03.html, the owner's pick, 3 Oct 2026). The window's keeper is a stand-in on the session's socket that
// notes which Mac each jump asks for (sessions.mjs askJump); Tailscale is a file (AGENTIC_TAILSCALE_STATUS). The real
// jump through a door, and the question that saves a Mac reached for the first time, are in sessions.test.mjs.
import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const { F, frame, frameReader, json } = await import('../src/app/sessions.mjs');
const settingsOf = (base) => JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
const flat = (t) => t.replace(/\s+/g, ' ');

test('/jumptomac alone: the box of saved Macs with what Tailscale says; ⌫ asks, then forgets; an offline Mac says so; + Add a Mac jumps to a new name; enter enter goes to the Mac used last; esc stays', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'background'), { recursive: true });
  const sock = join(home, 'background', 'demo-1.sock');
  // The keeper: each jump is noted and said yes to.
  const asked = [];
  const host = net.createServer((c) => c.on('data', frameReader((kind, body) => { if (kind === F.JUMP) { asked.push(json(body).mac); c.end(frame(F.NOTE, { ok: true })); } })));
  await new Promise((r) => host.listen(sock, r));
  writeFileSync(join(home, 'background', 'demo-1.json'), JSON.stringify({ name: 'demo-1', pid: process.pid, socket: sock, viewers: 1, local: 1 }));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ lastMac: 'server-1', macs: ['server-1', 'old-mac'] }));
  const ts = join(base, 'tailscale.json');
  writeFileSync(ts, JSON.stringify({ Self: { DNSName: 'mac-mini.example.ts.net.', OS: 'macOS' }, Peer: {
    a: { DNSName: 'server-1.example.ts.net.', OS: 'macOS', Online: true },
    b: { DNSName: 'mac-studio.example.ts.net.', OS: 'macOS', Online: false, LastSeen: new Date(Date.now() - 2 * 3600_000).toISOString() },
  } }));
  const open = [{ type: '/jumptomac' }, { key: 'enter' }, { wait: 'Tailscale sees', ms: 10_000 }, { sleep: 250 }];
  try {
    const r = await runInPty({ cwd, env: { ...env, AGENTIC_MODEL_AT_START: 'off', AGENTIC_IN_HOST: 'demo-1', AGENTIC_TAILSCALE_STATUS: ts }, args: ['--no-flows'], timeoutMs: 80_000, steps: [
      { wait: '? for shortcuts' }, { sleep: 300 },
      ...open, { snapshot: 'box' },
      // old-mac: saved, not on Tailscale. ⌫ asks, ⌫ again forgets.
      { key: 'down' }, { sleep: 120 }, { key: '\x7f' }, { sleep: 250 }, { snapshot: 'asking' },
      { key: '\x7f' }, { wait: 'Forgot old-mac' }, { sleep: 250 }, { snapshot: 'forgot' },
      // mac-studio: offline on Tailscale, so enter says so instead of jumping.
      { key: 'down' }, { sleep: 120 }, { key: 'enter' }, { wait: 'offline on Tailscale' }, { sleep: 250 }, { snapshot: 'offline' },
      // + Add a Mac, a new name, enter: that Mac is asked for.
      ...open, { key: 'down' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: 'enter' }, { sleep: 150 }, { type: 'mac-pro' }, { sleep: 250 }, { snapshot: 'adding' },
      { key: 'enter' }, { wait: 'Jumping to mac-pro' }, { sleep: 200 },
      // enter enter: the Mac used last.
      ...open, { key: 'enter' }, { wait: 'Jumping to server-1' }, { sleep: 200 },
      // esc: nothing asked.
      ...open, { key: 'esc' }, { wait: 'Stayed here.' }, { sleep: 200 }, { snapshot: 'stayed' },
      ...quit,
    ] });
    const s = r.snapshots;
    expect(s.box).toMatch(/Jump to a Mac\s+from mac-mini/);
    expect(s.box).toMatch(/❯ server-1\s+● online · saved · used last/);
    expect(s.box).toMatch(/old-mac\s+not on this Tailscale network · saved/);
    expect(s.box).toMatch(/mac-studio\s+○ offline · Tailscale last saw it 2 h ago · on Tailscale, not saved/);
    expect(s.box).toContain('+ Add a Mac');
    expect(s.box).toContain('ⓘ  Tailscale sees 2 other Macs here: server-1, mac-studio (mac-studio offline)');
    expect(s.box).toContain('enter jumps · ↑↓ choose · ⌫ forgets a saved Mac · esc cancels');
    expect(s.asking).toContain('Forget old-mac? ⌫ again forgets it · any other key keeps it');
    expect(flat(s.forgot)).toContain('Forgot old-mac: /jumptomac no longer lists it as saved.');
    expect(s.forgot).not.toMatch(/old-mac\s+not on this Tailscale/);
    expect(flat(s.offline)).toContain('mac-studio is offline on Tailscale (it last saw it 2 h ago). Wake it, or check Tailscale there, then /jumptomac again.');
    expect(s.adding).toMatch(/❯ \+ Add a Mac\s+mac-pro/);
    expect(s.stayed).toContain('Stayed here.');
    expect(asked).toEqual(['mac-pro', 'server-1']); // the offline Mac and esc asked for nothing
    expect(settingsOf(base).macs).toEqual(['server-1']);
  } finally { host.close(); }
}, T);
