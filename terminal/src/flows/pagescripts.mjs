// The two scripts the page check runs with node (src/flows/pagecheck.mjs):
//   the probe   looks at a page for Bonsai (what can be clicked, what covers
//               what, and why); it lives in the scratch copy only
//   the check   the small script left in your project: exit 0 = pass,
//               1 = the bug shows, 2 = the check could not run
// Both open the page the same way and use the browser the project already
// has (Playwright). They are kept as text, so the check reads the same in
// your project whatever Bonsai was built with. No backticks inside them.

const IMPORTS = String.raw`import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
`;

// Opening the page: a server the project starts itself (on a free port), or
// the page's folder served as plain files. Nothing outside this Mac is reached.
const RUNTIME = String.raw`const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const TYPES = { '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain' };

async function openSite(root, spec) {
  const free = await freePort();
  if (spec.serve) {
    const own = Boolean(spec.serve.portEnv) || spec.serve.cmd.includes('{port}');
    const port = own ? free : spec.serve.port;
    const env = { ...process.env };
    if (spec.serve.portEnv) env[spec.serve.portEnv] = String(port);
    let err = '';
    const child = spawn(spec.serve.cmd.split('{port}').join(String(port)), { cwd: join(root, spec.serve.dir || '.'), shell: true, detached: true, stdio: ['ignore', 'ignore', 'pipe'], env });
    child.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch {} } };
    const base = 'http://127.0.0.1:' + port;
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw new Error('the server (' + spec.serve.cmd + ') stopped: ' + err.trim().split('\n').slice(-3).join(' | '));
      try { const r = await fetch(base + spec.url, { redirect: 'manual' }); if (r.status < 500) break; } catch {}
      if (i > 120) { stop(); throw new Error('the server (' + spec.serve.cmd + ') did not answer in 60 s'); }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { base, stop };
  }
  const dir = join(root, spec.files || '.');
  const server = httpServer((req, res) => {
    let file = join(dir, normalize(decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)));
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((ok) => server.listen(free, '127.0.0.1', ok));
  return { base: 'http://127.0.0.1:' + free, stop: () => server.close() };
}

async function openPage(root, spec, base) {
  const pw = createRequire(join(root, spec.browser || '.', 'package.json'))('playwright');
  let browser = null;
  let why = 'none is installed';
  for (const name of spec.engines) {
    try { browser = await pw[name].launch(); break; } catch (e) { why = String(e.message || e).split('\n')[0]; }
  }
  if (!browser) throw new Error('no browser could start (' + why + ')');
  const page = await browser.newPage({ viewport: spec.size });
  await page.route('**/*', (r) => (r.request().url().startsWith(base) || /^(data|blob|about):/.test(r.request().url()) ? r.continue() : r.abort()));
  const reply = await page.goto(base + spec.url, { waitUntil: 'load', timeout: 45000 });
  if (reply && reply.status() >= 400) { await browser.close(); throw new Error('the page answered ' + reply.status() + ' at ' + spec.url); }
  return { browser, page };
}

// A page is ready when what it shows has stopped changing (at most 12 s).
async function settle(page) {
  let last = -1;
  let same = 0;
  for (let i = 0; i < 24 && same < 2; i++) {
    const n = await page.evaluate(() => document.body ? document.body.getElementsByTagName('*').length + ':' + document.body.innerText.length : 0).catch(() => -1);
    same = n === last ? same + 1 : 0;
    last = n;
    await page.waitForTimeout(500);
  }
}

async function doSteps(page, steps) {
  for (const s of steps) {
    if (s.do === 'press') { await page.keyboard.press(s.text); await page.waitForTimeout(300); continue; }
    await page.waitForSelector(s.on, { state: 'visible', timeout: 20000 });
    if (s.do === 'hover') await page.hover(s.on);
    else {
      await page.click(s.on);
      if (s.do === 'type') await page.keyboard.type(s.text || '', { delay: 20 });
    }
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(600);
}
`;

