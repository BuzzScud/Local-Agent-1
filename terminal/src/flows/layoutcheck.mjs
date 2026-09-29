// The layout check: after a request that made or changed a page, the page is
// opened in a real browser (headless Chrome: the Mac's own, or the one
// Playwright keeps in its cache; nothing is installed) and measured, because
// a small model cannot see what it built. What it looks for is breakage
// anyone would call a bug, never taste:
//   sideways      the page scrolls sideways (or text is cut at the right edge),
//                 at 1440×900 and on a 390-wide phone
//   overlap       two pieces of text drawn on top of each other
//   spill / cut   text running out of its box, or cut off by it with no "…"
//   contrast      text too faint to read (WCAG AA: 4.5:1, 3:1 for large text),
//                 in light and in dark mode
//   tiny          text under 11 px
//   errors        a script error, a file the page could not load
//   blank         a page that shows nothing
//   head          no <meta charset> (the user's rule), no viewport line (phones
//                 then show it zoomed out)
// The problems go back to the model once (agent.mjs), in plain words with the
// element and the numbers; after its fix the check runs again and says what is
// left. How: a copy of the page in a scratch folder with two tags added at the
// top of <head> (on the same line, so script line numbers stay right): the
// probe script, and a <base> pointing at the page's own folder so its CSS,
// scripts and images still load. Chrome's --dump-dom prints the page after
// ~4 s of page time, the probe's findings in it.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir, platform } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PASSES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'dark', width: 1440, height: 900, dark: true },
];
const PASS_MS = 20_000;

// A headless Chrome on this machine: AGENTIC_CHROME, the installed apps,
// Playwright's cache (newest first), then the usual names on the PATH (Linux CI).
export function findChrome() {
  const named = process.env.AGENTIC_CHROME;
  if (named) return existsSync(named) ? named : null;
  const apps = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'].map((a) => `/Applications/${a}.app/Contents/MacOS/${a}`);
  for (const a of apps) if (existsSync(a)) return a;
  const caches = [join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright'), process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  for (const c of caches) {
    let dirs = [];
    try { dirs = readdirSync(c).filter((d) => /^chromium/.test(d)).sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop())); } catch { continue; }
    for (const d of dirs) {
      for (const rel of [
        'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-mac/headless_shell',
        'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell', 'chrome-linux/chrome',
      ]) if (existsSync(join(c, d, rel))) return join(c, d, rel);
    }
  }
  if (platform() !== 'win32') {
    for (const dir of (process.env.PATH ?? '').split(':')) {
      for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) if (dir && existsSync(join(dir, n))) return join(dir, n);
    }
  }
  return null;
}

