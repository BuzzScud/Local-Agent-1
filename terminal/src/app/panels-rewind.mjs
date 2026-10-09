// The window's panels, /rewind and esc twice on an empty prompt (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { withUndo } from './edit-input.mjs';
import { rowNote, rewindChoices, planLines, names } from './rewind.mjs';

export function panelsRewind(self, own) {
  // /rewind and esc twice on an empty prompt: your messages, newest first,
  // then what to put back to before the one you pick.
  const openRewind = () => {
    const rw = self.rewindRef.current;
    if (self.agent.busy || self.S.current.live.phase === 'working') { self.flash('Wait for Agentic Coder to finish, or press esc first'); return; }
    if (!rw) { self.push({ type: 'note', text: 'Rewind is off here (AGENTIC_REWIND=off).', tone: 'dim' }); return; }
    const items = rw.list().map((m) => ({ ...m, talk: rw.messageIndex(self.agent.messages, m.n) > 0 }));
    if (!items.length) { self.push({ type: 'note', text: 'Nothing to rewind yet: once you send a message, /rewind (or esc twice) can put things back to before it.', tone: 'dim' }); return; }
    self.setNotice(null); // "Press esc again to rewind" has done its job
    self.setPicker({ kind: 'rewind', stage: 'list', items: items.map((m) => ({ ...m, note: rowNote(m) })), index: 0 });
  };
  const chooseRewind = (pk) => {
    const rw = self.rewindRef.current;
    const m = pk.items[pk.index];
    const plan = rw.plan(m.n);
    if (!plan) { self.setPicker(null); return; }
    const options = rewindChoices(plan, m.talk);
    self.setPicker({ ...pk, stage: 'choose', options, choice: 0, lines: planLines(plan, m.talk) });
  };
  const applyRewind = async (pk, what) => {
    self.setPicker(null);
    if (what === 'cancel') return;
    const rw = self.rewindRef.current;
    const m = pk.items[pk.index];
    const said = m.text.split('\n')[0].slice(0, 60) + (m.text.length > 60 || m.text.includes('\n') ? '…' : '');
    if (what === 'both' || what === 'files') {
      const r = await rw.restore(m.n);
      if (r) {
        if (r.put.length) self.push({ type: 'note', text: `Put back ${r.put.length === 1 ? '1 file' : `${r.put.length} files`} to before "${said}": ${names(r.put.map((f) => f.rel), 8)}`, tone: 'ok' });
        for (const f of r.skip) self.push({ type: 'note', text: `Left alone: ${f.rel} (${f.why})`, tone: 'warn' });
        for (const f of r.failed) self.push({ type: 'note', text: `Could not put back ${f.rel}: ${f.why}`, tone: 'error' });
        // Files only: the model is told with your next message, so it reads them again.
        if (what === 'files' && r.put.length) self.pendingContext.current.push(`[The user put these files back to how they were before their message "${said}": ${names(r.put.map((f) => f.rel), 12)}. Your later changes to them are gone; read a file again before you change it.]`);
      }
    }
    if (what === 'both' || what === 'talk') {
      const at = rw.messageIndex(self.agent.messages, m.n);
      if (at > 0 && self.agent.cutBefore(at)) {
        // What happened in those messages is not a lesson any more.
        self.agent.lessons = self.agent.lessons.filter((l) => !(l.at >= m.at));
        rw.dropFrom(m.n);
        self.pendingContext.current = [];
        self.push({ type: 'divider', text: `rewound to before: ${said}` });
        if (what === 'talk') self.push({ type: 'note', text: 'The files stay as they are now.', tone: 'dim' });
        self.setInput((s) => withUndo(s, { value: m.text, cursor: m.text.length }));
        self.saveNow();
      } else self.push({ type: 'note', text: 'That message is no longer in the conversation (it was summarized since), so the conversation stays.', tone: 'warn' });
    }
  };
  return { openRewind, chooseRewind, applyRewind };
}
