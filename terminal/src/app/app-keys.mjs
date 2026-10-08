// The window's keys and mouse (App.jsx): sending what was typed, the / menu's completion, the mouse, and
// onKey, where every key goes first.
// The functions are the App's own, moved here word for word: the App's names (and App.jsx's) are read through
// self, which App makes at each render, so a function sees the values of the render that made it.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { heldRows, holdRoom, btwLayout } from './screen.jsx';
import { recentRows } from './start.jsx';
import { hookFormRows, startHookEdit } from './hooks-form.mjs';
import { nextMode } from '../agent/permissions.mjs';
import { modelPath, serverBinOf, engineOf, HOME } from '../../../models/index.mjs';
import { attachDropped, attachClipboard, quickLook, trayItems } from './attach.mjs';
import { pasteField, rowsOf as remoteRows, startEdit, formReady, modelChoices, moveRow, openModelPick, commitEdit, editField, movePick, moveCopy, closePick, commitPick } from './remote-form.mjs';
import { serviceRows, atRow, moveService, filterService, toggleFold } from './remote-models.mjs';
import { WEB_ROWS, moveWebRow } from './web-form.mjs';
import { withUndo, insertText, promptTextWidth, cursorCell, posAt, wordAt, moveBy, cursorLine, selectedText, undoEdit, redoEdit, editInput } from './edit-input.mjs';
import { DOUBLE_CLICK_MS, parseCursorReply, parseMouse, WHEEL_PAUSE_MS, ASK_CURSOR } from './mouse.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { fromScreen } from './screen-copy.mjs';
import { addHistory, saveSettings } from './store.mjs';
import { addRule } from './perm-store.mjs';
import { rememberAllowed } from './mcp-store.mjs';
import { formRows as mcpFormRows, startMcpEdit } from './mcp-form.mjs';
import { sendToMain } from '../agent/btw.mjs';
import { shownLimits, moveLimit, defaultLevelId, defaultLimits } from './limits.mjs';
import { isQuit } from '../flows/words.mjs';
import { pick, PLACEHOLDERS, IDLE } from './app-common.mjs';