// In the page: is `covered` the top thing wherever it overlaps `by`? And
// (keep) is `by` still seen once `covered` is out of the way, so a fix cannot
// pass by pushing it under the rest of the page? Things that ignore the
// mouse (pointer-events: none) still paint, so for the moment of the check
// everything answers the mouse.
const ON_TOP = String.raw`const ON_TOP = ({ covered, by, keep }) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 2 && r.height >= 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.02 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const name = (el) => '<' + el.tagName.toLowerCase() + (el.id ? ' id="' + el.id + '"' : '') + (typeof el.className === 'string' && el.className ? ' class="' + el.className + '"' : '') + '>';
  const A = [...document.querySelectorAll(covered)].filter(vis);
  const B = [...document.querySelectorAll(by)].filter(vis);
  if (!A.length) return { error: covered + ' is not showing on the page after the steps' };
  if (!B.length) return { error: by + ' is not showing on the page after the steps' };
  const all = document.createElement('style');
  all.textContent = '* { pointer-events: auto !important; }';
  document.head.appendChild(all);
  const hits = [];
  let overlap = 0;
  for (const a of A) for (const b of B) {
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const l = Math.max(ra.left, rb.left, 0) + 1;
    const r = Math.min(ra.right, rb.right, innerWidth) - 1;
    const t = Math.max(ra.top, rb.top, 0) + 1;
    const bt = Math.min(ra.bottom, rb.bottom, innerHeight) - 1;
    if (r - l < 1 || bt - t < 1) continue;
    overlap++;
    let hit = null;
    for (let i = 0; i <= 4 && !hit; i++) for (let j = 0; j <= 8 && !hit; j++) {
      const x = l + (r - l) * j / 8;
      const y = t + (bt - t) * i / 4;
      const top = document.elementFromPoint(x, y);
      if (top && !a.contains(top) && b.contains(top)) hit = 'at ' + Math.round(x) + ',' + Math.round(y) + ' the top thing is ' + name(top) + ' "' + (top.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) + '"';
    }
    if (hit && hits.length < 6) hits.push(hit);
  }
  // With the covered thing out of the way, is the other one still seen?
  const lost = [];
  if (keep) {
    const clear = (el) => { const s = getComputedStyle(el); return (s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent') && s.backgroundImage === 'none'; };
    const was = A.map((a) => a.style.visibility);
    for (const a of A) a.style.visibility = 'hidden';
    for (const b of B) {
      const rb = b.getBoundingClientRect();
      let seen = 0;
      let under = null;
      for (let i = 1; i <= 3; i++) for (let j = 1; j <= 7; j++) {
        const x = rb.left + rb.width * j / 8;
        const y = rb.top + rb.height * i / 4;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top && (b.contains(top) || (top.contains(b) && clear(top)))) seen++;
        else if (top && !under) under = 'at ' + Math.round(x) + ',' + Math.round(y) + ' the top thing is ' + name(top);
      }
      if (!seen && under && lost.length < 3) lost.push(under);
    }
    A.forEach((a, i) => { a.style.visibility = was[i]; });
  }
  all.remove();
  return { hits, overlap, lost };
};
`;

