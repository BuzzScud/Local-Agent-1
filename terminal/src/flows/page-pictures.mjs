// A page four ways in one picture (18 Oct 2026, the owner's pick for the design system, "look and fix twice": desktop
// and phone, light and dark): what a model that can see is shown after a page is written, so it judges the page as a
// person meets it on each, not only a desktop at 1440 px. Headless Chrome over its debugging connection
// (layoutcheck.mjs devtools), each view in a tab of its own, then the four laid out on one sheet, which is captured.
//   pagePictures(abs) → { mime, data, w, h, views: [names], secs } or null (no Chrome, or nothing drew)
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { devtools, findChrome } from './layoutcheck.mjs';

export const VIEWS = [
  { name: 'Desktop · light', width: 1440, height: 900 },
  { name: 'Phone · light', width: 390, height: 844, mobile: true },
  { name: 'Desktop · dark', width: 1440, height: 900, dark: true },
  { name: 'Phone · dark', width: 390, height: 844, mobile: true, dark: true },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One view in a tab of its own: the page as it opens at that size and colour scheme, base64 PNG or null.
async function shoot(dt, url, v) {
  let targetId = null;
  try {
    ({ targetId } = await dt.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await dt.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => dt.send(method, params, sessionId);
    await s('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: Boolean(v.mobile) });
    await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v.dark ? 'dark' : 'light' }] });
    await s('Page.enable');
    await s('Page.navigate', { url });
    for (const until = Date.now() + 8000; Date.now() < until;) {
      const r = await s('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r?.result?.value === 'complete') break;
      await sleep(120);
    }
    // Fonts, a first animation frame or two.
    await s('Runtime.evaluate', { expression: 'document.fonts ? document.fonts.ready.then(() => 1) : 1', awaitPromise: true, returnByValue: true }).catch(() => null);
    await sleep(350);
    const shot = await s('Page.captureScreenshot', { format: 'png' });
    return shot?.data ?? null;
  } catch { return null; } finally {
    if (targetId) try { await dt.send('Target.closeTarget', { targetId }); } catch {}
  }
}

// The sheet: each desktop beside its phone, light above dark, each named; about 1,500 × 1,000.
function sheetHtml(shots) {
  const cell = (v, data) => `<figure><figcaption>${v.name}</figcaption>${data ? `<img src="data:image/png;base64,${data}" style="width:${v.mobile ? 222 : 760}px;height:${v.mobile ? 480 : 475}px">` : `<div class="none" style="width:${v.mobile ? 222 : 760}px">not drawn</div>`}</figure>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#8a8a8a;font:600 15px -apple-system,BlinkMacSystemFont,sans-serif;color:#111}
.grid{display:grid;grid-template-columns:760px 222px;gap:14px 18px;padding:14px;width:max-content}
figure{margin:0}figcaption{margin:0 0 6px 2px}img{display:block;border:1px solid #333;object-fit:cover;object-position:top}
.none{height:475px;display:grid;place-items:center;background:#ccc}
</style></head><body><div class="grid" id="sheet">${VIEWS.map((v, i) => cell(v, shots[i])).join('')}</div></body></html>`;
}

export async function pagePictures(abs, { chrome = findChrome() } = {}) {
  if (!chrome) return null;
  const t0 = Date.now();
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-pictures-'));
  let dt = null;
  try {
    dt = await devtools(chrome, scratch);
    if (!dt) return null;
    const url = pathToFileURL(abs).href;
    const shots = [];
    for (const v of VIEWS) shots.push(await shoot(dt, url, v));
    if (!shots.some(Boolean)) return null;
    const sheet = join(scratch, 'sheet.html');
    writeFileSync(sheet, sheetHtml(shots));
    let targetId = null;
    try {
      ({ targetId } = await dt.send('Target.createTarget', { url: 'about:blank' }));
      const { sessionId } = await dt.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (method, params) => dt.send(method, params, sessionId);
      await s('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1100, deviceScaleFactor: 1, mobile: false });
      await s('Page.enable');
      await s('Page.navigate', { url: pathToFileURL(sheet).href });
      let box = null;
      for (const until = Date.now() + 6000; Date.now() < until && !box;) {
        await sleep(120);
        const r = await s('Runtime.evaluate', { expression: "(() => { const g = document.getElementById('sheet'); const imgs = [...document.images]; if (!g || imgs.some((i) => !i.complete)) return null; const b = g.getBoundingClientRect(); return { w: Math.ceil(b.width), h: Math.ceil(b.height) }; })()", returnByValue: true });
        box = r?.result?.value ?? null;
      }
      if (!box) return null;
      await s('Emulation.setDeviceMetricsOverride', { width: box.w, height: box.h, deviceScaleFactor: 1, mobile: false });
      await sleep(120);
      const shot = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: box.w, height: box.h, scale: 1 } });
      if (!shot?.data) return null;
      return { path: abs, mime: 'image/png', data: shot.data, w: box.w, h: box.h, views: VIEWS.filter((_, i) => shots[i]).map((v) => v.name), secs: (Date.now() - t0) / 1000 };
    } finally {
      if (targetId) try { await dt.send('Target.closeTarget', { targetId }); } catch {}
    }
  } catch { return null; } finally {
    dt?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
