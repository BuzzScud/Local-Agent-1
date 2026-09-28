// How much memory the Mac can give the model right now, and which context
// size fits: 32k by default, 16k when memory is short (and we say why).
import { execFileSync } from 'node:child_process';

// vm_stat's counts, in bytes, by label ("Pages free").
function vmStat() {
  const out = execFileSync('vm_stat', { encoding: 'utf8' });
  const page = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 16384);
  return (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0) * page;
}
const freeOf = (get) => get('Pages free') + get('Pages inactive') + get('Pages speculative') + get('Pages purgeable');

export function availableBytes() {
  return freeOf(vmStat());
}

// The Mac's memory as Activity Monitor shows it, for the welcome box and the
// footer: the whole of it, what is free for a model (as above), what macOS
// has compressed, the swap in use, and the pressure (1 fine, 2 tight, 4
// critical: Activity Monitor's green, yellow, red). null when it can't be read.
export function macMemory() {
  try {
    const [total, swap, level] = execFileSync('sysctl', ['-n', 'hw.memsize', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8' }).trim().split('\n');
    const get = vmStat();
    const s = /used = ([\d.]+)([KMG])/.exec(swap);
    return {
      total: Number(total),
      avail: freeOf(get),
      compressed: get('Pages occupied by compressor'),
      swapUsed: s ? Number(s[1]) * { K: 2 ** 10, M: 2 ** 20, G: 2 ** 30 }[s[2]] : 0,
      level: Number(level) || 1,
    };
  } catch { return null; }
}

// Activity Monitor's gigabytes (2^30 bytes), which is what "16 GB" means on a Mac.
export const gib = (b) => b / 2 ** 30;

// 8-bit KV cache (34 bytes per 32 values), only in the layers that keep one.
export const kvBytesPerToken = (m) => m.attnLayers * m.kvHeads * m.headDim * 2 * (34 / 32);
// Working space the server takes on top of the model file, the cache, the
// running state and its checkpoints. Measured 2026-09-24 (27B, 13 prompts):
// footprint 2.08 GB at 32k = 1.14 cache + 0.16 running state + 0.63 for 4
// checkpoints + ~0.15; 1.53 GB at 16k.
export const OVERHEAD = 0.15e9;

// The guessing helper (model.draft): its file, its working space, and per slot
// nMax extra copies of the running state so a wrong guess can be taken back.
export const draftBytes = (m) => (m.draft ? m.draft.bytes + m.draft.computeBytes + (m.slots ?? 1) * m.draft.nMax * (m.fixedStateBytes ?? 0) : 0);

// Each slot has its own running state and checkpoints; the cache is shared.
// The helper is counted whenever the model has one (coding setup fetches it)
// unless it is switched off with AGENTIC_HELPER=off.
export const needBytes = (m, ctx, { draft = Boolean(m.draft) && (process.env.AGENTIC_HELPER ?? process.env.BONSAI_HELPER) !== 'off' } = {}) => m.bytes + kvBytesPerToken(m) * ctx + (m.slots ?? 1) * ((m.fixedStateBytes ?? 0) + (m.checkpoints ?? 0) * (m.checkpointBytes ?? 0)) + (draft ? draftBytes(m) : 0) + OVERHEAD;

// effort 'high': the model mostly thinks, which the guessing helper barely
// speeds up, so when memory is short the helper (1.84 GB) goes before the
// memory does — dropping 32k to 16k would only save ~0.6 GB (the per-token
// cache is small; the model file and running state are not). Measured on the
// chart bug 25 Sep: High at 16k lost its trail; the helper was idle.
// A helper that speeds up thinking too (Gemma's MTP, helpsThinking) is
// counted like any other part and stays on.
// The app a process belongs to, for the note below: a browser's helpers count
// as the browser ("…/Google Chrome.app/…/Google Chrome Helper" → "Google
// Chrome"); anything outside an app by its program's name.
export function appName(comm) {
  const app = /\/([^/]+)\.app\//.exec(comm)?.[1];
  const name = app ?? comm.trim().split('/').pop();
  return name === 'llama-server' ? 'model servers' : name;
}

// What uses the most memory right now, by app, biggest first: named in the
// note when a model does not fit. psText: `ps -Ao rss=,comm=` (tests pass their own).
export function topMemoryUsers(n = 3, psText = null) {
  let out = psText;
  if (out == null) { try { out = execFileSync('/bin/ps', ['-Ao', 'rss=,comm='], { encoding: 'utf8' }); } catch { return []; } }
  const byApp = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const name = appName(m[2]);
    byApp.set(name, (byApp.get(name) ?? 0) + Number(m[1]) * 1024);
  }
  return [...byApp].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, n);
}

// The check for a context you picked (/increase or --ctx), at every start and
// restart: it is used as asked, and when it does not fit the note says by how
// much and what is using the memory (the user's pick, 28 Sep: start anyway,
// say so). draft: whether the speed helper comes along (needBytes' own
// default when left out).
export function contextCheck(m, ctx, { draft, available = availableBytes(), users } = {}) {
  const need = needBytes(m, ctx, { draft });
  const gb = (b) => (b / 1e9).toFixed(1);
  const size = `Context ${Math.round(ctx / 1024)}k`;
  if (available >= need) return { fits: true, need, available, note: `${size}: needs ${gb(need)} GB, ${gb(available)} GB free.` };
  const top = (users ?? topMemoryUsers(3)).map((u) => `${u.name} ${gb(u.bytes)} GB`).join(' · ');
  return { fits: false, need, available, note: `${size} needs ${gb(need)} GB and ${gb(available)} GB is free: the Mac may slow down.${top ? ` Using the most: ${top}.` : ''} Close some, or lower it in /increase.` };
}

export function chooseContext(m, { want = 32_768, floor = 16_384, available = availableBytes(), effort } = {}) {
  const gb = (b) => (b / 1e9).toFixed(1);
  const kb = (c) => `${Math.round(c / 1024)}k`;
  if (available >= needBytes(m, want)) return { ctx: want, available, reason: null };
  if (effort === 'high' && m.draft && !m.draft.helpsThinking && (process.env.AGENTIC_HELPER ?? process.env.BONSAI_HELPER) !== 'off') {
    if (available >= needBytes(m, want, { draft: false })) {
      return { ctx: want, helper: false, available, reason: `${gb(available)} GB free: High effort keeps ${kb(want)} of memory and leaves the speed helper off (with it, ${kb(want)} needs ${gb(needBytes(m, want))} GB)` };
    }
    return { ctx: floor, helper: false, available, reason: `${gb(available)} GB free, so using ${kb(floor)} without the speed helper (${gb(needBytes(m, floor, { draft: false }))} GB); close other apps, such as the desk servers, to give it more room` };
  }
  return {
    ctx: floor,
    available,
    reason: available < needBytes(m, floor)
      ? `${gb(available)} GB free, so using 16k (needs ${gb(needBytes(m, floor))} GB); close other apps, such as the desk servers, to keep it fast`
      : `${gb(available)} GB free, so using 16k (${gb(needBytes(m, floor))} GB) instead of 32k (${gb(needBytes(m, want))} GB)`,
  };
}
