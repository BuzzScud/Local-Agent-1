// How much memory the Mac can give the model right now, and which context
// size fits: 32k by default, 16k when memory is short (and we say why).
import { execFileSync } from 'node:child_process';

export function availableBytes() {
  const out = execFileSync('vm_stat', { encoding: 'utf8' });
  const page = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 16384);
  const get = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
  return (get('Pages free') + get('Pages inactive') + get('Pages speculative') + get('Pages purgeable')) * page;
}

// 8-bit KV cache (34 bytes per 32 values), only in the layers that keep one.
export const kvBytesPerToken = (m) => m.attnLayers * m.kvHeads * m.headDim * 2 * (34 / 32);
// Working space the server takes on top of the model file, the cache, the
// running state and its checkpoints. Measured 2026-09-24 (27B, 13 prompts):
// footprint 2.08 GB at 32k = 1.14 cache + 0.16 running state + 0.63 for 4
// checkpoints + ~0.15; 1.53 GB at 16k.
export const OVERHEAD = 0.15e9;

// Each slot has its own running state and checkpoints; the cache is shared.
export const needBytes = (m, ctx) => m.bytes + kvBytesPerToken(m) * ctx + (m.slots ?? 1) * ((m.fixedStateBytes ?? 0) + (m.checkpoints ?? 0) * (m.checkpointBytes ?? 0)) + OVERHEAD;

export function chooseContext(m, { want = 32_768, floor = 16_384, available = availableBytes() } = {}) {
  if (available >= needBytes(m, want)) return { ctx: want, available, reason: null };
  const gb = (b) => (b / 1e9).toFixed(1);
  return {
    ctx: floor,
    available,
    reason: available < needBytes(m, floor)
      ? `${gb(available)} GB free, so using 16k (needs ${gb(needBytes(m, floor))} GB); close other apps, such as the desk servers, to keep it fast`
      : `${gb(available)} GB free, so using 16k (${gb(needBytes(m, floor))} GB) instead of 32k (${gb(needBytes(m, want))} GB)`,
  };
}