// In the page, for the probe: what can be used, what showed up after the
// steps, what covers what, and the layers that decide it.
const IN_PAGE = String.raw`(() => {
  if (window.__bz) return;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 2 && r.height >= 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.02 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const count = (s) => { try { return document.querySelectorAll(s).length; } catch { return 99; } };
  const sel = (el) => {
    if (!el || el === document.documentElement) return 'html';
    if (el === document.body) return 'body';
    if (el.id && count('#' + esc(el.id)) === 1) return '#' + esc(el.id);
    const tag = el.tagName.toLowerCase();
    const cls = [...el.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 3);
    for (let k = 1; k <= cls.length; k++) { const s = '.' + cls.slice(0, k).join('.'); if (count(s) === 1) return s; }
    if (cls.length) return '.' + cls.join('.');
    const p = el.parentElement;
    if (!p) return tag;
    const same = [...p.children].filter((c) => c.tagName === el.tagName);
    return sel(p) + ' > ' + tag + (same.length > 1 ? ':nth-of-type(' + (same.indexOf(el) + 1) + ')' : '');
  };
  // One element only: what a step clicks or types in.
  const one = (el) => {
    const s = sel(el);
    if (count(s) === 1) return s;
    const p = el.parentElement;
    if (!p || el === document.body) return s;
    const tag = el.tagName.toLowerCase();
    const same = [...p.children].filter((c) => c.tagName === el.tagName);
    return one(p) + ' > ' + tag + (same.length > 1 ? ':nth-of-type(' + (same.indexOf(el) + 1) + ')' : '');
  };
  const text = (el, n) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 60);
  const everything = (on) => {
    const s = document.createElement('style');
    s.textContent = '* { pointer-events: auto !important; }';
    document.head.appendChild(s);
    try { return on(); } finally { s.remove(); }
  };

  const outline = () => {
    const out = [];
    for (const el of document.querySelectorAll('input, textarea, select, button, [role=button], [role=tab], [role=menuitem], [role=combobox], a[href], summary, [contenteditable=true], [onclick]')) {
      if (out.length >= 300) break;
      if (!vis(el) || el.disabled) continue;
      const tag = el.tagName.toLowerCase();
      const typed = tag === 'input' || tag === 'textarea';
      const label = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('name'), typed ? (el.value ? 'holds "' + String(el.value).slice(0, 20) + '"' : '') : text(el, 40)].filter(Boolean).join(' · ').slice(0, 90);
      const r = el.getBoundingClientRect();
      out.push({ sel: one(el), kind: tag + (tag === 'input' ? ' ' + (el.type || 'text') : ''), label, x: Math.round(r.left), y: Math.round(r.top) });
    }
    return out;
  };
  const shown = () => [...document.body.querySelectorAll('*')].filter(vis).length;
  const mark = () => { window.__bzSeen = new WeakSet([...document.body.querySelectorAll('*')].filter(vis)); };
  // Only the outermost of what showed up (a list, not each of its rows).
  const appeared = () => {
    const seen = window.__bzSeen;
    const out = [];
    if (!seen) return out;
    for (const el of document.body.querySelectorAll('*')) {
      if (out.length >= 30) break;
      if (seen.has(el) || !vis(el) || out.some((o) => o.contains(el))) continue;
      out.push(el);
    }
    return out;
  };
  // Things whose id or class holds a word of the request, or whose text holds a quoted one.
  const named = (words, quoted) => {
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (out.length >= 40) break;
      if (!vis(el) || out.some((o) => o.contains(el))) continue;
      const n = ((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')).toLowerCase();
      const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ').toLowerCase();
      if ((n.trim() && words.some((w) => n.includes(w))) || quoted.some((q) => own.includes(q))) out.push(el);
    }
    return out;
  };

  // Does this element start a layer group of its own (a stacking context)?
  const startsGroup = (el) => {
    if (el === document.documentElement) return 'the page itself';
    const s = getComputedStyle(el);
    const p = el.parentElement ? getComputedStyle(el.parentElement).display : '';
    if (s.position === 'fixed' || s.position === 'sticky') return 'position: ' + s.position;
    if (s.zIndex !== 'auto' && (s.position !== 'static' || /flex|grid/.test(p))) return 'z-index: ' + s.zIndex;
    if (Number(s.opacity) < 1) return 'opacity: ' + s.opacity;
    if (s.transform && s.transform !== 'none') return 'transform';
    if (s.filter && s.filter !== 'none') return 'filter';
    if (s.backdropFilter && s.backdropFilter !== 'none') return 'backdrop-filter';
    if (s.perspective && s.perspective !== 'none') return 'perspective';
    if (s.clipPath && s.clipPath !== 'none') return 'clip-path';
    if (s.mixBlendMode && s.mixBlendMode !== 'normal') return 'mix-blend-mode';
    if (s.isolation === 'isolate') return 'isolation: isolate';
    if (/transform|opacity|filter|perspective/.test(s.willChange || '')) return 'will-change';
    if (/paint|layout|strict|content/.test(s.contain || '')) return 'contain';
    if (s.containerType && s.containerType !== 'normal') return 'container-type';
    return null;
  };
  const groups = (el) => { const out = []; for (let e = el; e; e = e.parentElement) if (startsGroup(e)) out.unshift(e); return out; };
  const zRules = (el) => {
    const out = [];
    if (el.style && el.style.zIndex) out.push({ inline: true, value: el.style.zIndex });
    const walk = (rules, sheet) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) { try { walk(r.cssRules, sheet); } catch {} continue; }
        if (!r.selectorText || !r.style || !r.style.zIndex) continue;
        let hit = false;
        try { hit = el.matches(r.selectorText); } catch {}
        if (!hit) continue;
        const part = r.selectorText.split(',').map((x) => x.trim()).find((x) => { try { return el.matches(x); } catch { return false; } }) || r.selectorText;
        out.push({ selector: part, value: r.style.zIndex, sheet: sheet.href ? new URL(sheet.href).pathname : '' });
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, sheet); } catch {} }
    return out;
  };
  const who = (el) => ({ sel: sel(el), id: el.id || '', classes: [...el.classList].slice(0, 4), z: getComputedStyle(el).zIndex, position: getComputedStyle(el).position, group: startsGroup(el), rules: zRules(el) });
  // The layers of a (should be on top) and c (covers it): the two groups
  // that are compared with each other, inside the group they share.
  const layers = (a, c) => {
    const ga = groups(a);
    const gc = groups(c);
    let i = 0;
    while (i < ga.length && i < gc.length && ga[i] === gc[i]) i++;
    const shared = ga[i - 1] || document.documentElement;
    // Below the shared group: the outermost group, or positioned thing, each sits in.
    const top = (el, list) => {
      if (list[i]) return list[i];
      let found = null;
      for (let e = el; e && e !== shared; e = e.parentElement) if (getComputedStyle(e).position !== 'static') found = e;
      return found;
    };
    const ta = top(a, ga);
    const tc = top(c, gc);
    const level = (el) => { if (!el) return -0.5; const z = getComputedStyle(el).zIndex; return z === 'auto' ? 0 : Number(z); };
    const later = ta && tc ? Boolean(ta.compareDocumentPosition(tc) & 4) : Boolean(a.compareDocumentPosition(c) & 4);
    return { shared: sel(shared), a: ta ? who(ta) : null, c: tc ? who(tc) : null, own: who(a), top: who(c), levelA: level(ta), levelC: level(tc), cLater: later };
  };

  const coversOf = (a) => {
    const r = a.getBoundingClientRect();
    const l = Math.max(r.left, 0) + 2;
    const rt = Math.min(r.right, innerWidth) - 2;
    const t = Math.max(r.top, 0) + 2;
    const b = Math.min(r.bottom, innerHeight) - 2;
    const found = new Map();
    if (rt <= l || b <= t) return [];
    const nx = Math.min(24, Math.max(3, Math.round((rt - l) / 10)));
    const ny = Math.min(24, Math.max(3, Math.round((b - t) / 8)));
    for (let i = 0; i <= ny; i++) for (let j = 0; j <= nx; j++) {
      const x = l + (rt - l) * j / nx;
      const y = t + (b - t) * i / ny;
      const top = document.elementFromPoint(x, y);
      if (!top || a.contains(top) || top.contains(a)) continue;
      const e = found.get(top) || { el: top, n: 0, x: Math.round(x), y: Math.round(y) };
      e.n++;
      found.set(top, e);
    }
    return [...found.values()];
  };
  const pairs = (words, quoted) => everything(() => {
    const fresh = appeared();
    const byName = named(words, quoted).filter((el) => !fresh.some((f) => f === el || f.contains(el)));
    const out = [];
    const seen = window.__bzSeen;
    for (const a of [...fresh, ...byName]) {
      for (const c of coversOf(a)) {
        const key = sel(a) + ' < ' + sel(c.el);
        if (out.some((o) => o.key === key) || out.length >= 40) continue;
        out.push({ key, covered: sel(a), coveredText: text(a, 50), fresh: fresh.includes(a), by: sel(c.el), byText: text(c.el, 50), byBefore: Boolean(seen && seen.has(c.el)), coveredBefore: Boolean(seen && seen.has(a)), points: c.n, x: c.x, y: c.y, layers: layers(a, c.el) });
      }
    }
    return { appeared: fresh.map((el) => ({ sel: sel(el), text: text(el, 50) })), pairs: out };
  });
  window.__bz = { outline, shown, mark, pairs };
})();`;

