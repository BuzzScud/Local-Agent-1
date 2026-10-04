// The helper models of /subagents at work (2 Oct 2026, the user's picks): other models
// on the same Ollama service as the main one, each with a job. The panel and the
// defaults are terminal/src/app/subagents.mjs; this file is what each job does.
//   pictures     a picture your model cannot see is described by one that can, and
//                the words go in its place
//   side         the summary of a long chat, /btw and a memory save (agent.sideUse)
//   search       the code search's meanings, from the service (RemoteEmbedder)
//   review       a second opinion on a finished change: the request and the diff in,
//                at most three real problems out (or "LGTM")
//   designWrite  a page request runs on this model (agent.turnUse)
//   designCheck  a picture of the page it just built, looked at by a model that sees
// A helper is asked through the main model's endpoint with another model named
// (client.mjs `use`); one that cannot load or answer never stops the work: the job
// falls back to the main model or is skipped, with a note.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { streamChat } from './client.mjs';
import { authHeaders } from '../../../models/index.mjs';

export const MAIN = 'main';
// The context each helper is loaded at: small, so it fits beside the main model.
export const HELPER_CTX = { side: 32_768, pictures: 8_192, review: 32_768, designCheck: 16_384, designWrite: null };
// How long the service keeps a helper after its last job (the main model: as long as the window is open).
export const HELPER_KEEP = '30m';

// A job as /subagents saved it, with the service's entry for its model (ollama.mjs),
// as the endpoint override client.mjs takes; undefined when the job is off, has no
// model, or is the main model itself.
export function useOf(job, id) {
  if (!job?.on || !job.model || job.model === MAIN) return undefined;
  const e = job.entry ?? {};
  return { model: job.model, ...(HELPER_CTX[id] ? { numCtx: HELPER_CTX[id] } : {}), thinks: Boolean(e.thinking), tools: e.tools !== false, family: e.family ?? '', keepAlive: HELPER_KEEP };
}

// One answer from a helper, as text: { text, secs, tokS }.
async function helperText({ url, use, messages, maxTokens = 600, thinking = false, effort, model, signal }) {
  const t0 = Date.now();
  let text = '', tokS;
  for await (const ev of streamChat({ url, use, messages, maxTokens, thinking, effort, model, sampling: { temperature: 0.2 }, signal })) {
    if (ev.type === 'text') text += ev.text;
    if (ev.type === 'done') tokS = ev.timings?.predicted_per_second;
  }
  return { text: text.trim(), secs: (Date.now() - t0) / 1000, tokS };
}

// Pictures → words, for a main model that cannot see. question: what you asked with them.
export async function describePictures({ url, use, images, question = '', signal }) {
  const ask = [
    { role: 'system', content: 'You describe pictures for a coding assistant that cannot see them. Be exact and complete: every piece of text you can read (word for word), the layout, any error message, and anything that looks broken or out of place. No guesses about what you cannot see.' },
    { role: 'user', content: `${question ? `The user's message with ${images.length === 1 ? 'this picture' : 'these pictures'}: "${question.slice(0, 600)}"\n\n` : ''}Describe ${images.length === 1 ? 'the picture' : 'each picture in turn'}.`, images },
  ];
  return helperText({ url, use, messages: ask, maxTokens: 700, signal });
}

// The words a description goes into the message as.
export const describedNote = (images, model, text) => `(The user attached ${images.length === 1 ? 'a picture' : `${images.length} pictures`} (${images.map((i) => i.path).join(', ')}). You cannot see ${images.length === 1 ? 'it' : 'them'}; ${model}, which can, describes ${images.length === 1 ? 'it' : 'them'}:\n${text})`;

// A second opinion on a finished change. Answers { ok, findings: [line, …], secs }:
// ok when it found nothing; at most three findings, each one line.
export async function reviewChange({ url, use, request, diff, signal }) {
  const ask = [
    { role: 'system', content: 'You review a code change another assistant just made. Report only real problems: bugs, a part of the request not done, something broken or removed by mistake. Not style, not naming, not ideas for more. If there is nothing real, answer exactly: LGTM' },
    { role: 'user', content: `The request:\n${String(request).slice(0, 2000)}\n\nThe change (diff):\n${String(diff).slice(-24_000)}\n\nList at most 3 real problems, one per line, each starting with "- " and naming the file. Or answer LGTM.` },
  ];
  // One that can think does, a little (gpt-oss at its lowest level); the room is for the thinking and the answer.
  const think = use?.thinks ? (/gpt-?oss/i.test(`${use.family ?? ''} ${use.model}`) ? 'low' : true) : undefined;
  const r = await helperText({ url, use: { ...use, think }, messages: ask, maxTokens: think ? 3000 : 500, signal });
  return { ...r, ...findingsOf(r.text) };
}

// A picture of a page, looked at by a model that sees. Answers { ok, findings, secs }.
export async function checkPagePicture({ url, use, image, page, request, signal }) {
  const ask = [
    { role: 'system', content: 'You check how a web page looks, from a screenshot. Report only what a person would see as wrong: overlapping or cut-off text, things off the edge, unreadable colours, broken alignment, empty areas that should hold something. If it looks right, answer exactly: LGTM' },
    { role: 'user', content: `The page ${page}, made for this request: "${String(request).slice(0, 600)}". The screenshot is 1440 px wide.\n\nList at most 3 problems, one per line, each starting with "- ". Or answer LGTM.`, images: [image] },
  ];
  const r = await helperText({ url, use, messages: ask, maxTokens: 400, signal });
  return { ...r, ...findingsOf(r.text) };
}

// "LGTM" or "- one\n- two" → { ok, findings }.
export function findingsOf(text) {
  const t = String(text ?? '').trim();
  const findings = t.split('\n').map((l) => l.trim()).filter((l) => /^[-*•]\s+\S/.test(l) || /^\d+[.)]\s+\S/.test(l)).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, '')).slice(0, 3);
  if (!findings.length && /\bLGTM\b|looks good|no (real )?problems/i.test(t)) return { ok: true, findings: [] };
  return { ok: findings.length === 0, findings };
}