// Runs inside the page. Kept to plain ES2017 so any Chrome of the last years runs it.
export const PROBE = String.raw`(function () {
  var errs = [];
  addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) { errs.push('could not load ' + t.tagName.toLowerCase() + ' ' + (t.getAttribute('src') || t.getAttribute('href') || '')); return; }
    errs.push((e.message || 'script error') + (e.lineno ? ' (line ' + e.lineno + ')' : ''));
  }, true);
  addEventListener('unhandledrejection', function (e) { var r = e.reason; errs.push('unhandled promise rejection: ' + (r && r.message ? r.message : String(r))); });
  var ce = console.error;
  console.error = function () { try { errs.push([].slice.call(arguments).map(String).join(' ')); } catch (x) {} return ce.apply(console, arguments); };
  addEventListener('load', function () { setTimeout(measure, 800); });

  function rgba(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function over(top, under) { var a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; }
  function lum(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function hex(c) { return '#' + c.slice(0, 3).map(function (v) { var h = Math.round(v).toString(16); return h.length < 2 ? '0' + h : h; }).join(''); }
  function shown(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) { var cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false; }
    return true;
  }
  function opacity(el) { var o = 1; for (var e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; }
  function said(el) { return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); }
  function tag(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id; else if (el.classList && el.classList.length) s += '.' + [].slice.call(el.classList, 0, 2).join('.');
    return s;
  }
  function name(el) { var s = tag(el), t = said(el); return t ? '"' + t + '" (' + s + ')' : s; }
  function clipped(el) {
    for (var e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) { var ox = getComputedStyle(e).overflowX; if (ox !== 'visible') return true; }
    return false;
  }
  function measure() {
    var W = innerWidth, de = document.documentElement, body = document.body || de;
    var out = { w: W, h: innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches, errors: errs.slice(0, 5), sideways: null, wide: [], overlaps: [], spills: [], cuts: [], contrast: [], faint: 0, tiny: 0, tinyEx: null, blank: false };
    var all = [].slice.call(body.querySelectorAll('*')).filter(function (el) { return el instanceof HTMLElement && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK|TITLE|BR)$/.test(el.tagName); });
    var scrollW = Math.max(de.scrollWidth, body.scrollWidth);
    if (scrollW > W + 1) out.sideways = scrollW;
    var wide = all.filter(function (el) {
      var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
      if (r.right <= W + 1 && r.left >= -1) return false;
      if (r.left >= W || r.right <= 0) return false; // wholly off-screen: a drawer kept out of sight
      var p = el.parentElement, pr = p && p !== body ? p.getBoundingClientRect() : null;
      return !clipped(el) && shown(el) && (!pr || (pr.right <= W + 1 && pr.left >= -1));
    }).sort(function (a, b) { return b.getBoundingClientRect().right - a.getBoundingClientRect().right; });
    out.wide = wide.slice(0, 3).map(function (el) { var r = el.getBoundingClientRect(); var p = el.parentElement; return { el: name(el), inside: p && p !== body ? tag(p) : null, width: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left) }; });
    // Elements with text of their own, and the boxes that text is drawn in.
    var texts = [];
    for (var i = 0; i < all.length && texts.length < 500; i++) {
      var el = all[i], own = [].slice.call(el.childNodes).filter(function (n) { return n.nodeType === 3 && n.textContent.trim(); });
      if (!own.length || !shown(el)) continue;
      var rects = [];
      own.forEach(function (n) { var rg = document.createRange(); rg.selectNodeContents(n); [].slice.call(rg.getClientRects()).forEach(function (r) { if (r.width > 2 && r.height > 2) rects.push(r); }); });
      if (rects.length) texts.push({ el: el, rects: rects });
    }
    function hit(a, b) {
      for (var x = 0; x < a.length; x++) for (var y = 0; y < b.length; y++) {
        var r = a[x], s = b[y], w = Math.min(r.right, s.right) - Math.max(r.left, s.left), h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        if (w > 0 && h > 0 && w * h > 0.3 * Math.min(r.width * r.height, s.width * s.height)) return true;
      }
      return false;
    }
    for (var a = 0; a < texts.length && out.overlaps.length < 3; a++) for (var b = a + 1; b < texts.length && out.overlaps.length < 3; b++) {
      if (hit(texts[a].rects, texts[b].rects)) out.overlaps.push([name(texts[a].el), name(texts[b].el)]);
    }
    texts.forEach(function (t) {
      var el = t.el, cs = getComputedStyle(el);
      if (/^inline/.test(cs.display) && cs.display !== 'inline-block') return;
      var ovW = el.scrollWidth - el.clientWidth, ovH = el.scrollHeight - el.clientHeight;
      if (el.clientWidth > 0 && ovW > 2 && cs.overflowX === 'visible' && out.spills.length < 3) out.spills.push({ el: name(el), by: ovW });
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && (ovW > 2 || ovH > 2) && cs.textOverflow !== 'ellipsis' && !(cs.webkitLineClamp && cs.webkitLineClamp !== 'none') && out.cuts.length < 3) out.cuts.push({ el: name(el), by: Math.max(ovW, ovH) });
      var size = parseFloat(cs.fontSize);
      if (size < 11) { out.tiny++; if (!out.tinyEx) out.tinyEx = { el: name(el), size: size }; }
      if (el.closest(':disabled, [aria-disabled="true"]')) return;
      var fg = rgba(cs.color); if (!fg) return;
      var layers = [], img = false;
      for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
        var ecs = getComputedStyle(e);
        if (ecs.backgroundImage && ecs.backgroundImage !== 'none') { img = true; break; }
        var bg = rgba(ecs.backgroundColor); if (bg && bg[3] > 0) { layers.push(bg); if (bg[3] >= 0.99) break; }
      }
      if (img || (cs.webkitTextFillColor && /rgba?\(0, 0, 0, 0\)|transparent/.test(cs.webkitTextFillColor))) return;
      var canvas = out.dark && /dark/.test(getComputedStyle(de).colorScheme || '') ? [18, 18, 18, 1] : [255, 255, 255, 1];
      var base = canvas; for (var k = layers.length - 1; k >= 0; k--) base = over(layers[k], base);
      var o = opacity(el), text = over([fg[0], fg[1], fg[2], fg[3] * o], base);
      var big = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700), need = big ? 3 : 4.5, cr = ratio(text, base);
      if (cr < need - 0.05) { out.faint++; out.contrast.push({ el: name(el), fg: hex(text), bg: hex(base), ratio: Math.round(cr * 10) / 10, need: need }); }
    });
    out.contrast.sort(function (x, y) { return x.ratio - y.ratio; }); out.contrast = out.contrast.slice(0, 3);
    var media = [].slice.call(body.querySelectorAll('img,svg,canvas,video,iframe')).some(function (m) { var r = m.getBoundingClientRect(); return r.width * r.height > 1000; });
    out.blank = (body.innerText || '').trim().length < 2 && !media;
    var pre = document.createElement('pre'); pre.id = '__agentic_layout';
    pre.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
    (document.body || de).appendChild(pre);
  }
})();`;

