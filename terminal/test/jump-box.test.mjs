// /jumptomac alone: the "Jump to a Mac" box (jump-box.mjs) and the saved Macs and Tailscale's list behind it
// (door.mjs). No app, no network: Tailscale is the file AGENTIC_TAILSCALE_STATUS names.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJumpBox, jumpRows, rowStatus, jumpInfo, jumpKey, agoWords } from '../src/app/jump-box.mjs';

const { savedMacs, forgetMac, tailscaleMacs } = await import('../src/app/door.mjs');
const { saveSettings, loadSettings } = await import('../src/app/store.mjs');
const NOW = Date.parse('2026-10-03T22:00:00Z');
const K = (o = {}) => ({ upArrow: false, downArrow: false, return: false, escape: false, backspace: false, delete: false, tab: false, ctrl: false, meta: false, ...o });
const text = (parts) => parts.map((p) => p.text).join('');
const TS = { self: 'mac-mini', macs: [{ name: 'server-1', online: true, lastSeen: null }, { name: 'mac-studio', online: false, lastSeen: '2026-10-03T20:00:00Z' }] };

test('the rows: saved Macs first (the one gone to last on top), then the ones only Tailscale sees, then + Add a Mac; each says what Tailscale says', () => {
  const box = { ...openJumpBox({ saved: ['server-1'], last: 'server-1', here: 'mac-mini' }), ts: TS };
  expect(jumpRows(box).map((r) => r.name)).toEqual(['server-1', 'mac-studio', '+ Add a Mac']);
  const [one, studio, add] = jumpRows(box);
  expect(text(rowStatus(box, one, NOW))).toBe('● online · saved · used last');
  expect(text(rowStatus(box, studio, NOW))).toBe('○ offline · Tailscale last saw it 2 h ago · on Tailscale, not saved');
  expect(text(rowStatus(box, add, NOW))).toBe('its Tailscale name · it needs coding door on there');
  expect(jumpInfo(box)).toEqual({ text: 'Tailscale sees 2 other Macs here: server-1, mac-studio (mac-studio offline)', tone: 'dim' });
  // before Tailscale answers, and when it does not
  const asking = openJumpBox({ saved: ['server-1'], last: 'server-1' });
  expect(text(rowStatus(asking, jumpRows(asking)[0], NOW))).toBe('… · saved · used last');
  expect(jumpInfo(asking).text).toBe('Asking Tailscale which Macs are online…');
  expect(jumpInfo({ ...asking, ts: null }).tone).toBe('warn');
  expect(text(rowStatus({ ...asking, ts: { self: 'x', macs: [] } }, jumpRows(asking)[0], NOW))).toBe('not on this Tailscale network · saved · used last');
  expect([agoWords('2026-10-03T21:59:40Z', NOW), agoWords('2026-10-03T21:30:00Z', NOW), agoWords('2026-09-30T22:00:00Z', NOW), agoWords(null)]).toEqual(['just now', '30 min ago', '3 days ago', null]);
});

