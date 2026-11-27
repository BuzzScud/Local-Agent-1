// The app's side of the workbench's chat ties (27 Nov 2026, workbench-ai.js): the last reply's changed files from its
// /rewind copies (rewind.mjs), a file as it was before that reply, that one file put back, and a commit message the
// model writes from the changes. The window asks with { t: 'act', do: 'wb-…', id } (bridge.mjs act); the answer goes back
// as { t: 'wbx-ai', id, … }, which the window's server hands to the page.
import { complete } from '../flows/llm.mjs';

const STATUS = (f) => (f.before === null ? 'new' : f.after === null ? 'deleted' : 'changed');

// The newest message's files the model changed (its edits and its commands, not someone else's): { n, files } or null.
// The same object while nothing changed, so the window is sent it again only when it did.
let lastTurn = { key: null, v: null };
export function wbTurn(self) {
  const p = self?.rewindRef?.current?.points?.at(-1);
  if (!p) return null;
  const mine = (p.files ?? []).filter((f) => f.by !== 'other');
  const key = `${p.n}\0${mine.map((f) => `${f.path}${f.undone ? '!' : ''}`).join('\0')}`;
  if (lastTurn.key !== key) lastTurn = { key, v: { n: p.n, at: p.at, files: mine.map((f) => ({ path: f.path, status: STATUS(f), undone: Boolean(f.undone) })) } };
  return lastTurn.v;
}

export async function wbAct(self, m, send) {
  const reply = (o) => send({ t: 'wbx-ai', id: m.id ?? null, ...o });
  const rw = self?.rewindRef?.current;
  try {
    if (m.do === 'wb-before') {
      if (!rw) return reply({ why: '/rewind is off here, so nothing was kept from before the reply.' });
      return reply(await rw.beforeOf(Number(m.n), String(m.path ?? '')));
    }
    if (m.do === 'wb-undo') {
      if (!rw) return reply({ ok: false, why: '/rewind is off here, so nothing can be put back.' });
      if (self.agent?.busy) return reply({ ok: false, why: 'wait for the reply under way to finish' });
      return reply(await rw.restoreFile(Number(m.n), String(m.path ?? '')));
    }
    if (m.do === 'wb-ask' && m.what === 'commit') {
      const a = self?.agent;
      if (!a?.model && !a?.url) return reply({ why: 'There is no model to ask (start one with /start or /model).' });
      if (self.modelOff) return reply({ why: 'The model is off: /start it first.' });
      const r = await complete({
        what: 'a commit message', url: a.url, model: a.model, slot: a.slots?.side, temperature: 0.2, maxTokens: 300,
        system: 'You write git commit messages. A first line of 72 characters at most saying what the change does, in the style of the recent subjects given; then, only when it helps, a blank line and a few short lines on why. No quotes, no markdown, nothing else.',
        user: `Recent commit subjects:\n${String(m.log ?? '').slice(0, 2000)}\n\nThe change:\n${String(m.patch ?? '').slice(0, 60_000)}`,
      });
      const text = String(r?.text ?? '').replace(/^```\w*\n?|```$/g, '').trim();
      return reply(text ? { text } : { why: 'The model gave no message.' });
    }
    reply({ why: 'Agentic Coder cannot do that here.' });
  } catch (e) { reply({ why: String(e?.message ?? e).slice(0, 300) }); }
}
