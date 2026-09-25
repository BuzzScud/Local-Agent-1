#!/usr/bin/env node
// Prints a trades file as CSV: node export.mjs [trades.json]
import { readFileSync } from 'node:fs';

export function toCsv(rows) {
  if (!rows.length) return '';
  const header = Object.keys(rows[0]);
  const lines = rows.map((row) => header.map((key) => row[key]).join(','));
  return [header.join(','), ...lines].join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const file = argv.find((arg) => !arg.startsWith('--')) ?? 'trades.json';
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  return toCsv(rows);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(main());
}