// The page with the probe and a <base> put first in <head>, on its first line.
export function withProbe(html, pageDir, probeUrl) {
  const tags = `<script src="${probeUrl}"></script><base href="${pathToFileURL(`${pageDir}/`).href}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tags}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}${tags}`);
  if (/<!doctype[^>]*>/i.test(html)) return html.replace(/<!doctype[^>]*>/i, (m) => `${m}${tags}`);
  return `${tags}${html}`;
}

function run(chrome, args, ms) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const p = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { if (!done) { done = true; try { p.kill('SIGKILL'); } catch {} resolve({ timeout: true, out }); } }, ms);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ error: e.message, out }); } });
    p.on('close', () => { if (!done) { done = true; clearTimeout(timer); resolve({ out }); } });
  });
}

// One look at the page at one size.
async function pass(chrome, copyUrl, scratch, p) {
  const args = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--allow-file-access-from-files', `--user-data-dir=${join(scratch, `profile-${p.name}`)}`, `--window-size=${p.width},${p.height}`,
    '--virtual-time-budget=4000', ...(p.dark ? ['--blink-settings=preferredColorScheme=0'] : []),
    // Linux runners without user namespaces cannot start Chrome's sandbox; the page is our own copy.
    ...(platform() === 'linux' ? ['--no-sandbox'] : []), '--dump-dom', copyUrl];
  const r = await run(chrome, args, PASS_MS);
  const m = /id="__agentic_layout">([A-Za-z0-9+/=]+)</.exec(r.out);
  if (!m) return { pass: p, failed: r.timeout ? 'timed out' : r.error ?? 'the probe did not report' };
  try { return { pass: p, found: JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) }; } catch { return { pass: p, failed: 'unreadable probe result' }; }
}

// Checks one page: { page, problems: [text], secs } or { skipped: why }.
export async function layoutCheck(pageAbs, { chrome = findChrome(), passes = PASSES } = {}) {
  if (!chrome) return { skipped: 'no headless Chrome on this machine' };
  if (!existsSync(pageAbs)) return { skipped: `${pageAbs} is missing` };
  const t0 = Date.now();
  const html = readFileSync(pageAbs, 'utf8');
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-layout-'));
  try {
    writeFileSync(join(scratch, 'probe.js'), PROBE);
    writeFileSync(join(scratch, 'page.html'), withProbe(html, dirname(pageAbs), pathToFileURL(join(scratch, 'probe.js')).href));
    const results = await Promise.all(passes.map((p) => pass(chrome, pathToFileURL(join(scratch, 'page.html')).href, scratch, p)));
    const failed = results.filter((r) => r.failed);
    if (failed.length === results.length) return { skipped: `the browser could not open it (${failed[0].failed})` };
    return { page: pageAbs, problems: problemsOf(html, results), secs: (Date.now() - t0) / 1000 };
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch {}
  }
}

const where = (p) => (p.name === 'phone' ? `on a phone (${p.width} px wide)` : p.dark ? 'in dark mode' : `at ${p.width}×${p.height}`);

