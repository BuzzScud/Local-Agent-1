#!/usr/bin/env node
// wordfreq FILE [--top N] [--min-length N]: the most common words in a text file.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : d; };
const file = args.find((a, i) => !a.startsWith('--') && !String(args[i - 1]).startsWith('--'));
const top = opt('--top', 10);
const minLength = opt('--min-length', 1);
const counts = new Map();
for (const w of readFileSync(file, 'utf8').toLowerCase().match(/[a-z']+/g) ?? []) if (w.length >= minLength) counts.set(w, (counts.get(w) ?? 0) + 1);
for (const [w, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${n}\t${w}`);
