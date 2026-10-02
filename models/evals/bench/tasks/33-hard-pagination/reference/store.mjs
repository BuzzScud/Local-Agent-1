// 250 items with ids 1..250, in id order. scanned counts the items the store walks over.
const ITEMS = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, name: `item ${i + 1}`, secret: `s${i + 1}` }));
let scanned = 0;
export const scannedCount = () => scanned;
export const resetScanned = () => { scanned = 0; };

// Items with an id greater than after, at most limit of them. The ids are in order, so it
// starts past after and stops as soon as it has enough.
export function listItems({ after = 0, limit = Infinity } = {}) {
  const out = [];
  for (const it of ITEMS) {
    if (out.length >= limit) break;
    scanned++;
    if (it.id > after) out.push(it);
  }
  return out;
}
