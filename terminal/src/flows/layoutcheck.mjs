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
//   dead button   a button that changes nothing when clicked, twice (a pass of
//                 its own; Qwen, 29 Sep: "Load Different Data" said it swapped
//                 5 scenarios and always drew the same one)
// The problems go back to the model (agent.mjs), in plain words with the
// element and the numbers, and for faint text a colour that would pass; after
// its fix the check runs again, and what is left goes back once more
// (LAYOUT_ROUNDS) before the turn ends with a "Still broken" line. How: a copy of the page in a scratch folder with two tags added at the
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
const PROBE = String.raw`(function () {
  var errs = [];
  addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) { errs.push('could not load ' + t.tagName.toLowerCase() + ' ' + (t.getAttribute('src') || t.getAttribute('href') || '')); return; }
    errs.push((e.message || 'script error') + (e.lineno ? ' (line ' + e.lineno + ')' : ''));
  }, true);
  addEventListener('unhandledrejection', function (e) { var r = e.reason; errs.push('unhandled promise rejection: ' + (r && r.message ? r.message : String(r))); });
  var ce = console.error;
  console.error = function () { try { errs.push([].slice.call(arguments).map(String).join(' ')); } catch (x) {} return ce.apply(console, arguments); };
  var CLICKS = false;
  var ACCESS = false;
  // What a click did that the page itself may not show: a message box, a new
  // window, a copy, a download, a sound, a save, a form sent.
  var acted = 0;
  function counts(obj, key) { try { var f = obj && obj[key]; if (typeof f !== 'function') return; obj[key] = function () { acted++; try { return f.apply(this, arguments); } catch (x) { return undefined; } }; } catch (x) {} }
  if (CLICKS) {
    window.alert = function () { acted++; };
    window.confirm = function () { acted++; return true; };
    window.prompt = function () { acted++; return 'test'; };
    window.open = function () { acted++; return null; };
    window.print = function () { acted++; };
    counts(URL, 'createObjectURL');
    counts(navigator.clipboard, 'writeText');
    counts(HTMLMediaElement.prototype, 'play');
    counts(HTMLMediaElement.prototype, 'pause');
    try { counts(Storage.prototype, 'setItem'); } catch (x) {}
    try { counts(window.speechSynthesis, 'speak'); } catch (x) {}
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { counts(AC.prototype, 'resume'); counts(AC.prototype, 'createOscillator'); counts(AC.prototype, 'createBufferSource'); }
    addEventListener('submit', function (e) { acted++; e.preventDefault(); }, true);
  }
  addEventListener('load', function () { setTimeout(CLICKS ? clicks : measure, 800); });

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
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
      // Inside a closed <details>, all but its own <summary> is not drawn (8 Oct 2026: every FAQ and
      // accordion of the design library read as text drawn over its question, though nothing showed).
      if (e.tagName === 'DETAILS' && !e.open && e !== el) { var sm = el.closest && el.closest('summary'); if (!(sm && sm.parentElement === e)) return false; }
      // Text for screen readers only (Tailwind's sr-only, the usual visually-hidden CSS): never drawn.
      if (cs.clipPath === 'inset(50%)' || cs.clip === 'rect(0px, 0px, 0px, 0px)' || (cs.position === 'absolute' && cs.overflow === 'hidden' && e.offsetWidth <= 1 && e.offsetHeight <= 1)) return false;
    }
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
    if (ACCESS) out.access = accessLook();
    report(out);
  }
  // Who can use it (a loop's page check asks for it: rules/loops/accessibility-pass.md): what a keyboard
  // or a screen reader cannot use. A name counts from its words, aria-label, aria-labelledby, a title, or
  // a picture's alt inside it; a placeholder is not a label.
  function accessLook() {
    var a = { lang: Boolean((document.documentElement.getAttribute('lang') || '').trim()), noAlt: [], noName: [], noLabel: [], skips: [], alts: 0, names: 0, labels: 0 };
    function by(el) { var ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean); return ids.some(function (id) { var x = document.getElementById(id); return x && said(x); }); }
    function named(el) {
      if ((el.getAttribute('aria-label') || '').trim() || (el.getAttribute('title') || '').trim() || by(el) || said(el)) return true;
      return [].slice.call(el.querySelectorAll('img[alt], [aria-label], svg title')).some(function (x) { return (x.getAttribute('alt') || x.getAttribute('aria-label') || x.textContent || '').trim(); });
    }
    [].slice.call(document.querySelectorAll('img')).forEach(function (im) {
      if (!shown(im) || im.hasAttribute('alt') || im.getAttribute('role') === 'presentation' || im.getAttribute('aria-hidden') === 'true') return;
      a.alts++; if (a.noAlt.length < 3) { var src = im.getAttribute('src') || ''; a.noAlt.push(tag(im) + ' (' + (/^data:/i.test(src) ? 'a picture inside the page' : src.split('/').pop().slice(0, 40) || 'no src') + ')'); }
    });
    [].slice.call(document.querySelectorAll('button, a[href], [role=button], [role=link]')).forEach(function (el) {
      if (!shown(el) || named(el)) return;
      a.names++; if (a.noName.length < 3) a.noName.push(tag(el));
    });
    [].slice.call(document.querySelectorAll('input, select, textarea')).forEach(function (f) {
      var t = (f.getAttribute('type') || 'text').toLowerCase();
      if (!shown(f) || /^(hidden|submit|button|reset|image)$/.test(t)) return;
      if ((f.getAttribute('aria-label') || '').trim() || (f.getAttribute('title') || '').trim() || by(f)) return;
      if (f.id) { var l = document.querySelector('label[for="' + f.id.replace(/"/g, '\\"') + '"]'); if (l && said(l)) return; }
      var w = f.closest('label'); if (w && said(w)) return;
      a.labels++; if (a.noLabel.length < 3) a.noLabel.push({ el: tag(f), hint: (f.getAttribute('placeholder') || '').trim().slice(0, 30) });
    });
    var last = 0;
    [].slice.call(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).forEach(function (h) {
      if (!shown(h)) return;
      var n = Number(h.tagName[1]);
      if (last && n > last + 1 && a.skips.length < 3) a.skips.push({ from: 'h' + last, to: name(h) });
      last = n;
    });
    return a;
  }
  function report(out) {
    var pre = document.createElement('pre'); pre.id = '__agentic_layout';
    pre.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
    (document.body || document.documentElement).appendChild(pre);
  }
  // The click look (a pass of its own, so a button that leaves the page
  // cannot spoil the layout findings): each button is clicked and the page
  // compared before and after. One that changes nothing is clicked again
  // after all the others and with the empty boxes filled in (a "Reset" on a
  // fresh page, a "Back" on the first card, an "Add" with nothing typed), and
  // only one that still changes nothing is dead.
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  function state() {
    var parts = [document.documentElement.outerHTML, document.title, location.hash, String(scrollX) + ',' + String(scrollY)];
    [].slice.call(document.querySelectorAll('input, textarea, select')).forEach(function (f) { parts.push(f.value + '|' + f.checked); });
    [].slice.call(document.querySelectorAll('audio, video')).forEach(function (m) { parts.push(m.paused + '|' + m.muted + '|' + m.volume + '|' + m.currentSrc); });
    [].slice.call(document.querySelectorAll('canvas')).slice(0, 4).forEach(function (c) { try { parts.push(String(hash(c.toDataURL()))); } catch (x) { parts.push('?'); } });
    return hash(parts.join('\u0001'));
  }
  function clickable() {
    return [].slice.call(document.querySelectorAll('button, [role=button], input[type=button], input[type=submit], input[type=reset], [onclick]')).filter(function (el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && !el.closest('[aria-disabled="true"], a[href]') && shown(el) && !(el.form && el.form.getAttribute('action'));
    });
  }
  function press(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) {
      var E = t.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new E(t, { bubbles: true, cancelable: true, view: window }));
    });
    el.click();
  }
  function clicks() {
    var out = { clicks: true, tried: 0, dead: [], clickErrors: [] };
    var list = clickable().slice(0, 16), dead = [];
    out.tried = list.length;
    function one(el, done) {
      if (!el || !el.isConnected || !shown(el)) { done(null); return; }
      var nm = name(el), before = state(), a0 = acted, e0 = errs.length;
      try { press(el); } catch (x) { errs.push(x && x.message ? x.message : String(x)); }
      setTimeout(function () {
        if (errs.length > e0 && out.clickErrors.length < 3) out.clickErrors.push({ el: nm, error: String(errs[e0]).slice(0, 160) });
        done(acted !== a0 || state() !== before);
      }, 300);
    }
    function fill() {
      [].slice.call(document.querySelectorAll('input, textarea')).forEach(function (f) {
        var t = (f.getAttribute('type') || 'text').toLowerCase();
        if (f.value || f.disabled || f.readOnly || !shown(f) || !/^(text|search|number|email|url|tel|password|textarea)$/.test(f.tagName === 'TEXTAREA' ? 'textarea' : t)) return;
        f.value = t === 'number' ? '3' : t === 'email' ? 'test@localhost' : t === 'url' ? 'http://localhost/' : 'test';
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    var i = 0;
    (function first() {
      if (i >= list.length) { fill(); i = 0; return again(); }
      var el = list[i++], nm = name(el);
      one(el, function (changed) { if (changed === false) dead.push(nm); first(); });
    })();
    function again() {
      if (i >= dead.length) { report(out); return; }
      var nm = dead[i++], el = clickable().filter(function (c) { return name(c) === nm; })[0];
      one(el, function (changed) { if (changed === false && out.dead.length < 5) out.dead.push(nm); again(); });
    }
  }
})();`;

