// The web, for the WebFetch and WebSearch tools (agent/tools.mjs).
//   fetchPage: a page read as text: its words, headings, lists, tables and
//     links; no scripts, styling or menus. A PDF comes back as its text, a
//     picture as a picture. A redirect is followed on the same site only: to
//     another site it says where, so the site you allowed is the one read.
//   searchWeb: a search through a search service with your API key (/web):
//     Brave Search or Tavily. The key is kept in the Keychain, as /remote's.
// On the Claude API neither runs here: Claude searches and reads with
// Anthropic's own web tools (agent/claude.mjs).
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfText, preparedImage } from './media.mjs';
import { readKey } from '../../../models/index.mjs';

const FETCH_TIMEOUT = 20_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const SEARCH_COUNT = 8;
export const SEARCH_PROVIDERS = ['brave', 'tavily'];
export const PROVIDER_NAMES = { brave: 'Brave Search', tavily: 'Tavily' };
// Where each service answers, and where you get a key.
const PROVIDER_HOSTS = { brave: 'https://api.search.brave.com', tavily: 'https://api.tavily.com' };
export const PROVIDER_KEYS = { brave: 'api-dashboard.search.brave.com', tavily: 'app.tavily.com' };
// A service's key: in the Keychain beside /remote's (its own entry), or AGENTIC_SEARCH_KEY (a script, a test).
export const searchKeyId = (provider) => `search-${provider}`;
export const searchKey = (provider) => process.env.AGENTIC_SEARCH_KEY || (SEARCH_PROVIDERS.includes(provider) ? readKey(searchKeyId(provider)) : null);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) AgenticCoder/1.0 Safari/605.1.15';

// "x:" is a scheme when "//" follows, or it is one that never has it ("localhost:3000" is a site and a port).
const hasScheme = (t) => /^[a-z][a-z\d+.-]*:\/\//i.test(t) || /^(mailto|data|javascript|about|tel|file):/i.test(t);
// A web address from what the model sent: http or https only; "example.com/x" gets https://.
export function webUrl(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('no address');
  let u;
  try { u = new URL(hasScheme(t) ? t : `https://${t}`); } catch { throw new Error(`"${t}" is not a web address`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`only http and https pages can be read, not ${u.protocol.replace(':', '')}`);
  if (!u.hostname) throw new Error(`"${t}" has no site in it`);
  u.hash = '';
  return u;
}
// The site a permission is for: its host name, without "www.".
export const siteOf = (url) => { try { return webUrl(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

// ---- a page as text ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', times: '×', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', rarr: '→', larr: '←', uarr: '↑', darr: '↓', shy: '' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
// A bit of HTML as one line of text. raw: entities left for the end (a decoded "&lt;div&gt;" would be taken for a tag).
const oneLine = (x) => String(x).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const inline = (x) => decodeEntities(oneLine(x)).replace(/\s+/g, ' ').trim();
const absolute = (href, base) => { try { return (base ? new URL(decodeEntities(href), base) : new URL(decodeEntities(href))).href; } catch { return null; } };

// A page's HTML as readable text, and its title. The main part (<main>,
// <article>) when there is one with words in it; menus, footers and forms left out.
// base: the page's own address, for its relative links (none: they are left as text).
export function htmlText(html, base = null) {
  let h = String(html ?? '');
  const title = inline(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(h)?.[1] ?? '');
  h = h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg|iframe|canvas|head|object)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const main = /<main\b[\s\S]*<\/main\s*>/i.exec(h)?.[0] ?? /<article\b[\s\S]*<\/article\s*>/i.exec(h)?.[0];
  if (main && inline(main).length > 200) h = main;
  h = h.replace(/<(nav|footer|form|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  // Code blocks keep their lines.
  const pres = [];
  h = h.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_, x) => { pres.push(decodeEntities(x.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\s+$/, '')); return `\n\u0000${pres.length - 1}\u0000\n`; });
  h = h.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, n, x) => `\n\n${'#'.repeat(Number(n))} ${oneLine(x)}\n\n`);
  h = h.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_, a, b, c, x) => {
    const text = oneLine(x);
    const href = a ?? b ?? c ?? '';
    const url = /^(javascript|mailto|tel|data):|^#/i.test(href) ? null : absolute(href, base);
    return url && text && decodeEntities(text) !== url ? `[${text}](${url.replace(/&/g, '&amp;')})` : text;
  });
  h = h.replace(/<img\b[^>]*?\balt\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi, (_, a, b) => `[picture: ${oneLine(a ?? b)}]`);
  h = h.replace(/<(code|kbd|samp)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, t, x) => `\`${x.replace(/<[^>]+>/g, '')}\``);
  h = h.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(/<\/?(p|div|section|tr|table|thead|tbody|ul|ol|li|blockquote|dd|dt|dl|header|figure|figcaption|details|summary|hr)\b[^>]*>/gi, '\n');
  h = decodeEntities(h.replace(/<[^>]+>/g, ' '));
  const out = [];
  for (let line of h.split('\n')) {
    const code = /^\u0000(\d+)\u0000$/.exec(line.trim());
    if (code) { out.push('```', pres[Number(code[1])], '```'); continue; }
    line = line.replace(/[ \t ]+/g, ' ').replace(/ \| *$/, '').trim();
    if (!line || line === '|' || line === '-') { if (out.length && out.at(-1) !== '') out.push(''); continue; }
    out.push(line);
  }
  while (out.at(-1) === '') out.pop();
  return { title, text: out.join('\n') };
}