// Plain sentences, each problem once (the first size it shows at).
export function problemsOf(html, results) {
  const out = [];
  const seen = new Set();
  const add = (key, text) => { if (!seen.has(key)) { seen.add(key); out.push(text); } };
  const head = html.slice(0, 4000);
  if (!/<meta[^>]+charset/i.test(head)) add('charset', 'There is no <meta charset="utf-8"> at the top of <head>, so some letters and symbols can show as junk.');
  if (!/<meta[^>]+name=["']?viewport/i.test(head)) add('viewport', 'There is no <meta name="viewport" content="width=device-width, initial-scale=1"> in <head>, so a phone shows the page zoomed out.');
  for (const r of results) {
    const f = r.found;
    if (!f) continue;
    const at = where(r.pass);
    if (f.blank) add('blank', `The page shows nothing ${at}: no text or pictures appear.`);
    for (const e of f.errors ?? []) add(`err:${e}`, `The page reports an error: ${e}.`);
    if (!r.pass.dark && (f.sideways || f.wide.length)) {
      const w = f.wide[0];
      const why = w ? ` ${w.el}${w.inside ? `, inside ${w.inside},` : ''} is ${w.width} px wide and reaches ${w.left < -1 ? `${w.left} px (past the left edge)` : `${w.right} px`}.` : '';
      add(`side:${r.pass.name}`, f.sideways ? `${at[0].toUpperCase()}${at.slice(1)} the page scrolls sideways (${f.sideways} px wide in a ${f.w} px window).${why} Let it shrink or wrap (max-width:100%, flex-wrap, minmax(0,1fr)).` : `${at[0].toUpperCase()}${at.slice(1)} part of the page is cut off at the edge of the window.${why}`);
    }
    for (const [a, b] of f.overlaps ?? []) add(`ov:${a}|${b}`, `Text is drawn on top of other text ${at}: ${a} overlaps ${b}.`);
    for (const s of f.spills ?? []) add(`sp:${s.el}`, `Text runs out of its box ${at}: ${s.el}, by ${s.by} px.`);
    for (const c of f.cuts ?? []) add(`cut:${c.el}`, `Text is cut off ${at}: ${c.el} hides ${c.by} px of it with no "…".`);
    for (const c of f.contrast ?? []) add(`con:${c.el}`, `Text is too faint to read ${at}: ${c.el} is ${c.fg} on ${c.bg} (${c.ratio}:1; needs ${c.need}:1)${f.faint > 3 ? `, one of ${f.faint} such pieces` : ''}.`);
    if (f.tiny && f.tinyEx) add('tiny', `Some text is too small to read (${f.tiny} piece${f.tiny === 1 ? '' : 's'} under 11 px, e.g. ${f.tinyEx.el} at ${f.tinyEx.size} px).`);
  }
  return out;
}

// What goes back to the model.
export function layoutNote(rel, problems) {
  return `The layout check opened ${rel} in a browser (1440×900, a 390-wide phone, and dark mode) and found:\n${problems.slice(0, 8).map((p, i) => `${i + 1}. ${p}`).join('\n')}\nFix these in the page with Edit (small edits, not a rewrite), then say in one sentence what you changed.`;
}

// A page that only works through its own server (a Vite or React index.html,
// a server template): opened as a file it would show nothing or fail to load
// its scripts, and the check would send the model after problems that are not
// there. The reason, or null.
export function needsServer(html) {
  if (/<script[^>]+type=["']module["'][^>]*src=["']\/(?!\/)/i.test(html) || /<script[^>]*src=["']\/src\//i.test(html)) return 'it loads its code through a dev server';
  if (/%PUBLIC_URL%|\{\{[\s\S]{0,80}?\}\}|\{%[\s\S]{0,80}?%\}|<%[=-]?/.test(html)) return 'it is a server template';
  if (/(?:src|href)=["']\/(?!\/)[^"']+\.(?:m?js|css)["']/i.test(html)) return 'its scripts and styles are served from the site root';
  return null;
}

// The pages a turn changed: its .html files, and any page beside a changed
// stylesheet or script that uses it by name. At most `max`, newest first.
export function pagesToCheck(cwd, rels, max = 2) {
  const pages = new Set(rels.filter((r) => /\.html?$/i.test(r)));
  for (const r of rels.filter((x) => /\.(css|m?js)$/i.test(x))) {
    const dir = join(cwd, dirname(r));
    let names = [];
    try { names = readdirSync(dir).filter((n) => /\.html?$/i.test(n)); } catch {}
    for (const n of names) {
      try { if (readFileSync(join(dir, n), 'utf8').includes(basename(r))) pages.add(join(dirname(r), n)); } catch {}
    }
  }
  return [...pages].filter((r) => existsSync(join(cwd, r)))
    .sort((a, b) => statSync(join(cwd, b)).mtimeMs - statSync(join(cwd, a)).mtimeMs).slice(0, max);
}