// The same probe for the click pass.
const CLICK_PROBE = PROBE.replace('var CLICKS = false;', 'var CLICKS = true;');
// The same probe, also looking at who can use the page (accessLook).
const ACCESS_PROBE = PROBE.replace('var ACCESS = false;', 'var ACCESS = true;');
const CLICK_PASS = { name: 'clicks', width: 1440, height: 900, clicks: true };

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
    // The click pass needs page time for up to 32 clicks, 0.3 s each.
    `--virtual-time-budget=${p.clicks ? 15000 : 4000}`, ...(p.dark ? ['--blink-settings=preferredColorScheme=0'] : []),
    // Linux runners without user namespaces cannot start Chrome's sandbox; the page is our own copy.
    ...(platform() === 'linux' ? ['--no-sandbox'] : []), '--dump-dom', copyUrl];
  const r = await run(chrome, args, PASS_MS);
  const m = /id="__agentic_layout">([A-Za-z0-9+/=]+)</.exec(r.out);
  if (!m) return { pass: p, failed: r.timeout ? 'timed out' : r.error ?? 'the probe did not report' };
  try { return { pass: p, found: JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) }; } catch { return { pass: p, failed: 'unreadable probe result' }; }
}

// Checks one page: { page, problems: [text], secs } or { skipped: why }.
// clicks: also the click pass (CLICK_PASS), which presses every button.
// access: also who can use it (accessLook), for a loop's page check.
export async function layoutCheck(pageAbs, { chrome = findChrome(), passes = PASSES, clicks = true, access = false } = {}) {
  if (!chrome) return { skipped: 'no headless Chrome on this machine' };
  if (!existsSync(pageAbs)) return { skipped: `${pageAbs} is missing` };
  const t0 = Date.now();
  const html = readFileSync(pageAbs, 'utf8');
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-layout-'));
  try {
    const copy = (probe, file) => {
      writeFileSync(join(scratch, `${file}.js`), probe);
      writeFileSync(join(scratch, `${file}.html`), withProbe(html, dirname(pageAbs), pathToFileURL(join(scratch, `${file}.js`)).href));
      return pathToFileURL(join(scratch, `${file}.html`)).href;
    };
    const page = copy(access ? ACCESS_PROBE : PROBE, 'page');
    const clickPage = clicks ? copy(CLICK_PROBE, 'page-clicks') : null;
    const results = await Promise.all([...passes.map((p) => pass(chrome, page, scratch, p)), ...(clickPage ? [pass(chrome, clickPage, scratch, CLICK_PASS)] : [])]);
    // A click pass that did not report (a button left the page, say) adds nothing.
    const looks = results.filter((r) => !r.pass.clicks);
    const failed = looks.filter((r) => r.failed);
    if (failed.length === looks.length) return { skipped: `the browser could not open it (${failed[0].failed})` };
    return { page: pageAbs, problems: problemsOf(html, results), secs: (Date.now() - t0) / 1000 };
  } finally {
    try { rmSync(scratch, { recursive: true, force: true }); } catch {}
  }
}

