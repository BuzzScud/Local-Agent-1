// /jumptomac alone: "Jump to a Mac", a small box (Design 2 of docs/design rounds/
// agentic-coder-jumptomac-saved-macs-2-designs-2026-10-03.html, the owner's pick, 3 Oct 2026). Your saved
// Macs first (the one gone to last on top, so /jumptomac enter enter jumps there), then the Macs Tailscale
// sees that are not saved, then "+ Add a Mac" (its name typed in the box). Each says whether Tailscale has
// it online. enter jumps (an offline Mac says so instead of waiting for a door that cannot answer), ⌫ on a
// saved Mac asks once, then forgets it. Pure: the app draws what this returns and acts on what jumpKey says.
export const MAC_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;

// The box as it opens. saved: savedMacs() (door.mjs); last: the Mac gone to last; ts: tailscaleMacs()
// once read (undefined while it is read, null when Tailscale does not answer).
export const openJumpBox = ({ saved = [], last = null, here = '' } = {}) => ({ kind: 'jump', saved, last, here, ts: undefined, index: 0, asking: null, adding: null });

// The rows, in order: { name, saved } for a saved Mac, { name, seen } for one only Tailscale knows, { add }.
export function jumpRows(box) {
  const seen = (box.ts?.macs ?? []).filter((m) => !box.saved.includes(m.name)).map((m) => ({ name: m.name, seen: true }));
  return [...box.saved.map((name) => ({ name, saved: true })), ...seen, { add: true, name: '+ Add a Mac' }];
}

// How long ago, in words, for "Tailscale last saw it 2 h ago".
export function agoWords(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

// What Tailscale says of a Mac: { online, lastSeen } when it lists it, null when it does not (or is not read yet).
const tsOf = (box, name) => (box.ts?.macs ?? []).find((m) => m.name === name) ?? null;

// A Mac's row after its name, as pieces: [{ text, tone }] (tone: on, off, dim).
export function rowStatus(box, row, now = Date.now()) {
  if (row.add) return box.adding !== null ? [{ text: 'its Tailscale name · enter tries it · esc stops', tone: 'dim' }] : [{ text: 'its Tailscale name · it needs coding door on there', tone: 'dim' }];
  const t = tsOf(box, row.name);
  const where = t ? (t.online ? [{ text: '● online', tone: 'on' }] : [{ text: '○ offline', tone: 'off' }, ...(agoWords(t.lastSeen, now) ? [{ text: ` · Tailscale last saw it ${agoWords(t.lastSeen, now)}`, tone: 'dim' }] : [])])
    : box.ts === undefined ? [{ text: '…', tone: 'dim' }] : [{ text: 'not on this Tailscale network', tone: 'dim' }];
  const tail = row.seen ? ' · on Tailscale, not saved' : ` · saved${row.name === box.last ? ' · used last' : ''}`;
  return [...where, { text: tail, tone: 'dim' }];
}

// The line under the rows: what Tailscale sees, or the question before forgetting a Mac.
export function jumpInfo(box) {
  if (box.asking) return { text: `Forget ${box.asking}? ⌫ again forgets it · any other key keeps it`, tone: 'warn' };
  if (box.ts === undefined) return { text: 'Asking Tailscale which Macs are online…', tone: 'dim' };
  if (box.ts === null) return { text: 'Tailscale did not answer here, so online or not is unknown. The door needs Tailscale on both Macs.', tone: 'warn' };
  const n = box.ts.macs.length;
  const off = box.ts.macs.filter((m) => !m.online).map((m) => m.name);
  return { text: n ? `Tailscale sees ${n} other Mac${n === 1 ? '' : 's'} here: ${box.ts.macs.map((m) => m.name).join(', ')}${off.length ? ` (${off.join(', ')} offline)` : ''}` : 'Tailscale sees no other Mac here.', tone: 'dim' };
}

// One key: { box } with the box as it is now, plus an act for the app: { jump: name }, { offline: name, ago },
// { forget: name }, { close: true }, or { bad: text } (a name that cannot be a Mac's).
// key: Ink's key object; ch: the letter typed.
export function jumpKey(box, ch, key) {
  const rows = jumpRows(box);
  const row = rows[Math.min(box.index, rows.length - 1)];
  if (box.adding !== null) {
    if (key.escape) return { box: { ...box, adding: null } };
    if (key.return) {
      const name = box.adding.trim();
      if (!name) return { box };
      if (!MAC_NAME.test(name)) return { box, bad: `"${name}" is not a Mac’s name: letters, digits, dots and hyphens (its Tailscale name, like server-1).` };
      return { box: { ...box, adding: null }, jump: name };
    }
    if (key.backspace || key.delete) return { box: { ...box, adding: box.adding.slice(0, -1) } };
    if (ch && !key.ctrl && !key.meta && ch >= ' ') return { box: { ...box, adding: (box.adding + ch).replace(/\s+/g, '').slice(0, 63) } };
    return { box };
  }
  if (box.asking) {
    if ((key.backspace || key.delete) && row?.name === box.asking) return { box: { ...box, asking: null, saved: box.saved.filter((m) => m !== row.name), index: 0 }, forget: row.name };
    return { box: { ...box, asking: null } };
  }
  if (key.upArrow) return { box: { ...box, index: Math.max(0, box.index - 1) } };
  if (key.downArrow || key.tab) return { box: { ...box, index: Math.min(rows.length - 1, box.index + 1) } };
  if (key.escape || (key.ctrl && ch === 'c')) return { box, close: true };
  if ((key.backspace || key.delete) && row?.saved) return { box: { ...box, asking: row.name } };
  if (key.return) {
    if (row.add) return { box: { ...box, adding: '' } };
    const t = tsOf(box, row.name);
    if (t && !t.online) return { box, offline: row.name, ago: agoWords(t.lastSeen) };
    return { box, jump: row.name };
  }
  // Typing on "+ Add a Mac" starts its name.
  if (row?.add && ch && !key.ctrl && !key.meta && /[A-Za-z0-9]/.test(ch)) return { box: { ...box, adding: ch } };
  return { box };
}
