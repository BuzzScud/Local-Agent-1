// The Mac's memory, like Activity Monitor's Memory tab: drawn in parts beside
// the welcome box as the window opens (printed once, like the rest of it),
// and one short live line in the footer. Units are Activity Monitor's (GB =
// 2^30 bytes), so a 16 GB Mac says 16.
import { macMemory, gib, runningServer, footprintOf, needBytes } from '../../../models/index.mjs';

// As the window opens: the Mac's memory, the model if it is still loaded from
// an earlier start, and the room it needs at the size it would start with.
// With --url the model runs elsewhere, so nothing is said about its room.
export function openingMemory(model, { ctx = 32768, url = null } = {}) {
  const mac = macMemory();
  if (!mac) return null;
  const running = url ? null : runningServer(model);
  return {
    ...mac,
    name: model.name.split(' ')[0],
    loaded: running ? { bytes: footprintOf(running.pid) + model.bytes, ctx: running.ctx } : null,
    need: url || running ? null : { bytes: needBytes(model, ctx), ctx },
  };
}

export const PRESSURE = { 1: 'fine', 2: 'tight', 4: 'critical' };
export const pressureWord = (m) => PRESSURE[m.level] ?? 'tight';
export const gb1 = (b) => gib(b).toFixed(1);
export const used = (m) => Math.max(0, m.total - m.avail);

// The bar in `cells`: the model, the other apps and the system, what macOS
// compressed, and what is free, with the model's room (when it is not
// loaded) marked inside the free part. Always exactly `cells` wide.
export function memoryParts(m, cells) {
  const at = (b) => Math.max(0, Math.round((b / m.total) * cells));
  const model = Math.min(cells, at(m.loaded?.bytes ?? 0));
  const packed = Math.min(cells - model, at(m.compressed));
  const free = Math.min(cells - model - packed, at(m.avail));
  const apps = cells - model - packed - free;
  const room = m.need ? Math.min(free, at(m.need.bytes)) : 0;
  const appsBytes = Math.max(0, used(m) - (m.loaded?.bytes ?? 0) - m.compressed);
  return { model, apps, packed, room, free: free - room, appsBytes, fits: m.need ? m.avail >= m.need.bytes : null };
}

// The footer's live line: "Mac 14.6/16 GB".
export const footerLabel = (m) => `Mac ${gb1(used(m))}/${Math.round(gib(m.total))} GB`;
