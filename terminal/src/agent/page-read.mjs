// What a reader sees of a page the message wrote (4 Oct 2026). Asked for "all of the math, formulas
// and logic" in one self-contained page, Qwen3.6 built ~/Desktop/thesis-math-library.html: 8 sections
// that showed only their headings, the 34 KB of content inside <script>, 385 characters on screen.
// It said it was done; nothing had looked at the page, and the second look sees only what the app
// records. The owner saw empty cards. Now each page the message wrote (Write, Edit or a command) is
// opened before the answer stands: on a Mac in WebKit, through JavaScript for Automation, so its
// scripts run as in a browser (no Chrome needed); elsewhere read as text, scripts left out. A page
// that is mostly empty to a reader goes back once with what it showed (the owner's pick).
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OSA = '/usr/bin/osascript';
// The page, loaded from its file in a WebKit view of a laptop's width; its scripts run; errors are
// kept from the first line (a file page hides their words: "Script error."). Then the text each
// section and the whole page show.
const READER = `ObjC.import('WebKit');
ObjC.import('Foundation');
function run(argv) {
  const conf = $.WKWebViewConfiguration.alloc.init;
  const keep = "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});";
  conf.userContentController.addUserScript($.WKUserScript.alloc.initWithSourceInjectionTimeForMainFrameOnly(keep, $.WKUserScriptInjectionTimeAtDocumentStart, true));
  const wv = $.WKWebView.alloc.initWithFrameConfiguration($.NSMakeRect(0, 0, 1280, 900), conf);
  const url = $.NSURL.fileURLWithPath(argv[0]);
  wv.loadFileURLAllowingReadAccessToURL(url, url.URLByDeletingLastPathComponent);
  const wait = (s) => $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(s));
  for (let i = 0; i < 80 && wv.isLoading; i++) wait(0.1);
  wait(1.0);
  let out = null;
  const js = "JSON.stringify({errors: window.__errs || [], text: document.body ? document.body.innerText.length : 0, sections: Array.from(document.querySelectorAll('section, article')).filter(function(s){return !s.parentElement.closest('section, article')}).map(function(s){var h=s.querySelector('h1,h2,h3,h4');return {id: s.id, title: h ? h.innerText.trim() : '', chars: s.innerText.trim().length}})})";
  wv.evaluateJavaScriptCompletionHandler(js, (res, err) => { out = res ? ObjC.unwrap(res) : ''; });
  for (let i = 0; i < 50 && out === null; i++) wait(0.1);
  return out || '';
}`;
let readerFile = null;
const reader = () => {
  if (readerFile && existsSync(readerFile)) return readerFile;
  readerFile = join(mkdtempSync(join(tmpdir(), 'agentic-page-read-')), 'read.js');
  writeFileSync(readerFile, READER);
  return readerFile;
};
// AGENTIC_PAGE_READ: off (no page check: the tests), text (read as text, no browser), else on.
export const pageReadOn = () => process.env.AGENTIC_PAGE_READ !== 'off';
export const canRunPages = () => process.platform === 'darwin' && existsSync(OSA) && process.env.AGENTIC_PAGE_READ !== 'text';

// Without a browser: the text outside tags, scripts, styles and comments, per top section.
const visible = (html) => String(html).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, ' ').trim();
export function readStatic(html) {
  const sections = [];
  const re = /<(section|article)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const m of String(html).matchAll(re)) {
    const id = /\bid=["']([^"']+)["']/i.exec(m[2])?.[1] ?? '';
    const title = visible(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(m[3])?.[1] ?? '');
    sections.push({ id, title, chars: visible(m[3]).length });
  }
  return { errors: [], text: visible(/<body\b[\s\S]*$/i.exec(html)?.[0] ?? html).length, sections, ran: false };
}

// { text, sections: [{ id, title, chars }], errors, ran, bytes } or null (not a page, not readable).
// Async: the window keeps drawing while WebKit opens the page (a second or two).
export async function readPage(abs, { timeoutMs = 20_000 } = {}) {
  let html;
  try { html = readFileSync(abs, 'utf8'); } catch { return null; }
  const bytes = Buffer.byteLength(html);
  if (canRunPages()) {
    const out = await new Promise((done) => execFile(OSA, ['-l', 'JavaScript', reader(), abs], { encoding: 'utf8', timeout: timeoutMs }, (_e, stdout) => done(String(stdout ?? ''))));
    try { const v = JSON.parse(out.trim()); if (v && Array.isArray(v.sections)) return { ...v, ran: true, bytes }; } catch { /* read as text below */ }
  }
  return { ...readStatic(html), bytes };
}

// A section is empty to a reader when it shows little more than its heading.
const EMPTY = 40;
// Mostly empty: of two sections or more, half or more show nothing past their headings; or, with
// no sections, a page of 5 KB or more that shows under 300 characters. { empty, of, problem }.
export function emptyOf(read) {
  if (!read) return { empty: [], of: 0, problem: false };
  const empty = read.sections.filter((s) => s.chars - s.title.length < EMPTY);
  const of = read.sections.length;
  const problem = of >= 2 ? empty.length * 2 >= of : read.bytes >= 5000 && read.text < 300;
  return { empty, of, problem };
}

const kb = (b) => `${(b / 1000).toFixed(1)} KB`;
// The line for the model when a page is mostly empty to a reader.
export function pageReadNote(said, read, e) {
  const names = e.empty.slice(0, 8).map((s) => s.title || s.id || 'untitled').join(', ');
  const where = e.of ? `${e.empty.length} of its ${e.of} sections show only their heading (${names})` : `it shows ${read.text} characters`;
  const errs = read.errors?.length ? ` Its scripts stopped with an error when it opened (${read.errors.length}), so whatever they were to put on the page is not there.` : '';
  const sees = !e.of || e.empty.length === e.of ? 'A reader sees almost nothing.' : 'Those sections are empty to a reader.';
  return `${said} was opened ${read.ran ? 'in a browser, its scripts run,' : 'and read'} before your answer: ${where}, ${read.text.toLocaleString('en-US')} characters on screen of ${kb(read.bytes)}.${errs} ${sees} Put the content in the page's own HTML where a reader sees it (not only in scripts or comments), check it again, then answer.`;
}
// The screen's line and the second look's fact.
export function pageReadLine(said, read, e) {
  return e.of
    ? `${said}: ${e.of - e.empty.length} of ${e.of} sections show text, ${read.text.toLocaleString('en-US')} characters on screen of ${kb(read.bytes)}${read.errors?.length ? `, ${read.errors.length} script error${read.errors.length === 1 ? '' : 's'}` : ''}`
    : `${said}: ${read.text.toLocaleString('en-US')} characters on screen of ${kb(read.bytes)}`;
}