const where = (p) => (p.name === 'phone' ? `on a phone (${p.width} px wide)` : p.dark ? 'in dark mode' : `at ${p.width}×${p.height}`);

// Colours a pair of text and background could have to pass, close to the
// pair that failed (Qwen, 30 Sep: told the play button's #1c1b18 on #2a78d6
// was 3.9:1, it chose white on a LIGHTER blue, 3.7:1 — the wrong way). For
// each of the two, the nearest shade of the same hue (HSL lightness) that
// reaches a little over the need with the other kept, and which way it went.
const rgbOf = (hex) => { const h = String(hex).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const hexOf = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const lumOf = (rgb) => {
  const c = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrastOf = (a, b) => { const x = lumOf(rgbOf(a)), y = lumOf(rgbOf(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function hslOf([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function rgbOfHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
// `move` made darker (when it is already the darker of the two) or lighter
// until it reaches `target` against `keep`: { hex, ratio, way }, or null when
// even black or white would not.
function shadeThatPasses(move, keep, target, need) {
  const [h, s, l] = hslOf(rgbOf(move));
  const darker = lumOf(rgbOf(move)) <= lumOf(rgbOf(keep));
  const end = darker ? 0 : 1;
  const at = (x) => hexOf(rgbOfHsl(h, s, x));
  if (contrastOf(at(end), keep) < target) return null;
  let lo = l, hi = end; // lo falls short, hi reaches it
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (contrastOf(at(mid), keep) >= target) hi = mid; else lo = mid; }
  const hex = at(hi), ratio = contrastOf(hex, keep);
  return ratio >= need ? { hex, ratio, way: darker ? 'darker' : 'lighter' } : null;
}
export function passingColours(fg, bg, need) {
  const target = need + 0.3; // a little over, so the next look does not land on 4.4
  return { text: shadeThatPasses(fg, bg, target, need), back: shadeThatPasses(bg, fg, target, need) };
}
const oneDecimal = (r) => (Math.floor(r * 10) / 10).toFixed(1);
function passingHint(fg, bg, need) {
  const { text, back } = passingColours(fg, bg, need);
  const ways = [
    text && `keep the background and make the text ${text.way}, such as ${text.hex} (${oneDecimal(text.ratio)}:1)`,
    back && `keep the text and make the background ${back.way}, such as ${back.hex} (${oneDecimal(back.ratio)}:1)`,
  ].filter(Boolean);
  return ways.length ? ` To pass: ${ways.join('; or ')}.` : '';
}

// Plain sentences, each problem once (the first size it shows at; faint text
// once for each pair of colours, so dark mode's own colours are told too).
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
    if (f.clicks) {
      for (const c of f.clickErrors ?? []) add(`clickerr:${c.el}`, `Clicking ${c.el} gives an error: ${c.error}.`);
      for (const d of f.dead ?? []) add(`dead:${d}`, `Clicking ${d} changes nothing on the page, even after the other buttons were clicked and the empty boxes filled in. Make it do what it is for; if it only works with a server, a sound or something typed first, say so in one sentence.`);
      continue;
    }
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
    // Keyed by its colours too: by the piece alone, the play button's 2.4:1
    // in dark mode was dropped, as its 3.9:1 at 1440 px came first (30 Sep).
    // A page with no dark colours of its own shows the same pair: told once.
    for (const c of f.contrast ?? []) add(`con:${c.el}|${c.fg}|${c.bg}`, `Text is too faint to read ${at}: ${c.el} is ${c.fg} on ${c.bg} (${c.ratio}:1; needs ${c.need}:1)${f.faint > 3 ? `, one of ${f.faint} such pieces` : ''}.${passingHint(c.fg, c.bg, c.need)}`);
    if (f.access) for (const [key, text] of accessProblems(f.access)) add(key, text);
    if (f.tiny && f.tinyEx) add('tiny', `Some text is too small to read (${f.tiny} piece${f.tiny === 1 ? '' : 's'} under 11 px, e.g. ${f.tinyEx.el} at ${f.tinyEx.size} px).`);
  }
  return out;
}

// What goes back to the model. `again`: the look after its fix, when what is
// left goes back a second time.
export function layoutNote(rel, problems, again = false) {
  const list = problems.slice(0, 8).map((p, i) => `${i + 1}. ${p}`).join('\n');
  if (again) return `The layout check looked at ${rel} again after your fix, and it still finds:\n${list}\nYour last change did not fix ${problems.length === 1 ? 'it' : 'these'}. Fix ${problems.length === 1 ? 'it' : 'them'} with Edit (small edits, not a rewrite); where a colour is given, use it. Then say in one sentence what you changed.`;
  return `The layout check opened ${rel} in a browser (1440×900, a 390-wide phone, and dark mode), clicked its buttons, and found:\n${list}\nFix these in the page with Edit (small edits, not a rewrite), then say in one sentence what you changed.`;
}

// Who can use it, in plain sentences: [key, text] (problemsOf keeps each once).
function accessProblems(a) {
  const out = [];
  const more = (n, shown) => (n > shown ? `, one of ${n}` : '');
  if (!a.lang) out.push(['a:lang', 'The page does not say its language: add lang="en" (or its own) to <html>, so a screen reader reads it in the right voice.']);
  if (a.noAlt?.length) out.push(['a:alt', `A picture has no alt text: ${a.noAlt.join(', ')}${more(a.alts, a.noAlt.length)}. Add alt="what it shows", or alt="" when it is only decoration.`]);
  for (const el of a.noName ?? []) out.push([`a:name:${el}`, `${el} has no name a screen reader can say${a.names > a.noName.length ? ` (one of ${a.names})` : ''}: give it words, an aria-label or a title.`]);
  for (const f of a.noLabel ?? []) out.push([`a:label:${f.el}`, `The box ${f.el} has no label${f.hint ? ` (its placeholder "${f.hint}" is not one)` : ''}: add a <label for> or an aria-label.`]);
  for (const k of a.skips ?? []) out.push([`a:skip:${k.to}`, `The headings skip a level: an ${k.from} is followed by ${k.to}. Use the next level down, so the outline reads in order.`]);
  return out;
}

// ---- a loop's page check (rules/loops: "- Page check: {page}"), before each run ----
// A file in the project, or an address: a dev server on this Mac or your own network. An address is
// opened in Chrome over its debugging connection (the page cannot be copied), with the same probe put in
// before the page's own scripts; its buttons are never pressed, so nothing in a live app is set off.

// An address on this Mac or a private network (a dev server, a Tailscale machine); never the internet.
export function isLocalAddress(text) {
  let u;
  try { u = new URL(text); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A fetch with a time limit of its own (AbortSignal.timeout never fires under bun test).
async function fetchFor(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, redirect: 'follow' }); return { status: r.status, text: await r.text() }; }
  catch (e) { return { error: e.name === 'AbortError' ? 'it did not answer within 5 s' : 'nothing answers there' }; }
  finally { clearTimeout(t); }
}
// Chrome with its debugging connection on a free port: send(method, params, session) → result.
async function devtools(chrome, scratch) {
  const proc = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    `--user-data-dir=${join(scratch, 'profile-address')}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', ...(platform() === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const kill = () => { try { proc.kill('SIGKILL'); } catch {} };
  const wsUrl = await new Promise((resolve) => {
    let err = '';
    const t = setTimeout(() => resolve(null), 10_000);
    proc.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) { clearTimeout(t); resolve(m[1]); } });
    proc.on('error', () => { clearTimeout(t); resolve(null); });
    proc.on('close', () => { clearTimeout(t); resolve(null); });
  });
  if (!wsUrl) { kill(); return null; }
  const ws = new WebSocket(wsUrl);
  try { await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('no connection')); }); } catch { kill(); return null; }
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(String(e.data)); } catch { return; }
    const w = m.id && waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result);
  };
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, close() { try { ws.close(); } catch {} kill(); } };
}
// One look at an address at one size, in a tab of its own.
async function addressPass(dt, url, p, probe) {
  let targetId = null;
  try {
    ({ targetId } = await dt.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await dt.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => dt.send(method, params, sessionId);
    await s('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: 1, mobile: false });
    if (p.dark) await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await s('Page.enable');
    await s('Page.addScriptToEvaluateOnNewDocument', { source: probe });
    const nav = await s('Page.navigate', { url });
    if (nav?.errorText) return { pass: p, failed: nav.errorText };
    for (const until = Date.now() + 12_000; Date.now() < until;) {
      await sleep(250);
      const r = await s('Runtime.evaluate', { expression: "(document.getElementById('__agentic_layout') || {}).textContent || ''", returnByValue: true });
      const v = r?.result?.value;
      if (v) return { pass: p, found: JSON.parse(Buffer.from(v, 'base64').toString('utf8')) };
    }
    return { pass: p, failed: 'the probe did not report' };
  } catch (e) {
    return { pass: p, failed: e.message };
  } finally {
    if (targetId) try { await dt.send('Target.closeTarget', { targetId }); } catch {}
  }
}
// Checks an address: { page, problems, secs } or { skipped: why }. No click pass: it is a live app.
export async function layoutCheckUrl(url, { chrome = findChrome(), passes = PASSES, access = false } = {}) {
  if (!chrome) return { skipped: 'no headless Chrome on this machine' };
  if (!isLocalAddress(url)) return { skipped: 'only an address on this Mac or your own network is checked, never one on the internet' };
  const t0 = Date.now();
  const got = await fetchFor(url, 5000);
  if (got.error) return { skipped: `${got.error} (is its server running?)` };
  if (got.status >= 400) return { skipped: `it answers ${got.status}` };
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-layout-'));
  const dt = await devtools(chrome, scratch);
  try {
    if (!dt) return { skipped: 'the browser could not start' };
    const results = [];
    for (const p of passes) results.push(await addressPass(dt, url, p, access ? ACCESS_PROBE : PROBE));
    const failed = results.filter((r) => r.failed);
    if (failed.length === results.length) return { skipped: `the browser could not open it (${failed[0].failed})` };
    return { page: url, problems: problemsOf(got.text, results), secs: (Date.now() - t0) / 1000 };
  } finally {
    dt?.close();
    try { rmSync(scratch, { recursive: true, force: true }); } catch {}
  }
}
// A loop's page check: target is what its {page} blank was answered with, a file (from cwd) or an address.
// → { page: as written, address, problems, secs } or { page, address, skipped }.
export async function checkPage(target, { cwd = process.cwd(), access = false, chrome = findChrome() } = {}) {
  const page = String(target ?? '').trim();
  if (/^https?:\/\//i.test(page)) return { ...(await layoutCheckUrl(page, { chrome, access })), page, address: true };
  const abs = page.startsWith('~/') ? join(homedir(), page.slice(2)) : page.startsWith('/') ? page : join(cwd, page);
  if (!page || !existsSync(abs) || !statSync(abs).isFile()) return { page, address: false, skipped: `there is no file ${page || '(none named)'} in this folder` };
  let html = '';
  try { html = readFileSync(abs, 'utf8'); } catch { return { page, address: false, skipped: `${page} could not be read` }; }
  const server = needsServer(html);
  if (server) return { page, address: false, skipped: `${server}: give its address instead, like http://localhost:5173` };
  // As written in the loop (index.html), not the whole path layoutCheck answers with.
  return { ...(await layoutCheck(abs, { chrome, access })), page, address: false };
}
// What a run is told above its message: what the check found, or that it found nothing, or why it could not look.
export function pageCheckNote(r) {
  if (r.skipped) return `(The page check of ${r.page} could not run: ${r.skipped}. Say so in your answer, and do what you can from the code.)`;
  const how = r.address ? ', its buttons not pressed (a live address)' : '';
  const head = `(The page check of ${r.page}, just now, in a hidden browser at 1440×900, on a phone 390 px wide and in dark mode${how}, ${r.secs.toFixed(1)} s:`;
  if (!r.problems.length) return `${head} nothing broken.)`;
  return `${head} ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}.\n${r.problems.map((x) => `- ${x}`).join('\n')})`;
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