test('the keys: enter jumps (an offline Mac says so instead), ↑↓ stop at the ends, ⌫ asks once then forgets, + Add a Mac takes a name, esc closes', () => {
  let box = { ...openJumpBox({ saved: ['server-1'], last: 'server-1' }), ts: TS };
  expect(jumpKey(box, '', K({ return: true })).jump).toBe('server-1'); // /jumptomac enter enter
  expect(jumpKey(box, '', K({ upArrow: true })).box.index).toBe(0);
  box = jumpKey(box, '', K({ downArrow: true })).box; // mac-studio, offline
  expect(jumpKey(box, '', K({ return: true }))).toMatchObject({ offline: 'mac-studio' });
  expect(jumpKey(box, '', K({ backspace: true })).box.asking).toBe(null); // not saved: nothing to forget
  box = jumpKey(jumpKey(box, '', K({ downArrow: true })).box, '', K({ downArrow: true })).box;
  expect(jumpRows(box)[box.index].add).toBe(true); // stops at the last row
  // + Add a Mac: enter, then a name; a bad one is said, a good one jumps
  box = jumpKey(box, '', K({ return: true })).box;
  expect(box.adding).toBe('');
  for (const ch of 'mac pro') box = jumpKey(box, ch, K()).box;
  expect(box.adding).toBe('macpro'); // no spaces in a name
  expect(jumpKey(box, '', K({ return: true }))).toMatchObject({ jump: 'macpro' });
  expect(jumpKey({ ...box, adding: '-bad' }, '', K({ return: true })).bad).toContain('is not a Mac’s name');
  expect(jumpKey(box, '', K({ escape: true })).box.adding).toBe(null);
  // typing on + Add a Mac starts the name
  expect(jumpKey({ ...box, adding: null }, 'm', K()).box.adding).toBe('m');
  // ⌫ on a saved Mac: asked, then forgotten; any other key keeps it
  let saved = { ...openJumpBox({ saved: ['server-1', 'mac-studio'], last: 'server-1' }), ts: TS };
  saved = jumpKey(saved, '', K({ backspace: true })).box;
  expect(saved.asking).toBe('server-1');
  expect(jumpInfo(saved)).toEqual({ text: 'Forget server-1? ⌫ again forgets it · any other key keeps it', tone: 'warn' });
  expect(jumpKey(saved, 'x', K()).box.asking).toBe(null);
  const gone = jumpKey(saved, '', K({ backspace: true }));
  expect(gone.forget).toBe('server-1');
  expect(gone.box.saved).toEqual(['mac-studio']);
  expect(jumpKey(saved, '', K({ escape: true })).close).toBe(undefined); // esc while asking only keeps it
  expect(jumpKey({ ...saved, asking: null }, '', K({ escape: true })).close).toBe(true);
});

test('saved Macs: a Mac gone to before the list existed counts as saved; forgetting writes the list, and the Mac gone to last is no longer saved by itself', () => {
  saveSettings({ lastMac: 'server-1', macs: undefined });
  expect(savedMacs()).toEqual(['server-1']);
  saveSettings({ macs: ['mac-studio', 'server-1'] });
  expect(savedMacs()).toEqual(['server-1', 'mac-studio']); // the one gone to last first
  forgetMac('server-1');
  expect(loadSettings().macs).toEqual(['mac-studio']);
  expect(savedMacs()).toEqual(['mac-studio']);
  saveSettings({ macs: ['ok-name', '../bad', 7] });
  expect(savedMacs()).toEqual(['ok-name']);
});

test('Tailscale’s list: other Macs only, by the name coding attach takes, online and when last seen; null when it does not answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-'));
  const file = join(dir, 'status.json');
  writeFileSync(file, JSON.stringify({
    Self: { DNSName: 'christians-mac-mini.example.ts.net.', OS: 'macOS' },
    Peer: {
      a: { DNSName: 'server-1.example.ts.net.', HostName: 'Server 1', OS: 'macOS', Online: true, LastSeen: '0001-01-01T00:00:00Z' },
      b: { DNSName: 'mac-studio.example.ts.net.', OS: 'macOS', Online: false, LastSeen: '2026-10-03T20:00:00Z' },
      c: { DNSName: 'phone.example.ts.net.', OS: 'iOS', Online: true },
      d: { DNSName: 'droplet.example.ts.net.', OS: 'linux', Online: true },
    },
  }));
  const before = process.env.AGENTIC_TAILSCALE_STATUS;
  process.env.AGENTIC_TAILSCALE_STATUS = file;
  try {
    expect(await tailscaleMacs()).toEqual({ self: 'christians-mac-mini', macs: [{ name: 'server-1', online: true, lastSeen: null }, { name: 'mac-studio', online: false, lastSeen: '2026-10-03T20:00:00Z' }] });
    process.env.AGENTIC_TAILSCALE_STATUS = join(dir, 'missing.json');
    expect(await tailscaleMacs()).toBe(null);
  } finally {
    if (before === undefined) delete process.env.AGENTIC_TAILSCALE_STATUS; else process.env.AGENTIC_TAILSCALE_STATUS = before;
  }
});
