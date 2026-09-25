// Renders app/icon.svg to icon-1024.png and icon.icns (all the sizes macOS
// uses). Needs Playwright (borrowed from MAIN2026's node_modules).
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
// Playwright is borrowed from another project on this Mac: set PLAYWRIGHT_FROM
// to that project's package.json (default: ~/Desktop/MAIN2026).
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? join(homedir(), 'Desktop', 'MAIN2026', 'package.json'));
const { chromium } = require('playwright');
const svg = readFileSync(join(here, 'icon.svg'), 'utf8');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await p.screenshot({ path: join(here, 'icon-1024.png'), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await b.close();

// Every size macOS asks for, then one .icns.
const set = join(here, 'icon.iconset');
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const [name, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) {
  execFileSync('sips', ['-z', String(px), String(px), join(here, 'icon-1024.png'), '--out', join(set, `icon_${name}.png`)], { stdio: 'ignore' });
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(here, 'icon.icns')]);
rmSync(set, { recursive: true, force: true });
console.log('wrote app/icon-1024.png and app/icon.icns');
