#!/bin/zsh
npm test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(npm test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 4 ] || { echo "no new test"; exit 1; }
node -e "
import('./src/tools/fs.mjs').then(({ listFiles }) => {
  const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
  const { join } = require('node:path');
  const d = mkdtempSync(join(require('node:os').tmpdir(), 'chk-'));
  mkdirSync(join(d, 'tmp')); writeFileSync(join(d, 'tmp', 'x.txt'), ''); writeFileSync(join(d, 'a.js'), '');
  const lines = listFiles(d, { pattern: '**/*' }).lines;
  if (lines.some((l) => l.startsWith('tmp'))) { console.log('tmp still listed: ' + lines.join(',')); process.exit(1); }
  if (!lines.includes('a.js')) { console.log('a.js missing'); process.exit(1); }
})" || exit 1
