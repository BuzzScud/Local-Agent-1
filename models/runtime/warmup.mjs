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
import { SLOT_DIR, engineOf, thinkingKwargs, modelPath } from '../registry.mjs';
import { hasDraft } from './server.mjs';
import { endpointOf, authHeaders } from './remote.mjs';

export const KEEP_SAVED = 2; // ~210 MB each (off/medium share one; high adds a line)
// Whole first reads, this session's part included (folder, date, git, notes):
// a second start with the same instructions skips even that part. ~225 MB each.
const KEEP_WHOLE = 4;

async function post(url, path, body, signal) {
  const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(url) }, body: JSON.stringify(body), signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

// Keeps the most recently used saved states, removes the rest.
export function pruneSaved(dir = SLOT_DIR, keep = KEEP_SAVED, kind = /^warm-[0-9a-f]+\.bin$/) {
  let files;
  try { files = readdirSync(dir).filter((f) => kind.test(f)); } catch { return; }
  files.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(keep)
    .forEach(({ f }) => rmSync(join(dir, f), { force: true }));
}

// Reads (or restores) the instructions into slot 0, then this session's part.
// onPhase('restoring' | 'reading') lets the screen say what it waits for.
// sessionMark: where the session's own details start in the system prompt
// (the terminal passes SESSION_MARK from its prompt).
// helper: whether the server really runs the guessing helper (it can be off
// at High effort even when the file is there); default: the env/file check.
export async function warmUp({ url, model, system, tools, thinking, effort, slot = 0, sessionMark, helper: helperOn, onPhase = () => {}, signal }) {
  const kw = thinkingKwargs(model, thinking, effort);
  // A remote (/remote) that is not llama.cpp cannot read ahead: its first reply reads the instructions.
  const ep = endpointOf(url);
  if (ep?.remote && ep.kind !== 'llama') return { restored: false, skipped: true };
  try {
    // The prompt exactly as the model sees it, up to the user's first words.
    const MARK = '\u0001USER\u0001';
    const { prompt } = await post(url, '/apply-template', { messages: [{ role: 'system', content: system }, { role: 'user', content: MARK }], tools, chat_template_kwargs: kw }, signal);
    const upToUser = prompt.slice(0, prompt.indexOf(MARK));
    const cut = (sessionMark ? upToUser.indexOf(sessionMark) : -1);
    if (prompt.indexOf(MARK) < 0 || cut < 0) throw new Error('prompt layout not recognised');
    const shared = upToUser.slice(0, cut);
    // A llama.cpp server on another machine: the instructions are read into
    // its memory (reused while it runs), and nothing is saved on its disk,
    // where no one here would clear the files (~210 MB each).
    if (ep?.remote) {
      onPhase('reading');
      await post(url, '/completion', { prompt: upToUser, n_predict: 0, cache_prompt: true, id_slot: slot }, signal);
      return { restored: false, remote: true };
    }
    // A saved state belongs to one engine build, one helper setup and one set
    // of WEIGHTS: the file's name plus when it last changed. An edited copy
    // saved again under the same name gets new keys, so a state read with
    // older weights is never restored onto newer ones.
    const helper = (helperOn ?? hasDraft(model)) ? model.draft.file : '';
    let stamp = ''; try { stamp = String(Math.round(statSync(modelPath(model)).mtimeMs)); } catch {}
    const key = (text) => createHash('sha256').update(`${model.file}\0${stamp}\0${engineOf(model).tag}\0${helper}\0${text}`).digest('hex').slice(0, 16);
    const file = `warm-${key(shared)}.bin`;
    // The same instructions as a start before (same folder, day, git state):
    // restore everything up to your first words at once.
    const whole = `warmw-${key(upToUser)}.bin`;
    if (existsSync(join(SLOT_DIR, whole))) {
      onPhase('restoring');
      try {
        await post(url, `/slots/${slot}?action=restore`, { filename: whole }, signal);
        const now = new Date();
        utimesSync(join(SLOT_DIR, whole), now, now);
        return { restored: true, whole: true, file: whole };
      } catch { /* an old or damaged file: the usual way below */ }
    }
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
    try {
      await post(url, `/slots/${slot}?action=save`, { filename: whole }, signal);
      pruneSaved(SLOT_DIR, KEEP_WHOLE, /^warmw-[0-9a-f]+\.bin$/);
    } catch { /* saving is only a speed-up */ }
    return { restored, file };
  } catch (e) {
    if (signal?.aborted) throw e;
    // Fallback: the plain first read, as a normal chat request.
    onPhase('reading');
    await post(url, '/v1/chat/completions', { messages: [{ role: 'system', content: system }, { role: 'user', content: 'hi' }], tools, max_tokens: 1, cache_prompt: true, id_slot: slot, chat_template_kwargs: kw }, signal).catch(() => {});
    return { restored: false, fallback: e.message };
  }
}
