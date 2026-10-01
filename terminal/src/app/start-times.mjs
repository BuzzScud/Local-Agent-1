// How long the model takes to start on this Mac, kept to say how long the next start will take
// (the start page's "about 12 s left", 1 Oct 2026). A start has two timed parts: loading the model
// (only when a new server starts, not when one is already loaded), then reading its instructions
// (the first time) or restoring them from disk (later starts). The last five of each part are
// kept per model, with the kind the last start had, since that is the likeliest next.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HOME } from '../../../models/index.mjs';

export const TIMES_FILE = () => join(HOME, 'start-times.json');
const KEEP = 5;

export function loadTimes(file = TIMES_FILE()) {
  try { return JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { return {}; }
}
// part: 'load' | 'read' | 'restore'.
export function saveTime(id, part, secs, file = TIMES_FILE()) {
  if (!id || !(secs >= 0) || !Number.isFinite(secs)) return;
  const all = loadTimes(file);
  const t = all[id] ?? {};
  t[part] = [...(t[part] ?? []), Math.round(secs * 10) / 10].slice(-KEEP);
  if (part !== 'load') t.last = part;
  all[id] = t;
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(all, null, 2)); } catch {}
}
export function median(xs = []) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// What the start that is running now has left, from its phase and how long each part has run:
// { left, done } (done: 0–1 of the whole start), or null while it waits for memory or when this
// model has no start on record yet. sinceLoad / sinceWarm: seconds since each part began.
export function startLeft(times, { phase, cold = true, sinceLoad = 0, sinceWarm = 0 }) {
  if (!times || phase === 'waiting' || phase === 'connecting') return null;
  const load = cold ? median(times.load) : 0;
  const warmKind = phase === 'restoring' ? 'restore' : phase === 'reading' ? 'read' : (times.last ?? 'read');
  const warm = median(times[warmKind]);
  if (load == null || warm == null) return null;
  const inLoad = phase === 'loading';
  const left = inLoad ? Math.max(0, load - sinceLoad) + warm : Math.max(0, warm - sinceWarm);
  const spent = inLoad ? sinceLoad : load + sinceWarm;
  const over = inLoad ? sinceLoad > load + 1 : sinceWarm > warm + 1;
  return { left: over ? 0 : left, done: Math.min(1, spent / Math.max(0.1, spent + left)), over };
}
// A whole start as it usually goes: loading plus the last kind of reading.
export function typicalStart(times) {
  const load = median(times?.load), warm = median(times?.[times?.last ?? 'read']);
  return load == null || warm == null ? null : load + warm;
}
