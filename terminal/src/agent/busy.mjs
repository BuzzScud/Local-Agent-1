// A service that says "too many requests" (/remote): the window waits and asks again, up to
// BUSY_TRIES times in all, instead of stopping the task. Every window on this Mac waits with it:
// the time the service gave is written to one small file (BUSY_FILE), and a window about to ask
// the same service waits it out first, so three windows do not all knock again at once.
// Only an answer of "busy" waits: a model that does not fit, a wrong key or a conversation that
// is too long are other errors, as before.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HOME } from '../../../models/index.mjs';

export const BUSY_TRIES = 5;
// Seconds before each next try (the service's own "retry after" wins when it asks for longer).
export const BUSY_WAITS = [10, 20, 40, 60];
// AGENTIC_BUSY_WAITS="0.1,0.1,0.1,0.1" makes them short (the tests); read at each use.
const busyWaits = () => { const w = process.env.AGENTIC_BUSY_WAITS?.split(',').map(Number).filter((n) => n >= 0); return w?.length ? w : BUSY_WAITS; };
const BUSY_STATUS = new Set([429, 503, 529]);
// The longest single wait (seconds) a service may ask for.
export const LONGEST_WAIT = 120;

// In Agentic Coder's home (AGENTIC_HOME, read at each use, so a test's own home holds it).
export const busyFile = () => join(process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME ?? HOME, 'remote-busy.json');

// The service said it is busy: a 429 (too many requests), 503 or 529 (overloaded), or those
// words. A model that has no room to load is not busy: waiting does not make it fit.
export function isBusy(e) {
  if (!e || e.busy === false) return false;
  if (/no room to load|out of (GPU )?memory/i.test(e.message ?? '')) return false;
  return BUSY_STATUS.has(e.status) || /rate.?limit|too many requests|overloaded/i.test(e.message ?? '');
}

// The seconds the service asked to wait: its Retry-After (seconds or a date), else "try again in N s".
export function retryAfterOf(e) {
  if (Number.isFinite(e?.retryAfter)) return e.retryAfter;
  const m = /(?:try again|retry) (?:in|after) (\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?)\b/i.exec(e?.message ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return /^ms|^milli/i.test(m[2]) ? n / 1000 : /^m/i.test(m[2]) ? n * 60 : n;
}
// A Retry-After header value as seconds (null when absent or unreadable).
export function retryAfterHeader(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.max(0, (t - now) / 1000) : null;
}

const readAll = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { return {}; } };
// Until when the service `key` asked every window to wait (ms since 1970; 0 when it did not).
export function sharedUntil(key, { file = busyFile(), now = Date.now() } = {}) {
  const t = Number(readAll(file)[key]) || 0;
  return t > now ? t : 0;
}
// Tells the other windows: `key` is busy until `until`. Old entries are dropped; a later time wins.
export function markBusy(key, until, { file = busyFile(), now = Date.now() } = {}) {
  const all = Object.fromEntries(Object.entries(readAll(file)).filter(([, t]) => Number(t) > now));
  all[key] = Math.max(Number(all[key]) || 0, until);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, file);
  } catch { /* the other windows only wait less */ }
}

// Waits `ms`, or less when the signal stops it.
export const pause = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

// The reply from make() (a stream of events), asked again while the service says it is busy.
// Before any try, a wait another window was told about is waited out. While it waits it yields
// { type: 'busy', waitMs, next, of, shared }: next = the try about to come, of = BUSY_TRIES.
// A reply that had begun is never asked again (its words are already on the screen).
export async function* withBusyRetry(make, { key, signal, file = busyFile(), waits = busyWaits(), tries = BUSY_TRIES } = {}) {
  for (let n = 1; ; n++) {
    const until = sharedUntil(key, { file });
    // (a wait this window set itself has just ended; only a later one from another window counts)
    if (until - Date.now() > 250) {
      yield { type: 'busy', waitMs: until - Date.now(), next: n, of: tries, shared: true };
      await pause(until - Date.now(), signal);
      if (signal?.aborted) return;
    }
    let started = false;
    try {
      for await (const ev of make()) { started = true; yield ev; }
      return;
    } catch (e) {
      if (started || signal?.aborted || !isBusy(e)) throw e;
      if (n >= tries) {
        const secs = waits.slice(0, tries - 1).reduce((a, b) => a + b, 0);
        throw Object.assign(new Error(`The service stayed busy (${tries} tries over about ${Math.max(1, Math.round(secs / 60))} min). Nothing was lost: press ↑ then enter to try again, or /remote to pick another service.`), { status: e.status, busy: true, cause: e });
      }
      // A service that asks for more than LONGEST_WAIT (a quota for the day, say) is not waited for.
      const asked = retryAfterOf(e) ?? 0;
      if (asked > LONGEST_WAIT) throw Object.assign(new Error(`The service is busy and asked to wait ${asked >= 120 ? `${Math.round(asked / 60)} minutes` : `${Math.round(asked)} s`}, which is too long to wait here. Nothing was lost: press ↑ then enter to try again later, or /remote to pick another service.`), { status: e.status, busy: true, cause: e });
      // (plus up to a second at random, so windows told at once do not all ask again at once)
      const base = Math.max(asked, waits[Math.min(n - 1, waits.length - 1)]);
      const waitMs = Math.round((base + Math.random() * Math.min(1, base / 4)) * 1000);
      markBusy(key, Date.now() + waitMs, { file });
      yield { type: 'busy', waitMs, next: n + 1, of: tries, shared: false };
      await pause(waitMs, signal);
      if (signal?.aborted) return;
    }
  }
}