// The probe: job.json in, one JSON line out (between the marks).
export const MARKS = ['<<<BONSAI', 'BONSAI>>>'];
export function probeScript() {
  return `${IMPORTS}
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ROOT = job.root;
${RUNTIME}
const IN_PAGE = ${JSON.stringify(IN_PAGE)};
let out = { ok: false };
let site = null;
let browser = null;
try {
  site = await openSite(ROOT, job);
  const opened = await openPage(ROOT, job, site.base);
  browser = opened.browser;
  const page = opened.page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await settle(page);
  await page.evaluate(IN_PAGE);
  if (job.mode === 'outline') out = { ok: true, title: await page.title(), outline: await page.evaluate('window.__bz.outline()'), shown: await page.evaluate('window.__bz.shown()'), errors };
  else {
    await page.evaluate('window.__bz.mark()');
    await doSteps(page, job.steps);
    await page.evaluate(IN_PAGE);
    const found = await page.evaluate((j) => window.__bz.pairs(j.words, j.quoted), { words: job.words, quoted: job.quoted });
    out = { ok: true, ...found, errors };
  }
} catch (e) {
  out = { ok: false, error: String(e.message || e).split('\\n')[0] };
} finally {
  if (browser) await browser.close().catch(() => {});
  if (site) site.stop();
}
console.log(${JSON.stringify(MARKS[0])} + JSON.stringify(out) + ${JSON.stringify(MARKS[1])});
process.exit(0);
`;
}