export function keysPart(self) {
  const submitFn = (raw) => {
    const value = raw.replace(/\s+$/, '');
    self.setInput({ value: '', cursor: 0 });
    self.setShowShortcuts(false);
    self.histIdx.current = null;
    if (!value.trim()) return;
    if (self.answerRef.current) {
      // The answer to Agentic Coder's question, shown like a message of yours.
      const resolve = self.answerRef.current;
      self.answerRef.current = null;
      self.setAnswerWait(false);
      // During a turn the Ask step shows the answer ("You: …"); an echo of it would say it twice.
      if (!self.railOn.current) self.push({ type: 'user', text: value });
      addHistory(self.cwd, value);
      self.historyRef.current.push(value);
      self.setPlaceholder(pick(PLACEHOLDERS));
      resolve({ choice: 'answer', text: value });
      return;
    }
    if (value.startsWith('/')) { self.runSlash(value); return; }
    if (value.startsWith('!')) { self.runShell(value.slice(1).trim()); return; }
    // While /agents runs, a message is a note for its next step (the model is busy with the run).
    if (self.agentsRef.current?.running && !isQuit(value)) {
      self.agentsRef.current.note(value);
      self.push({ type: 'note', text: `Noted for /agents: "${value}" goes with its next step. esc opens the tree.`, tone: 'dim' });
      return;
    }
    // "exit" or "quit" typed as a plain message quits, like /exit.
    if (isQuit(value)) { self.quit(); return; }
    addHistory(self.cwd, value);
    self.historyRef.current.push(value);
    self.setTip(null);
    // A model loading on the service: the message waits for it (preloadRemote sends it).
    if (self.agent.busy || self.S.current.starting || self.S.current.remoteState === 'loading') { self.queuedRef.current = value; self.setQueued(value); return; }
    self.sendPrompt(value);
  };

  const completeMenu = (m, idx) => {
    const it = m.items[idx];
    if (m.kind === 'slash') { const v = `/${it.value}${it.takesArg ? ' ' : ''}`; self.setInput({ value: v, cursor: v.length }); return v; }
    const before = self.input.value.slice(0, m.at.start);
    const after = self.input.value.slice(self.input.cursor);
    const v = it.open ? `${before}@${it.value}${after.replace(/^\s+/, '')}` : `${before}@${it.value} ${after.replace(/^\s+/, '')}`;
    self.setInput({ value: v, cursor: before.length + it.value.length + (it.open ? 1 : 2) });
    return v;
  };

  // A file dropped into the window (Terminal types its path) or pasted as a path: a picture or PDF
  // becomes [Image #n] or [PDF #n] at once, copied, and the tray over the box shows it (attach.mjs);
  // any other file or a folder becomes [File #n] or [Folder #n] when the paste is only paths (a drop).
  // Other text comes back as it was, and so does a path for a shell command of yours (!).
  const withChips = (text) => {
    if (!/[/~'"]/.test(text) || self.S.current.input.value.startsWith('!')) return text;
    const pasted = self.pastedRef.current;
    const r = attachDropped(text, { cwd: self.cwd, pasted, dir: join(HOME, 'attachments'), id: self.sessionRef.current.id });
    if (r.failed.length) self.flash(`Could not attach ${r.failed[0].path.split('/').pop()}: ${r.failed[0].error}`, 3500);
    else if (r.added.length) self.flash(r.added.length === 1 ? `${{ pdf: 'PDF', image: 'Picture', folder: 'Folder' }[r.added[0].kind] ?? 'File'} attached as ${r.added[0].token}` : `${r.added.length} files attached`, 2500);
    return r.text;
  };
  // ctrl+f, or a click on a card in the tray: the attachments full size, in Quick Look.
  const openAttached = (ns) => {
    const files = ns.map((n) => self.pastedRef.current.files.get(n)).filter((f) => f && existsSync(f));
    if (!files.length) { self.flash('Nothing attached in the prompt to open (drag a file in, or ctrl+v a picture)', 2500); return; }
    if (!quickLook(files)) self.flash('Quick Look did not open', 2500);
  };

  const onPaste = (text) => {
    self.setPopup(null); // a paste closes the /help box, like any key
    // /remote: a paste goes into the row being edited (an API key, an address), or starts editing a text row.
    const rp = self.S.current.picker;
    // /mcp's form: a paste goes into the row being edited, or starts editing a text row (a key, a command, an address).
    if (rp?.kind === 'mcp') {
      if (rp.view !== 'form') return;
      const row = mcpFormRows(rp)[Math.min(rp.index, mcpFormRows(rp).length - 1)];
      const greyed = (row?.id === 'net' || row?.id === 'local') && !rp.values.sandbox;
      if (rp.editing) self.setPicker({ ...rp, editing: pasteField(rp.editing, text) });
      else if ((row?.type === 'text' || row?.type === 'secret') && !greyed) self.setPicker({ ...startMcpEdit(rp, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, text) });
      return;
    }
    // /hooks' form: a paste goes into the row being edited, or starts editing a text row (a command).
    if (rp?.kind === 'hooks') {
      if (rp.view !== 'form') return;
      const row = hookFormRows(rp)[Math.min(rp.formIndex, hookFormRows(rp).length - 1)];
      if (rp.editing) self.setPicker({ ...rp, editing: pasteField(rp.editing, text) });
      else if (row?.type === 'text') self.setPicker({ ...startHookEdit(rp, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, text) });
      return;
    }
    if (rp?.kind === 'remote' || rp?.kind === 'web') {
      const row = (rp.kind === 'web' ? WEB_ROWS : remoteRows(rp))[rp.index];
      if (rp.editing) self.setPicker({ ...rp, editing: pasteField(rp.editing, text) });
      else if (row?.type === 'text' || row?.type === 'secret') self.setPicker({ ...startEdit(rp, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, text) });
      return;
    }
    if (self.S.current.perm || self.S.current.picker || (self.S.current.btw && !self.S.current.answerWait)) return;
    // Text copied off this screen (your message, the prompt box) comes back as it was written:
    // without the screen's line breaks, indents, padding and │ edges. ctrl+z gives the paste as copied.
    const raw = withChips(text.replace(/\r\n?/g, '\n'));
    const clean = fromScreen(raw, { cols: self.width });
    self.setInput((s) => {
      const pasted = withUndo(s, insertText(s, raw));
      return clean === raw ? pasted : withUndo(pasted, insertText(s, clean));
    });
  };

  // The prompt box's rows as it draws them (its width; the ! of shell mode is not drawn).
  const rowsOf = (s) => ({ width: promptTextWidth(self.width), skip: s.value.startsWith('!') ? 1 : 0 });
  // The start page's first line, in the window's rows from 0, or null when it is not where a click can
  // find it. Held (a start on this Mac): Ink's own layout of it, its box's top and its parents', from the
  // window's first row, where the app starts drawing (cli.jsx). Printed (a start on a remote): the
  // conversation's first item, on the first row, until your first message and while nothing has
  // scrolled it away (the hold's own measure, screen.jsx holdRoom).
  const startPageTop = () => {
    if (self.holdRef.current && self.pageRef.current) { let top = 0; for (let n = self.pageRef.current; n; n = n.parentNode) top += n.yogaNode?.getComputedTop?.() ?? 0; return top; }
    if (self.items[0]?.type === 'welcome' && !self.items.some((it) => it.type === 'user') && heldRows(self.items, self.measure.current) <= holdRoom(self.items, self.measure.current, self.rows ?? 40)) return 0;
    return null;
  };
  // One press, drag or release, with the box's place on screen known (origin:
  // the screen row and cell of the first row's first letter).
  const onMouse = (ev) => {
    const m = self.mouseRef.current;
    const s = self.S.current.input;
    const o = rowsOf(s);
    const row = ev.row - m.origin.row, x = ev.col - m.origin.col;
    if (ev.kind === 'release') { m.down = false; return; }
    if (ev.kind === 'drag') {
      if (!m.down) return;
      const to = posAt(s, row, x, o);
      self.setInput((p) => withUndo(p, { value: p.value, cursor: to, anchor: p.anchor ?? p.cursor }));
      return;
    }
    const boxRows = cursorCell(s, o).rows.length;
    // The footer's row is two under the box's bottom edge (a blank row between): a press on the model's label switches it.
    const f = self.footerRef.current;
    if (row === boxRows + 2 && f?.labelAt && ev.col >= f.labelAt.from && ev.col <= f.labelAt.to) { m.down = false; self.toggleFnRef.current('click'); return; }
    // The tray sits on the rows over the box's top edge: a press on a card opens it in Quick Look.
    const t = self.trayRef.current;
    if (t && row < -1 && row >= -1 - t.height) {
      m.down = false;
      const hit = t.cards.find((c) => ev.col >= c.from && ev.col <= c.to);
      if (hit) openAttached([hit.n]);
      return;
    }
    // a press counts only on one of the box's own rows
    if (row < 0 || row >= boxRows) { m.down = false; return; }
    const to = posAt(s, row, x, o);
    const again = Boolean(m.last) && m.last.to === to && Date.now() - m.last.t < DOUBLE_CLICK_MS;
    m.last = again ? null : { to, t: Date.now() };
    m.down = !again;
    self.setPopup(null);
    if (again) { const [a, b] = wordAt(s.value, to); self.setInput((p) => withUndo(p, { value: p.value, cursor: b, anchor: a })); return; }
    self.setInput((p) => withUndo(p, { value: p.value, cursor: to, anchor: ev.shift ? (p.anchor ?? p.cursor) : to }));
  };
  const onTerminalReply = (seq) => {
    const m = self.mouseRef.current;
    if (!m.armed || typeof seq !== 'string') return;
    const at = parseCursorReply(seq);
    if (at) {
      if (!m.asked) return;
      clearTimeout(m.asked);
      m.asked = null;
      const c = cursorCell(self.S.current.input, rowsOf(self.S.current.input));
      m.origin = { row: at.row - c.row, col: at.col - c.x };
      m.waiting.splice(0).forEach(onMouse);
      return;
    }
    const ev = parseMouse(seq);
    if (!ev || ev.kind === 'other') return;
    // A press on a Recent activity row of the start page: that conversation, as /resume would open it.
    // The page's row on screen is Ink's own layout of it (its box's top and its parents'), counted from
    // the window's first row, where the app starts drawing (cli.jsx).
    const top = ev.kind === 'press' && self.startClicks ? startPageTop() : null;
    if (top != null) {
      const hit = recentRows(self.start, self.width).find((r) => r.row === ev.row - 1 - top && ev.col >= r.from && ev.col <= r.to);
      if (hit) { self.holdRef.current = false; self.resumeSession(hit.id); return; }
    }
    if (!self.mouse) return; // armed only for the start page's rows
    if (ev.kind === 'wheel') {
      self.setWheelPause(true);
      clearTimeout(m.wheel);
      m.wheel = setTimeout(() => self.setWheelPause(false), WHEEL_PAUSE_MS);
      return;
    }
    if (ev.kind === 'press') {
      clearTimeout(m.asked);
      m.origin = null;
      m.waiting = [ev];
      m.asked = setTimeout(() => { m.asked = null; m.waiting = []; }, 500);
      self.tty.write(ASK_CURSOR);
      return;
    }
    if (m.origin) onMouse(ev);
    else if (m.asked) m.waiting.push(ev);
  };
  const flushArrows = () => {
    const keys = self.arrowsRef.current;
    if (!keys.length) return;
    self.arrowsRef.current = [];
    if (keys.length === 1) { onKey('', keys[0]); return; }
    const n = (k) => keys.filter((x) => x[k]).length;
    self.setPopup(null);
    self.setInput((s) => withUndo(s, moveBy(s, n('downArrow') - n('upArrow'), n('rightArrow') - n('leftArrow'), rowsOf(s))));
  };
  // ctrl+r: a second opinion now (2 Oct 2026, a key for big models). The review helper on an Ollama
  // service (/subagents) reads the last message's request and change, as it does after a change.
  // What it finds goes into an empty prompt, for enter to send to the model.
  const secondOpinionNow = async () => {
    if (self.agent.busy || self.S.current.live.phase === 'working') { self.flash('Wait for Agentic Coder to finish, or press esc first'); return; }
    if (!self.agent.helperUse?.('review')) { self.flash(self.model.remote ? 'No second opinion here: /profiles gives Second opinion a profile of its own' : 'A second opinion needs a review model on an Ollama service (/remote service, then /subagents)', 3000); return; }
    if (!self.agent.turn?.changed || !self.agent.turn.diffs?.trim()) { self.flash('Nothing changed in the last message, so there is nothing to review', 2500); return; }
    const ac = new AbortController();
    self.abortRef.current = ac;
    self.setLive({ phase: 'working', turnStart: Date.now(), verb: 'Checking', tokens: 0 });
    try {
      const found = await self.agent.secondOpinion(ac.signal);
      if (found && !ac.signal.aborted) {
        if (self.S.current.input.value) self.flash('What it found is above; your prompt was left as it is', 3000);
        else { self.setInput((s) => withUndo(s, { value: found, cursor: found.length })); self.flash('What it found is in the prompt: enter sends it to the model', 4000); }
      }
    } catch (e) {
      if (!ac.signal.aborted) self.push({ type: 'note', text: `Second opinion: ${e.message}`, tone: 'error' });
    } finally { self.setLive(IDLE); }
  };
  const onKey = (ch, key) => {
    const cur = self.S.current;
    // A window too small to show the screen takes no keys (enter could answer
    // a question you cannot see), except ctrl+c.
    if (cur.tooSmall && !(key.ctrl && ch === 'c')) return;
    // The start waits for another copy of the model to go: esc starts anyway.
    if (self.waitRef.current && key.escape) { self.waitRef.current.go(); return; }
    // The box in the middle (/help): esc, enter or ctrl+c close it; any other
    // key closes it and does what it always does, so typing goes on as usual.
    if (cur.popup) {
      self.setPopup(null);
      if (key.escape || key.return || (key.ctrl && ch === 'c')) return;
    }
    // /loops has the window: every key is the board's (typing goes in its box), but ctrl+c.
    if (cur.loopsOn && !cur.perm && !cur.picker && !cur.answerWait && !(key.ctrl && ch === 'c')) { self.loopsKey(ch, key); return; }
    // /agents' tree has the window: its keys first (a permission prompt or a question shows over it).
    if (cur.agentsView === 'tree' && self.agentsRef.current && !cur.perm && !cur.picker && !cur.answerWait) {
      if (self.agentsKey(ch, key)) return;
    }
    // Permission prompt
    if (cur.perm) {
      const p = cur.perm;
      const n = p.options.length;
      // A question where several may be ticked: the ticked choices, in the list's order.
      const several = p.req.name === 'Ask' && Boolean(p.req.args?.several);
      const tickedText = () => (p.ticked ?? []).slice().sort((a, b) => a - b).map((i) => p.options[i].text);
      const tick = (i) => { if (p.options[i]?.choice !== 'answer') return; const t = p.ticked ?? []; self.setPerm({ ...p, selected: i, ticked: t.includes(i) ? t.filter((x) => x !== i) : [...t, i] }); };
      const choose = (i) => {
        const o = p.options[i];
        // A question has no "no" row: esc stops it.
        if (!o) { self.setPerm(null); p.resolve({ choice: 'no' }); self.setPlaceholder('Tell Agentic Coder what to do instead'); return; }
        const choice = o.choice;
        self.setPerm(null);
        // Agentic Coder's question: a listed choice answers it; "type" takes the next line you enter
        // (with the ones ticked before it, on a question where several may be ticked).
        if (choice === 'type') {
          const before = several ? tickedText() : [];
          self.answerRef.current = before.length ? (a) => p.resolve(a.choice === 'answer' ? { ...a, text: [...before, a.text].join(', ') } : a) : p.resolve;
          self.setAnswerWait(true); self.setPlaceholder('Type your answer to Agentic Coder, then enter'); return;
        }
        if (choice === 'answer') { const t = several ? tickedText() : []; p.resolve({ choice, text: t.length ? t.join(', ') : o.text }); return; }
        // "Always allow": saved for this folder, and it runs now. If it cannot be saved it still holds for this session.
        if (choice === 'save') {
          const r = addRule(self.agentRef.current.cwd, 'allow', p.offer.rule);
          // An MCP tool is allowed as the tool it is now: one that changes later asks again (its fingerprint).
          if (p.req.mcp && (r.ok || r.duplicate)) { try { rememberAllowed(p.req.mcp.id, p.req.mcp.print); } catch { /* it asks again next time */ } }
          self.push({ type: 'note', text: r.ok ? `Saved for this folder: "${p.offer.rule}" runs without asking. /permissions lists it; /permissions remove allow <n> takes it back.` : r.duplicate ? `"${p.offer.rule}" is already saved.` : `${r.error} It holds for this session only.`, tone: r.ok || r.duplicate ? 'dim' : 'warn' });
          p.resolve({ choice: r.ok || r.duplicate ? 'yes' : 'always' });
          return;
        }
        p.resolve({ choice });
        if (choice === 'no' && p.req.name !== 'McpProject' && p.req.name !== 'HooksProject') self.setPlaceholder('Tell Agentic Coder what to do instead');
      };
      const always = p.options.findIndex((o) => o.choice === 'always');
      const no = p.options.findIndex((o) => o.choice === 'no');
      if (key.upArrow) self.setPerm({ ...p, selected: (p.selected + n - 1) % n });
      else if (key.downArrow) self.setPerm({ ...p, selected: (p.selected + 1) % n });
      else if (several && ch === ' ') tick(p.selected);
      else if (key.return) choose(p.selected);
      else if (key.escape) choose(no);
      else if (key.tab && key.shift && always >= 0 && p.req.name !== 'Bash') choose(always);
      else if (/^[1-9]$/.test(ch) && Number(ch) <= n) { if (several && p.options[Number(ch) - 1].choice === 'answer') tick(Number(ch) - 1); else choose(Number(ch) - 1); }
      else if (key.ctrl && ch === 'c') self.interrupt();
      return;
    }
    // The /btw panel: its keys only, and the main job goes on. esc, enter,
    // space or ctrl+c close it (stopping an answer still being written).
    if (cur.btw && !cur.answerWait) {
      const b = cur.btw;
      if (key.escape || key.return || ch === ' ' || (key.ctrl && ch === 'c')) { self.closeBtw(); return; }
      const step = key.pageUp || key.pageDown ? 5 : 1;
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
        const L = btwLayout({ btw: b, width: self.width, rows: self.rows ?? 40 });
        const at = key.upArrow || key.pageUp ? L.offset - step : L.offset + step;
        self.setBtw((x) => (x && x.id === b.id ? { ...x, scroll: Math.min(L.maxOffset, Math.max(0, at)) } : x));
        return;
      }
      if (ch === 'c' && b.text && b.phase !== 'answering') {
        if (copyToClipboard(b.text)) self.flash(`copied the answer (${b.text.length.toLocaleString()} chars) to clipboard`, 2500);
        return;
      }
      if (ch === 'f' && b.phase === 'done') {
        self.pendingContext.current.push(sendToMain(b.question, b.text));
        self.closeBtw();
        self.push({ type: 'note', text: 'The side question and its answer go to Agentic Coder with your next message.', tone: 'dim' });
        return;
      }
      return;
    }
    // Model picker: ↑↓ model, ←→ thinking, enter saves
    // /model on an Ollama service (remote-models.mjs): ↑↓ a row, ←→ the highlighted model's effort,
    // letters filter by name (backspace takes one back, esc clears it, then closes), enter switches
    // to the model (one without tools asks first), opens or shuts a fold, or goes to a model here.
    // /profiles and /model's step 2 (app-profiles.mjs).
    if (cur.picker?.kind === 'profiles') { self.profilesKey(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'profile-step') { self.profileStepKey(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'service') {
      const pk = cur.picker;
      const sv = self.serviceOf(pk);
      const rows = serviceRows(pk, sv);
      const row = atRow(pk, rows);
      const typed = ch && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab ? ch.replace(/[\x00-\x1f\x7f]/g, '') : '';
      if (key.upArrow) self.setPicker(moveService(pk, rows, -1));
      else if (key.downArrow) self.setPicker(moveService(pk, rows, 1));
      else if (key.escape) self.setPicker(pk.filter ? filterService(pk, sv, '') : null);
      else if (key.ctrl && ch === 'c') self.setPicker(null);
      else if (key.backspace || key.delete) { if (pk.filter) self.setPicker(filterService(pk, sv, pk.filter.slice(0, -1))); }
      else if (key.return && row) {
        if (row.kind === 'fold') { self.setPicker(toggleFold(pk, row.id)); return; }
        if (row.kind === 'service') { self.setPicker(null); self.remoteTo(row.s.source); return; }
        if (row.kind === 'local') { self.setPicker(null); self.pickHere(row.m); return; }
        // A model on the service: its own settings first, and nothing loads until enter there (the
        // user's pick, 2 Oct 2026). One without tools is asked about before that.
        if (!row.m.tools && row.m.id !== sv.inUse) { self.setPicker(null); self.chatOnlyRef.current = { m: row.m, back: pk }; self.openChoice('service-chat-only'); return; }
        self.openProfileStep(row.m, pk);
      } else if (typed) self.setPicker(filterService(pk, sv, pk.filter + typed));
      return;
    }
    if (cur.picker?.kind === 'model') {
      const pk = cur.picker;
      // ←→ step through the highlighted model's own levels, from the one it shows now.
      const levels = self.pickLevels(pk), k = levels.findIndex((l) => l.id === self.pickLevel(pk).id);
      const toLevel = (i) => (levels[i] ? { levelId: levels[i].id, on: Boolean(levels[i].effort) } : {});
      if (key.leftArrow) self.setPicker({ ...pk, ...toLevel(Math.max(0, k - 1)) });
      else if (key.rightArrow || key.tab) self.setPicker({ ...pk, ...toLevel(key.tab ? (k + 1) % levels.length : Math.min(levels.length - 1, k + 1)) });
      else if (key.upArrow) self.setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
      else if (key.downArrow) self.setPicker({ ...pk, index: Math.min(pk.models.length - 1, pk.index + 1) });
      else if (key.escape || (key.ctrl && ch === 'c')) self.setPicker(null);
      else if (key.return) {
        const lv = self.pickLevel(pk);
        const on = !!lv?.effort;
        const picked = pk.models[pk.index];
        // The level is the picked model's: this Mac's (shared), or the remote in use's (its own); a model
        // of another service takes its own, or its default, when it connects.
        self.setThinking(on, on ? lv.id : undefined, { target: picked.remoteRow ? (self.model.remote?.source === picked.source ? self.model : null) : picked });
        self.setPicker(null);
        // A remote's row: that service, as /remote claude (computer, service) would. A model here while on a remote: back to this Mac.
        if (picked.remoteRow) {
          if (self.model.remote?.source === picked.source && self.remoteRef.current.conn) self.push({ type: 'note', text: `${self.model.name} · effort ${lv?.label.toLowerCase() ?? 'low'}.`, tone: 'dim' });
          else self.remoteTo(picked.source);
          return;
        }
        if (self.model.remote) { self.pickHere(picked); return; }
        // A different model — or the same edited copy with newer edits saved
        // since — restarts the model server in place; the window stays.
        const changed = picked.id !== self.model.id || (picked.edited && self.model.edited && picked.edited.saved !== self.model.edited.saved);
        self.switchBackRef.current = null; // your pick wins over a model coming back after a picture
        // A model whose file (or its own model server) is not here yet: say how to get it, keep the one in use.
        const missing = changed && !picked.edited ? [!existsSync(modelPath(picked)) && `downloads it (${(picked.bytes / 1e9).toFixed(1)} GB)`, picked.engine && !existsSync(serverBinOf(picked)) && (engineOf(picked).python ? 'sets up its Python (a few minutes)' : 'builds its model server (about 3 minutes)')].filter(Boolean) : [];
        if (missing.length) { self.push({ type: 'note', text: `${picked.name} is not ready on this Mac yet: coding setup --model ${picked.id} ${missing.join(' and ')}. Then pick it again.`, tone: 'warn' }); return; }
        if (changed) { saveSettings({ model: picked.id }); self.switchModel(picked); }
        else self.push({ type: 'note', text: `${picked.name} · effort ${lv?.label.toLowerCase() ?? 'low'}.`, tone: 'dim' });
      }
      return;
    }
    // /remote: ↑↓ a row (↑ from Run on lands on Connect), ←→ a choice row (More: open / fold;
    // the last row: Connect or Save only; a text row: edit it), a letter edits a text row. Once the
    // service has what Connect needs, enter connects from any row, or saves on Save only (the owner's
    // pick, 3 Oct 2026); before that, enter edits a text row, opens or folds More, and on a choice
    // row goes to the next row. While a row is being edited, its keys only. /web: the same form
    // keys, its own rows (web-form.mjs), Test and Save.
    // /mcp: the list of your MCP servers, one server's form, its tools (mcpKeys).
    if (cur.picker?.kind === 'mcp') { self.mcpKeys(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'hooks') { self.hooksKeys(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'remote' || cur.picker?.kind === 'web') {
      const pk = cur.picker;
      const web = pk.kind === 'web';
      const kept = web ? 'Web settings kept as they were.' : 'Remote kept as it was.';
      if (pk.editing) {
        if (key.return) self.setPicker(commitEdit(pk));
        else if (key.escape) self.setPicker({ ...pk, editing: null });
        else if (key.ctrl && ch === 'c') { self.setPicker(null); self.push({ type: 'note', text: kept, tone: 'dim' }); }
        else self.setPicker({ ...pk, editing: editField(pk.editing, ch, key) });
        return;
      }
      if (!web && pk.pick) {
        const n = pk.pick.models.length;
        if (key.upArrow) self.setPicker(movePick(pk, -1));
        else if (key.downArrow || key.tab) self.setPicker(movePick(pk, 1));
        else if (key.leftArrow || key.rightArrow) self.setPicker(moveCopy(pk, key.leftArrow ? -1 : 1));
        else if (key.return) { const next = commitPick(pk); self.setPicker(next); self.connectForm(next); }
        else if (/^[1-9]$/.test(ch) && Number(ch) <= n) { const next = commitPick({ ...pk, pick: { ...pk.pick, index: Number(ch) - 1 } }); self.setPicker(next); self.connectForm(next); }
        else if (key.escape) self.setPicker(closePick(pk));
        else if (key.ctrl && ch === 'c') { self.setPicker(null); self.push({ type: 'note', text: kept, tone: 'dim' }); }
        return;
      }
      const rows = web ? WEB_ROWS : remoteRows(pk);
      const n = rows.length;
      const row = rows[Math.min(pk.index, n - 1)];
      // A key row with no search service picked has nothing to take.
      const text = (row.type === 'text' || row.type === 'secret') && !(web && pk.values.search === 'off');
      const typed = ch && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab && ch >= ' ';
      const ready = !web && formReady(pk);
      if (key.upArrow) self.setPicker({ ...pk, index: (pk.index + n - 1) % n, ...(!web && pk.index === 0 ? { action: 'connect' } : {}) });
      else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: (pk.index + 1) % n });
      // A text row with nothing to step through: ←→ edits it, its text kept (enter connects now).
      else if ((key.leftArrow || key.rightArrow) && !web && text && !(row.id === 'model' && modelChoices(pk).length > 1)) self.setPicker(startEdit(pk, row.id));
      else if (key.leftArrow || key.rightArrow) self.setPicker((web ? moveWebRow : moveRow)(pk, row.id, key.rightArrow ? 1 : -1));
      else if (key.return && ready && row.id === 'go' && pk.action === 'save') self.saveOnlyForm(pk);
      else if (key.return && ready) { if (!pk.test?.running) self.connectForm(pk); }
      else if (key.return && !web && row.id === 'model' && modelChoices(pk).length > 1) self.setPicker(openModelPick(pk));
      else if (key.return && text) self.setPicker(startEdit(pk, row.id));
      else if (key.return && web) (row.id === 'test' ? self.runWebTest : self.saveWeb)(pk);
      else if (key.return && row.id === 'more') self.setPicker({ ...pk, more: !pk.more });
      else if (key.return && row.id === 'go' && pk.action === 'save') self.saveOnlyForm(pk);
      else if (key.return && row.id === 'go') { if (!pk.test?.running) self.connectForm(pk); }
      else if (key.return) self.setPicker({ ...pk, index: Math.min(n - 1, pk.index + 1) });
      // Typing on a text row starts it over with what you type (enter keeps the old text to change it).
      else if (typed && text) self.setPicker({ ...startEdit(pk, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, ch) });
      else if (key.escape || (key.ctrl && ch === 'c')) { self.setPicker(null); self.push({ type: 'note', text: kept, tone: 'dim' }); }
      return;
    }
    // /effort: ↑↓ a row (Effort first, then the limits), ←→ lower / raise it, enter saves all of it (on the last row: everything back to its default), esc keeps them.
    // /model's menu for a model on the service is the same panel with its own rows (pk.own): enter switches to it, esc goes back to the list.
    // On a service, s fills in the suggested values, and the last row puts the model back on the shared settings.
    if (cur.picker?.kind === 'limits') {
      const pk = cur.picker;
      const m = pk.model;
      const levels = m.thinkingLevels ?? [];
      const off = levels.length ? 1 : 0; // the Effort row, when the model has levels
      const shown = shownLimits(m, { own: Boolean(pk.own) });
      const pr = pk.own?.profile ?? null;
      const extra = pr ? 2 : 0; // the profile's Backup and Spill after
      const rows = off + shown.length + extra + 1;
      const step = key.rightArrow ? 1 : -1;
      const at = pk.index - off - shown.length; // 0 Backup, 1 Spill after
      const svc = Boolean(pk.own) || self.onService();
      if (key.upArrow) self.setPicker({ ...pk, index: (pk.index + rows - 1) % rows });
      else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: (pk.index + 1) % rows });
      else if ((key.leftArrow || key.rightArrow) && pr && at === 0) self.setPicker({ ...pk, own: { ...pk.own, profile: { ...pr, backup: Math.max(0, Math.min(pr.backups.length - 1, pr.backup + step)) } } });
      else if ((key.leftArrow || key.rightArrow) && pr && at === 1) self.setPicker({ ...pk, own: { ...pk.own, profile: { ...pr, spill: Math.max(0, Math.min(pr.spills.length - 1, pr.spill + step)) } } });
      else if ((key.leftArrow || key.rightArrow) && off && pk.index === 0) self.setPicker({ ...pk, level: Math.max(0, Math.min(levels.length - 1, pk.level + step)) });
      else if ((key.leftArrow || key.rightArrow) && pk.index >= off && pk.index < off + shown.length) self.setPicker({ ...pk, values: moveLimit(pk.values, shown[pk.index - off].id, step, m) });
      else if (ch === 's' && !key.ctrl && !key.meta && pk.suggested) self.setPicker(self.fillSuggested(pk));
      else if (key.return) {
        const reset = pk.index === rows - 1;
        if (pr) { self.saveProfileStep(pk, { reset }); return; }
        if (pk.own) { self.saveOwnSettings(pk, { reset }); return; }
        self.setPicker(null);
        if (reset && svc) self.saveEffortLimits(off ? levels[pk.level]?.id : null, self.sharedValues(pk), { reset: true });
        else if (reset) self.saveEffortLimits(off ? defaultLevelId(m) : null, defaultLimits(m));
        else self.saveEffortLimits(off ? levels[pk.level]?.id : null, pk.values);
      }
      else if (key.escape && pk.own?.back) self.setPicker(pk.own.back);
      else if (key.escape || (key.ctrl && ch === 'c')) { self.setPicker(null); self.push({ type: 'note', text: pk.own && !pk.own.inUse ? `Not switched: still on ${self.model.remote?.model ?? self.model.name}.` : 'Effort and limits kept as they were.', tone: 'dim' }); }
      return;
    }
    // A choice menu (/mode, /meters, /mouse): ↑↓ or a number, enter picks, esc goes back unchanged
    // /jumptomac alone: the box of your Macs (jump-box.mjs).
    if (cur.picker?.kind === 'jump') { self.jumpBoxKey(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'choice') {
      const pk = cur.picker;
      const n = pk.options.length;
      const pick = (i) => { self.setPicker(null); self.applyChoice(pk.id, pk.options[i].id); };
      if (key.upArrow) self.setPicker({ ...pk, index: (pk.index + n - 1) % n });
      else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: (pk.index + 1) % n });
      else if (key.return) pick(pk.index);
      else if (/^[1-9]$/.test(ch) && Number(ch) <= n) pick(Number(ch) - 1);
      else if (key.escape || (key.ctrl && ch === 'c')) {
        self.setPicker(null);
        if (pk.id === 'memory-save') { self.applyChoice('memory-save', 'skip'); return; }
        if (pk.id === 'remote-saved') { self.applyChoice('remote-saved', 'later'); return; }
        // The message with the picture was not sent: it goes back into the prompt.
        if (pk.id === 'vision-switch') {
          const wait = self.visionWaitRef.current;
          self.visionWaitRef.current = null;
          if (wait) self.setInput((s) => withUndo(s, { value: wait.value, cursor: wait.value.length }));
          self.push({ type: 'note', text: 'Not sent: your message is back in the prompt.', tone: 'dim' });
          return;
        }
        const kept = pk.options.find((o) => o.id === pk.current);
        self.push({ type: 'note', text: `Kept ${pk.what} as ${kept ? kept.label.toLowerCase() : 'it was'}.`, tone: 'dim' });
      }
      return;
    }
    // /rewind: ↑↓ a message, enter shows what would go back; then ↑↓ or a
    // number picks what to put back, esc goes back to the list.
    if (cur.picker?.kind === 'rewind') {
      const pk = cur.picker;
      if (pk.stage === 'list') {
        const n = pk.items.length;
        if (key.upArrow) self.setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
        else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: Math.min(n - 1, pk.index + 1) });
        else if (key.return) self.chooseRewind(pk);
        else if (key.escape || (key.ctrl && ch === 'c')) self.setPicker(null);
        return;
      }
      const n = pk.options.length;
      if (key.upArrow) self.setPicker({ ...pk, choice: (pk.choice + n - 1) % n });
      else if (key.downArrow || key.tab) self.setPicker({ ...pk, choice: (pk.choice + 1) % n });
      else if (key.return) self.applyRewind(pk, pk.options[pk.choice].id);
      else if (/^[1-9]$/.test(ch) && Number(ch) <= n) self.applyRewind(pk, pk.options[Number(ch) - 1].id);
      else if (key.escape) self.setPicker({ ...pk, stage: 'list' });
      else if (key.ctrl && ch === 'c') self.setPicker(null);
      return;
    }
    // /settings: ↑↓ a row, enter runs its command, esc goes back
    if (cur.picker?.kind === 'settings') {
      const pk = cur.picker;
      const n = pk.rows.length;
      if (key.upArrow) self.setPicker({ ...pk, index: (pk.index + n - 1) % n });
      else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: (pk.index + 1) % n });
      else if (key.return) { self.setPicker(null); self.runSlash(`/${pk.rows[pk.index].name}`); }
      else if (key.escape || (key.ctrl && ch === 'c')) self.setPicker(null);
      return;
    }
    // Resume picker
    if (cur.picker) {
      const pk = cur.picker;
      if (key.upArrow) self.setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
      else if (key.downArrow) self.setPicker({ ...pk, index: Math.min(pk.items.length - 1, pk.index + 1) });
      else if (key.escape || (key.ctrl && ch === 'c')) self.setPicker(null);
      else if (key.return) { const id = pk.items[pk.index].key; self.setPicker(null); self.resumeSession(id); }
      return;
    }
    // Keys that work everywhere
    // ctrl+v: the clipboard's picture (a screenshot copied with ctrl+shift+cmd+4, say) attached as [Image #n].
    if (key.ctrl && ch === 'v') {
      try {
        const got = attachClipboard({ pasted: self.pastedRef.current, dir: join(HOME, 'attachments'), id: self.sessionRef.current.id });
        if (!got) { self.flash('No picture on the clipboard (text pastes with cmd+v)', 2500); return; }
        self.setInput((st) => withUndo(st, insertText(st, `${got.token} `)));
        self.flash(`Picture ${got.srcW}×${got.srcH} attached as ${got.token}`, 2500);
      } catch (e) { self.flash(`Could not paste the picture: ${e.message}`, 3000); }
      return;
    }
    // ctrl+f: the files in the prompt, full size in Quick Look (← → go through several).
    if (key.ctrl && ch === 'f') { openAttached(trayItems(cur.input.value, self.pastedRef.current).map((it) => it.n)); return; }
    if (key.ctrl && ch === 'c') {
      if (self.agent.busy || cur.live.phase === 'working') { self.interrupt(); return; }
      if (cur.input.value) { self.setInput((s) => withUndo(s, { value: '', cursor: 0 })); return; } // ctrl+z brings it back
      if (Date.now() - self.exitArmed.current < 2000) { self.quit(); return; }
      self.exitArmed.current = Date.now();
      self.flash('Press ctrl+c again to exit', 2000);
      return;
    }
    if (key.ctrl && ch === 'd' && !cur.input.value) { self.quit(); return; }
    if (key.escape) {
      // An open menu or shortcut list closes first; the next esc stops Agentic Coder.
      if (self.menu) { self.setMenuClosedFor(cur.input.value); return; }
      if (self.showShortcuts) { self.setShowShortcuts(false); return; }
      if (selectedText(cur.input)) { self.setInput((s) => withUndo(s, { value: s.value, cursor: s.cursor })); return; } // drops the selection only
      // /agents goes on behind the chat: esc opens its tree again (/agents stop ends it).
      if (self.agentsRef.current?.running && cur.agentsView === 'chat' && !cur.input.value && !cur.perm) { self.openAgentsTree(); return; }
      if (self.agent.busy || cur.live.phase === 'working') { self.interrupt(); return; }
      if (cur.input.value) {
        if (Date.now() - self.escArmed.current < 1500) { self.setInput((s) => withUndo(s, { value: '', cursor: 0 })); return; } // ctrl+z brings it back
        self.escArmed.current = Date.now();
        self.flash('Press esc again to clear', 1500);
        return;
      }
      // On an empty prompt, esc twice opens /rewind (as in Claude Code).
      if (self.rewindArmed.current && Date.now() - self.rewindArmed.current < 1500) { self.rewindArmed.current = 0; self.openRewind(); return; }
      self.rewindArmed.current = Date.now();
      if (self.rewindRef.current?.points.length) self.flash('Press esc again to rewind', 1500);
      return;
    }
    if (key.tab && key.shift) { self.setMode(nextMode(cur.mode)); return; }
    // ctrl+t: the model on this Mac on or off (the footer's label says which, and how much memory it holds);
    // on a remote, the model list.
    if (key.ctrl && ch === 't') { self.toggleFnRef.current('ctrl+t'); return; }
    // ctrl+p: /compact now. ctrl+r: a second opinion on the last change now (2 Oct 2026, keys for big models).
    if (key.ctrl && ch === 'p') { self.runSlash('/compact'); return; }
    if (key.ctrl && ch === 'r') { secondOpinionNow(); return; }
    if (key.ctrl && ch === 'o') {
      const s = self.folds.current;
      if (!s.list.length) { self.flash('Nothing to expand yet'); return; }
      if (s.back >= s.list.length) { self.flash('That was the first one'); return; }
      const f = s.list[s.list.length - 1 - s.back];
      s.back += 1;
      if (f.context) self.push({ type: 'context', ...f.context, open: true });
      else self.push({ type: 'expand', title: f.title, text: f.text });
      if (s.back < s.list.length) self.flash('ctrl+o again opens the one before', 2000);
      return;
    }
    // Keys typed while the app was busy can arrive together ("on\r"): the
    // Enter in them still sends (a real paste comes through usePaste instead).
    if (ch && ch.length > 1 && ch.includes('\r') && !key.ctrl && !key.meta) {
      const parts = ch.split(/\r\n?/);
      let st = cur.input;
      parts.forEach((part, i) => {
        st = insertText(st, part);
        if (i === parts.length - 1) return;
        if (st.value.endsWith('\\') && st.cursor === st.value.length) st = { value: `${st.value.slice(0, -1)}\n`, cursor: st.value.length };
        else { self.submit(st.value); st = { value: '', cursor: 0 }; }
      });
      self.setInput(st);
      return;
    }
    // A file dropped while Terminal's paste brackets are off arrives as typed keys, all at once.
    if (ch && ch.length > 1 && !key.ctrl && !key.meta) {
      const swapped = withChips(ch);
      if (swapped !== ch) { self.setInput((st) => withUndo(st, insertText(st, swapped))); return; }
    }
    // Menu navigation
    if (self.menu) {
      if (key.upArrow) { self.setMenuIndex((i) => (i - 1 + self.menu.items.length) % self.menu.items.length); return; }
      if (key.downArrow) { self.setMenuIndex((i) => (i + 1) % self.menu.items.length); return; }
      if (key.tab) { completeMenu(self.menu, self.menuIdx); return; }
      if (key.return) {
        if (self.menu.kind === 'slash') {
          const it = self.menu.items[self.menuIdx];
          // a command that takes a word waits for it; one that opens a menu when alone (/effort) runs now
          if (it.takesArg && !it.picker && !/\s/.test(cur.input.value) && `/${it.value}` !== cur.input.value) { completeMenu(self.menu, self.menuIdx); return; }
          self.submit(`/${it.value}`);
          return;
        }
        completeMenu(self.menu, self.menuIdx);
        return;
      }
    }
    // History
    const pos = cursorLine(cur.input, rowsOf(cur.input)); // rows as drawn: ↑ ↓ move inside a long prompt first
    if (key.upArrow && !key.shift && pos.line === 0) {
      const h = self.historyRef.current;
      if (!h.length) return;
      if (self.histIdx.current === null) { self.draftRef.current = cur.input.value; self.histIdx.current = h.length; }
      self.histIdx.current = Math.max(0, self.histIdx.current - 1);
      const v = h[self.histIdx.current];
      self.setInput({ value: v, cursor: v.length });
      return;
    }
    if (key.downArrow && !key.shift && pos.line === pos.lines - 1) {
      if (self.histIdx.current === null) return;
      const h = self.historyRef.current;
      self.histIdx.current += 1;
      const v = self.histIdx.current >= h.length ? self.draftRef.current : h[self.histIdx.current];
      if (self.histIdx.current >= h.length) self.histIdx.current = null;
      self.setInput({ value: v, cursor: v.length });
      return;
    }
    if (key.return) {
      if (cur.input.value.endsWith('\\') && cur.input.cursor === cur.input.value.length) {
        self.setInput({ value: `${cur.input.value.slice(0, -1)}\n`, cursor: cur.input.value.length });
        return;
      }
      self.submit(cur.input.value);
      return;
    }
    if (ch === '?' && !cur.input.value) { self.setShowShortcuts((v) => !v); return; }
    // ctrl+z takes back the last change to the prompt, ctrl+y puts it back
    if (key.ctrl && (ch === 'z' || ch === 'y')) {
      const back = ch === 'z';
      if (!(back ? cur.input.undo : cur.input.redo)?.length) { self.flash(back ? 'Nothing to undo' : 'Nothing to redo', 1500); return; }
      self.setInput((s) => (back ? undoEdit(s) : redoEdit(s)));
      return;
    }
    self.setInput((s) => withUndo(s, editInput(s, ch, key, rowsOf(s))));
  };
  return { submitFn, onPaste, onTerminalReply, flushArrows, onKey };
}
