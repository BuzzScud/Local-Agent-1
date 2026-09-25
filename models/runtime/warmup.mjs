// Warming up the model before the first message. The model has to read its
// instructions and the tool list (~1,500 tokens, ~26 s on the 27B) before it
// can answer. That part is the same in every project and on every day
// (the caller's system prompt puts this session's details last, after
// sessionMark), so
// after the first read the server saves its state to disk and later starts
// restore it in a fraction of a second. Then only this session's details are
// read. Everything here is best-effort: on any failure it falls back to a
// plain first read.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { SLOT_DIR, thinkingKwargs } from '../registry.mjs';

export const KEEP_SAVED = 2; // ~210 MB each (off/medium share one; high adds a line)

async function post(url, path, body, signal) {
  const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

// Keeps the most recently used saved states, removes the rest.
export function pruneSaved(dir = SLOT_DIR, keep = KEEP_SAVED) {
  let files;
  try { files = readdirSync(dir).filter((f) => /^warm-[0-9a-f]+\.bin$/.test(f)); } catch { return; }
  files.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(keep)
    .forEach(({ f }) => rmSync(join(dir, f), { force: true }));
}

// Reads (or restores) the instructions into slot 0, then this session's part.
// onPhase('restoring' | 'reading') lets the screen say what it waits for.
// sessionMark: where the session's own details start in the system prompt
// (the terminal passes SESSION_MARK from its prompt).
export async function warmUp({ url, model, system, tools, thinking, effort, slot = 0, sessionMark, onPhase = () => {}, signal }) {
  const kw = thinkingKwargs(model, thinking, effort);
  try {
    // The prompt exactly as the model sees it, up to the user's first words.
    const MARK = '\u0001USER\u0001';
    const { prompt } = await post(url, '/apply-template', { messages: [{ role: 'system', content: system }, { role: 'user', content: MARK }], tools, chat_template_kwargs: kw }, signal);
    const upToUser = prompt.slice(0, prompt.indexOf(MARK));
    const cut = (sessionMark ? upToUser.indexOf(sessionMark) : -1);
    if (prompt.indexOf(MARK) < 0 || cut < 0) throw new Error('prompt layout not recognised');
    const shared = upToUser.slice(0, cut);
    const file = `warm-${createHash('sha256').update(`${model.file}\0${shared}`).digest('hex').slice(0, 16)}.bin`;
    let restored = false;
    if (existsSync(join(SLOT_DIR, file))) {
      onPhase('restoring');
      try {
        await post(url, `/slots/${slot}?action=restore`, { filename: file }, signal);
        restored = true;
        const now = new Date();
        utimesSync(join(SLOT_DIR, file), now, now);
      } catch { /* an old or damaged file: read it again below */ }
    }
    if (!restored) {
      onPhase('reading');
      await post(url, '/completion', { prompt: shared, n_predict: 0, cache_prompt: true, id_slot: slot }, signal);
      mkdirSync(SLOT_DIR, { recursive: true });
      await post(url, `/slots/${slot}?action=save`, { filename: file }, signal);
      pruneSaved();
    }
    // This session's details (date, git, tests, project notes): a few hundred tokens.
    await post(url, '/completion', { prompt: upToUser, n_predict: 0, cache_prompt: true, id_slot: slot }, signal);
    return { restored, file };
  } catch (e) {
    if (signal?.aborted) throw e;
    // Fallback: the plain first read, as a normal chat request.
    onPhase('reading');
    await post(url, '/v1/chat/completions', { messages: [{ role: 'system', content: system }, { role: 'user', content: 'hi' }], tools, max_tokens: 1, cache_prompt: true, id_slot: slot, chat_template_kwargs: kw }, signal).catch(() => {});
    return { restored: false, fallback: e.message };
  }
}