// The body, at most max bytes (a longer one is cut there).
async function readCapped(res, max) {
  const reader = res.body?.getReader();
  if (!reader) return { buf: Buffer.alloc(0), cut: false };
  const parts = [];
  let size = 0, cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    if (size > max) { cut = true; try { await reader.cancel(); } catch {} break; }
  }
  const buf = Buffer.concat(parts);
  return { buf: cut ? buf.subarray(0, max) : buf, cut };
}

// One page: { url (where it ended), status, type, title, text, bytes, cut, moved?, image? }.
// moved: a redirect to another site (not followed): its address.
export async function fetchPage(address, { signal, timeoutMs = FETCH_TIMEOUT, maxBytes = FETCH_MAX_BYTES } = {}) {
  let url = webUrl(address);
  const timeout = AbortSignal.timeout(timeoutMs);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const site = url.hostname.replace(/^www\./, '');
  let res;
  try {
    for (let hops = 0; ; hops++) {
      res = await fetch(url, { redirect: 'manual', signal: both, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain,application/json,application/pdf;q=0.9,*/*;q=0.8' } });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const to = absolute(res.headers.get('location') ?? '', url);
      if (!to || hops >= 5) break;
      const next = new URL(to);
      if (next.hostname.replace(/^www\./, '') !== site) return { url: url.href, status: res.status, moved: next.href, type: '', title: '', text: '', bytes: 0 };
      url = next;
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    if (timeout.aborted) throw new Error(`${url.hostname} did not answer in ${Math.round(timeoutMs / 1000)} s`);
    throw new Error(`${url.hostname} could not be reached (${e.cause?.code ?? e.message})`);
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const { buf, cut } = await readCapped(res, maxBytes);
  const base = { url: url.href, status: res.status, type, bytes: buf.length, cut };
  const isPdfBody = type === 'application/pdf' || buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdfBody || type.startsWith('image/')) {
    const file = join(tmpdir(), `agentic-web-${process.pid}-${Date.now()}.${isPdfBody ? 'pdf' : (type.split('/')[1] || 'img').replace(/[^a-z0-9]/g, '')}`);
    writeFileSync(file, buf);
    try {
      if (isPdfBody) {
        const pages = pdfText(file);
        return { ...base, title: '', text: pages.map((t, i) => `--- page ${i + 1} of ${pages.length} ---\n${t.trim() || '(no text on this page: a scan or a picture)'}`).join('\n'), pages: pages.length };
      }
      const img = preparedImage(file);
      return { ...base, title: '', text: '', image: { ...img, path: url.href } };
    } finally { rmSync(file, { force: true }); }
  }
  const raw = buf.toString('utf8');
  if (type.includes('html') || (!type && /^\s*<(!doctype html|html)\b/i.test(raw))) return { ...base, ...htmlText(raw, url.href) };
  if (!type || type.startsWith('text/') || /json|xml|javascript|yaml|csv|markdown/.test(type)) return { ...base, title: '', text: raw.replace(/\r\n?/g, '\n') };
  return { ...base, title: '', text: '', other: true };
}

// ---- a search -----------------------------------------------------------------------------------

const clean = (s) => inline(s ?? '');
// The results, the same for every service: [{ title, url, snippet, age? }].
export async function searchWeb(query, { provider, key, count = SEARCH_COUNT, signal, timeoutMs = FETCH_TIMEOUT } = {}) {
  if (!SEARCH_PROVIDERS.includes(provider)) throw new Error('no search service is set: pick one in /web');
  if (!key) throw new Error(`no API key for ${PROVIDER_NAMES[provider]}: add it in /web`);
  const q = String(query ?? '').trim();
  if (!q) throw new Error('nothing to search for');
  // AGENTIC_SEARCH_URL: a stand-in service (the tests).
  const host = (process.env.AGENTIC_SEARCH_URL || PROVIDER_HOSTS[provider]).replace(/\/+$/, '');
  const timeout = AbortSignal.timeout(timeoutMs);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = provider === 'brave'
      ? await fetch(`${host}/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}`, { signal: both, headers: { accept: 'application/json', 'x-subscription-token': key } })
      : await fetch(`${host}/search`, { method: 'POST', signal: both, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query: q, max_results: count }) });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(timeout.aborted ? `${PROVIDER_NAMES[provider]} did not answer in ${Math.round(timeoutMs / 1000)} s` : `${PROVIDER_NAMES[provider]} could not be reached (${e.cause?.code ?? e.message})`);
  }
  const body = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`${PROVIDER_NAMES[provider]} did not accept the API key (${res.status}): change it in /web`);
  if (res.status === 429) throw new Error(`${PROVIDER_NAMES[provider]} says too many searches for now (429): wait a little, or check the key's plan`);
  if (!res.ok) throw new Error(`${PROVIDER_NAMES[provider]} answered ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error(`${PROVIDER_NAMES[provider]} did not answer in JSON`); }
  const list = provider === 'brave'
    ? (data.web?.results ?? []).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(r.description), ...(r.age ? { age: clean(r.age) } : {}) }))
    : (data.results ?? []).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(r.content).slice(0, 400) }));
  return list.filter((r) => r.url).slice(0, count);
}
