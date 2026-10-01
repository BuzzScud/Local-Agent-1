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

// 8-bit KV cache (34 bytes per 32 values), only in the layers that keep one. A model whose memory does
// not grow with the context (constantState: Bonsai 2 27B ConstantKV) keeps nothing a token: its fixed
// state is its stateBytes.
export const kvBytesPerToken = (m) => (m.constantState ? 0 : m.attnLayers * m.kvHeads * m.headDim * 2 * (34 / 32));
// Working space the server takes on top of the model file, the cache, the
// running state and its checkpoints. Measured 2026-09-24 (27B, 13 prompts):
// footprint 2.08 GB at 32k = 1.14 cache + 0.16 running state + 0.63 for 4
// checkpoints + ~0.15; 1.53 GB at 16k.
export const OVERHEAD = 0.15e9;

// How much of a model's files a start takes out of the free memory
// (availableBytes): macOS keeps only part of a running model's file pages in
// active use, and the rest stay on its inactive list, which counts as free.
// fileInUse in model.mjs is that share, measured; a model not measured counts
// its whole file.
const filePart = (m, bytes) => bytes * (m.fileInUse ?? 1);

// The guessing helper (model.draft): its file, its working space, and per slot
// nMax extra copies of the running state so a wrong guess can be taken back.
export const draftBytes = (m) => (m.draft ? filePart(m, m.draft.bytes) + m.draft.computeBytes + (m.slots ?? 1) * m.draft.nMax * (m.fixedStateBytes ?? 0) : 0);

// What starting the model takes out of the free memory: its files (the share
// in use), the cache, each slot's running state and checkpoints (the cache is
// shared), a server's own fixed state (stateBytes, once), the helper, the working space. The helper is counted whenever the
// model has one (coding setup fetches it) unless it is switched off with AGENTIC_HELPER=off.
export const needBytes = (m, ctx, { draft = Boolean(m.draft) && (process.env.AGENTIC_HELPER ?? process.env.BONSAI_HELPER) !== 'off' } = {}) => filePart(m, m.bytes) + kvBytesPerToken(m) * ctx + (m.slots ?? 1) * ((m.fixedStateBytes ?? 0) + (m.checkpoints ?? 0) * (m.checkpointBytes ?? 0)) + (m.stateBytes ?? 0) + (draft ? draftBytes(m) : 0) + visionBytes(m) + OVERHEAD;
// The vision add-on, when the model is loaded with it (withVision): its file, whole, and its working space.
export const visionBytes = (m) => (m?.visionOn && m.vision ? m.vision.bytes + (m.vision.computeBytes ?? 0) : 0);

// Free memory for a start that first stops a running model server (an
// /effort restart, a copy kept loaded at another size): what is free now plus
// what that server's start took, counted BEFORE it stops. Measured right after
// it exits, macOS had handed back little of it yet: on 29 Sep Qwen3.5 9B,
// restarted from 64k to 32k, saw 3.9 GB free and took only 0.6 GB of it, so
// every /effort restart warned although nothing was short.
export const freeWithHandBack = (m, ctx, { draft = false, available = availableBytes() } = {}) => available + needBytes(m, ctx, { draft });

// Free memory after model servers quit that were running a moment ago (the copy a start waited
// for, and anything that quit with it): what was free while they ran plus what they held. The
// same lag as above: on 29 Sep a window waited for another Qwen3.5 9B copy and its two search
// servers (8.6 GB), loaded the moment they were stopped, saw 4.8 GB free and warned that the Mac
// may slow down, with pressure green. before: { free, servers: [{ pid, bytes }] }, a look while
// they still ran; now: the servers running now. 0 when none of them quit.
export function freeAfterQuit(before, now) {
  const running = new Set(now.map((s) => s.pid));
  const back = (before?.servers ?? []).filter((s) => !running.has(s.pid)).reduce((sum, s) => sum + s.bytes, 0);
  return back ? before.free + back : 0;
}

// What a search model (the embedder, the reranker) holds while loaded: its
// measured loadedBytes (model.mjs), else its file and the working space.
export const loadedBytesOf = (m) => m.loadedBytes ?? m.bytes + OVERHEAD;

// The search models that are on but not loaded yet: each starts at the first
// search, beside the model, so a start counts them too. One already loaded is
// in what the Mac uses now. isLoaded(model) says which are.
export const searchBytes = (models, isLoaded) => models.filter((m) => m && !isLoaded(m)).reduce((n, m) => n + loadedBytesOf(m), 0);

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

// The check for a context you picked (/effort or --ctx), at every start and
// restart: it is used as asked, and when it does not fit the note says by how
// much and what is using the memory (the user's pick, 28 Sep: start anyway,
// say so). draft: whether the speed helper comes along (needBytes' own
// default when left out). search: the search models still to load (searchBytes).
export function contextCheck(m, ctx, { draft, available = availableBytes(), users, search = 0 } = {}) {
  const need = needBytes(m, ctx, { draft }) + search;
  const gb = (b) => (b / 1e9).toFixed(1);
  const size = `Context ${Math.round(ctx / 1024)}k`;
  const needs = `${gb(need)} GB${search ? ` (${gb(search)} for search)` : ''}`;
  if (available >= need) return { fits: true, need, available, note: `${size}: needs ${needs}, ${gb(available)} GB free.` };
  const top = (users ?? topMemoryUsers(3)).map((u) => `${u.name} ${gb(u.bytes)} GB`).join(' · ');
  return { fits: false, need, available, note: `${size} needs ${needs} and ${gb(available)} GB is free: the Mac may slow down.${top ? ` Using the most: ${top}.` : ''} Close some, or lower it in /effort.` };
}

// A model's own sizes win (ctxWant, ctxFloor): one whose memory does not grow starts at its want, and a
// smaller context would save nothing, so its floor is the same.
export function chooseContext(m, { want = m?.ctxWant ?? 32_768, floor = m?.ctxFloor ?? 16_384, available = availableBytes(), effort } = {}) {
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
      ? `${gb(available)} GB free, so using ${kb(floor)} (needs ${gb(needBytes(m, floor))} GB); close other apps, such as the desk servers, to keep it fast`
      : `${gb(available)} GB free, so using ${kb(floor)} (${gb(needBytes(m, floor))} GB) instead of ${kb(want)} (${gb(needBytes(m, want))} GB)`,
  };
}
