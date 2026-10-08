// What each profile's requests did today (/profiles, 8 Oct 2026, the owner's pick of the full build):
// how many, the wait before the first word (mostly the wait in line on a busy service), the writing
// speed, how many went to the backup, and what they cost. Each window keeps one small file a day,
// profile-meters/<day>/<pid>.json in Agentic Coder's home, as the cost meter does (spend.mjs), so
// /profiles and the hub add up every window, the ones closed today too, and no two windows write
// the same file.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../../../models/index.mjs';

const metersDir = () => join(process.env.AGENTIC_HOME ?? HOME, 'profile-meters');
const dayOf = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

let mine = { day: null, profiles: {} };
let timer = null;

const entry = (name, now) => {
  const day = dayOf(now);
  if (mine.day !== day) mine = { day, profiles: {} };
  return (mine.profiles[name] ??= { n: 0, waitSum: 0, waitN: 0, waitLast: null, tpsLast: null, spills: 0, usd: 0, at: 0 });
};
// A request of this profile's that went to its backup (counted on it, not on the backup).
export function noteSpill(name, { dir = metersDir(), pid = process.pid, now = new Date() } = {}) {
  if (!name) return;
  entry(name, now).spills++;
  schedule(dir, pid);
}
// One request served for a profile: waitS (seconds to its first word), tps (words a second, when
// known), usd (its cost, when known).
export function noteServed(name, { waitS = null, tps = null, usd = null } = {}, { dir = metersDir(), pid = process.pid, now = new Date() } = {}) {
  if (!name) return;
  const p = entry(name, now);
  p.n++;
  if (Number.isFinite(waitS)) { p.waitSum += waitS; p.waitN++; p.waitLast = waitS; }
  if (Number.isFinite(tps) && tps > 0) p.tpsLast = tps;
  if (Number.isFinite(usd)) p.usd += usd;
  p.at = now.getTime();
  schedule(dir, pid);
}
// Written at most twice a second: a long task asks hundreds of times.
function schedule(dir, pid) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; writeMine(dir, pid); }, 500);
  timer.unref?.();
}

function writeMine(dir, pid) {
  try {
    const d = join(dir, mine.day);
    mkdirSync(d, { recursive: true });
    const file = join(d, `${pid}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(mine));
    renameSync(`${file}.tmp`, file);
  } catch {}
}
// Written now (the tests, and a window closing).
export function flushMeters({ dir = metersDir(), pid = process.pid } = {}) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (mine.day) writeMine(dir, pid);
}

// Today's meters over every window: { [profile]: { n, wait (average seconds), waitLast, tps, spills, usd, at } }.
export function readMeters({ dir = metersDir(), now = new Date() } = {}) {
  const out = {};
  let files = [];
  try { files = readdirSync(join(dir, dayOf(now))).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    let d;
    try { d = JSON.parse(readFileSync(join(dir, dayOf(now), f), 'utf8')); } catch { continue; }
    for (const [name, p] of Object.entries(d?.profiles ?? {})) {
      const o = (out[name] ??= { n: 0, waitSum: 0, waitN: 0, waitLast: null, tps: null, spills: 0, usd: 0, at: 0 });
      o.n += p.n ?? 0; o.waitSum += p.waitSum ?? 0; o.waitN += p.waitN ?? 0; o.spills += p.spills ?? 0; o.usd += p.usd ?? 0;
      if ((p.at ?? 0) > o.at) { o.at = p.at; o.waitLast = p.waitLast ?? o.waitLast; o.tps = p.tpsLast ?? o.tps; }
    }
  }
  for (const o of Object.values(out)) { o.wait = o.waitN ? o.waitSum / o.waitN : null; delete o.waitSum; delete o.waitN; }
  return out;
}

// The same, read at most once a second (the /profiles panel draws often while a reply streams).
let seen = { at: 0, value: {} };
export function readMetersSoon({ now = Date.now() } = {}) {
  if (now - seen.at > 1000) seen = { at: now, value: readMeters() };
  return seen.value;
}

// One profile's meters in a few words: "12 today · wait 4 s · 48 tok/s · 1 to backup · $0.31".
export function meterWords(m) {
  if (!m?.n && !m?.spills) return 'no requests yet today';
  const secs = (s) => (s < 10 ? s.toFixed(1) : String(Math.round(s)));
  return [m.n ? `${m.n} today` : null, m.wait != null ? `wait ${secs(m.wait)} s` : null, m.tps ? `${Math.round(m.tps)} tok/s` : null, m.spills ? `${m.spills} to backup` : null, m.usd ? `$${m.usd.toFixed(2)}` : null].filter(Boolean).join(' · ');
}
