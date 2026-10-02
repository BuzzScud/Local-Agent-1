// 250 items with ids 1..250, in id order. scanned counts the items the store walks over.
const ITEMS = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, name: `item ${i + 1}`, secret: `s${i + 1}` }));
let scanned = 0;
export const scannedCount = () => scanned;
export const resetScanned = () => { scanned = 0; };

export function listItems() {
  const out = [];
  for (const it of ITEMS) { scanned++; out.push(it); }
  return out;
}