// A 1440 × 900 picture of a page in headless Chrome (layoutcheck's findChrome), as
// the conversation carries one: { path, mime, data, w, h }; null when it cannot be made.
// Quick Look (macOS qlmanage) draws a page's top when there is no Chrome (4 Oct 2026: the Mac the
// owner's report page was made on has none, so no page was ever looked at there).
export const canQuickLook = () => process.platform === 'darwin' && existsSync('/usr/bin/qlmanage');
function quickLookPage(abs) {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-look-'));
  try {
    spawnSync('/usr/bin/qlmanage', ['-t', '-s', '1440', '-o', dir, abs], { timeout: 30_000, stdio: 'ignore' });
    const png = readFileSync(join(dir, `${basename(abs)}.png`));
    // The size from the PNG's own header (IHDR: width at byte 16, height at 20).
    return { path: abs, mime: 'image/png', data: png.toString('base64'), w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function screenshotPage(abs, chrome) {
  if (!chrome) return canQuickLook() ? quickLookPage(abs) : null;
  const dir = mkdtempSync(join(tmpdir(), 'agentic-look-'));
  const out = join(dir, 'page.png');
  try {
    spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900', `--screenshot=${out}`, pathToFileURL(abs).href], { timeout: 30_000, stdio: 'ignore' });
    const data = readFileSync(out).toString('base64');
    return { path: abs, mime: 'image/png', data, w: 1440, h: 900 };
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The code search's meanings from the service (Ollama's /api/embed), shaped as
// models/runtime/embed.mjs's Embedder: start(), embed(texts) → unit-length vectors,
// stop(). Its `model.file` names it, so the saved vectors of this Mac's embedder
// are never mixed with these (rank.mjs, codeindex keep them by that name).
export class RemoteEmbedder {
  constructor({ url, model }) {
    this.url = url;
    this.model = { id: model, file: `remote:${model}`, remote: true };
    this.cache = new Map();
  }
  async start() { return this.url; }
  async embed(texts, { signal } = {}) {
    if (!texts.length) return [];
    const keys = texts.map((t) => String(t).slice(0, 4000));
    const want = [...new Set(keys.filter((k) => !this.cache.has(k)))];
    for (let i = 0; i < want.length; i += 16) {
      const batch = want.slice(i, i + 16);
      const res = await fetch(`${this.url.replace(/\/+$/, '')}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(this.url) }, signal, body: JSON.stringify({ model: this.model.id, input: batch, keep_alive: HELPER_KEEP }) });
      if (!res.ok) throw new Error(`the service's ${this.model.id} answered ${res.status}`);
      const rows = (await res.json()).embeddings ?? [];
      rows.forEach((r, k) => {
        const v = Float32Array.from(r);
        let n = 0;
        for (const x of v) n += x * x;
        n = Math.sqrt(n) || 1;
        for (let j = 0; j < v.length; j++) v[j] /= n;
        this.cache.set(batch[k], v);
      });
    }
    const out = keys.map((k) => this.cache.get(k));
    while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value);
    return out;
  }
  async stop() {}
}
