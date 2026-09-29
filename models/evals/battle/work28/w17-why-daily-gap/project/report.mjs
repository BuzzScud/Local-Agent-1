import { readFileSync } from 'node:fs';
import { findGaps } from './gaps.mjs';
import { CONTRACTS } from './config.mjs';

// Prints the holes in each contract's saved bars for one day.
const day = process.argv[2] ?? '2026-09-28';
for (const c of CONTRACTS) {
  const times = JSON.parse(readFileSync(`data/${c}-${day}.json`, 'utf8'));
  for (const g of findGaps(times)) console.log(`${c} ${new Date(g.from).toISOString().slice(11, 16)} UTC: ${g.missing} minutes missing`);
}