// The check left in the project. spec: { browser, engines, size, url, serve |
// files, waitFor, steps, covered, by }; head: the comment lines on top.
export function checkScript({ spec, up, head }) {
  return `${head.map((l) => `// ${l}`.trimEnd()).join('\n')}
${IMPORTS}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ${JSON.stringify(up)});
const SPEC = ${JSON.stringify(spec, null, 2)};

${RUNTIME}
${ON_TOP}
let code = 2;
let site = null;
let browser = null;
try {
  site = await openSite(ROOT, SPEC);
  const opened = await openPage(ROOT, SPEC, site.base);
  browser = opened.browser;
  const page = opened.page;
  for (const w of SPEC.waitFor) await page.waitForSelector(w, { state: 'visible', timeout: 30000 });
  await settle(page);
  await doSteps(page, SPEC.steps);
  for (const w of [SPEC.covered, SPEC.by]) await page.waitForSelector(w, { state: 'visible', timeout: 10000 });
  const res = await page.evaluate(ON_TOP, { covered: SPEC.covered, by: SPEC.by, keep: SPEC.keep });
  if (res.error) console.log('ERROR ' + res.error);
  else if (res.hits.length) { code = 1; console.log('FAIL ' + SPEC.by + ' covers ' + SPEC.covered + ':\\n  ' + res.hits.join('\\n  ')); }
  else if (res.lost.length) { code = 1; console.log('FAIL ' + SPEC.by + ' is no longer seen on the page (it must stay seen, under ' + SPEC.covered + ' only):\\n  ' + res.lost.join('\\n  ')); }
  else { code = 0; console.log('PASS ' + SPEC.covered + ' is on top of ' + SPEC.by + (res.overlap ? '' : ' (they do not overlap)')); }
} catch (e) {
  console.log('ERROR ' + String(e.message || e).split('\\n')[0]);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (site) site.stop();
}
process.exit(code);
`;
}
