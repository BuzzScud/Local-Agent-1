// The window's keys and mouse (App.jsx): sending what was typed, the / menu's completion, the mouse, and
// onKey, where every key goes first.
// The functions are the App's own, moved here word for word: the App's names (and App.jsx's) are read through
// self, which App makes at each render, so a function sees the values of the render that made it.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { heldRows, holdRoom, stepRuns, printedAt, pieceAt } from './screen.jsx';
import { runWords, rowWords } from './task-rows.jsx';
import { homeItems } from './home-looks.jsx';
import { homeNav, itemAt, lookOf } from './home-nav.mjs';
import { hookFormRows, startHookEdit } from './hooks-form.mjs';
import { nextMode } from '../agent/permissions.mjs';
import { HOME } from '../../../models/index.mjs';
import { attachDropped, attachClipboard, quickLook, trayItems } from './attach.mjs';
import { pasteField, editField, rowsOf as remoteRows, startEdit } from './remote-form.mjs';
import { WEB_ROWS } from './web-form.mjs';
import { withUndo, insertText, promptTextWidth, cursorCell, posAt, wordAt, moveBy, cursorLine, selectedText, undoEdit, redoEdit, editInput } from './edit-input.mjs';
import { DOUBLE_CLICK_MS, parseCursorReply, parseMouse, REST_MS, ASK_CURSOR } from './mouse.mjs';
import { fromScreen } from './screen-copy.mjs';
import { addHistory } from './store.mjs';
import { formRows as mcpFormRows, startMcpEdit } from './mcp-form.mjs';
import { isQuit } from '../flows/words.mjs';
import { pick, PLACEHOLDERS, IDLE } from './app-common.mjs';
import { askPaste, askState } from './app-ask.mjs';
import { pickerKeysPart } from './keys-pickers.mjs';

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
    self.setHandedBack(false); // and takes the mouse back from Terminal (handBack)
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
    // /usage: a paste goes into the value being typed (an Admin key, a figure from the Console).
    if (rp?.kind === 'usage') {
      if (rp.editing) self.setPicker({ ...rp, editing: pasteField(rp.editing, text) });
      return;
    }
    // Agentic Coder's question: a paste goes into the row you type into.
    const pp = self.S.current.perm;
    if (pp?.req.name === 'Ask') { self.setPerm({ ...pp, ask: askPaste(pp.ask ?? askState(pp.req), text) }); return; }
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
  // An item of the start page done (home-looks.jsx: a click on it, or enter while it is picked): a
  // conversation opens as /resume would; an action does what its row says.
  const doHomeItem = (it) => {
    self.setHomeFocus(null);
    if (it.kind === 'conv') { self.holdRef.current = false; self.resumeSession(it.id); return; }
    if (it.id === 'new') { self.flash('Type what you want in the box below, then press enter', 2500); return; }
    if (it.id === 'start') { self.toggleFnRef.current('home'); return; }
    if (it.id === 'mode') { self.setMode(nextMode(self.S.current.mode)); return; }
    const slash = { model: '/model', resume: '/resume', init: '/init', settings: '/settings', look: '/home', helpers: '/profiles' }[it.id];
    if (slash) self.runSlash(slash);
  };
  // The start page's items from the keyboard, while it is up in a look that has them: tab from an empty
  // prompt picks the first; then the arrows move by where items sit, tab goes to the next, enter does
  // it, esc goes back to the prompt, and any other key goes back to the prompt and does what it does
  // there (a letter is typed, shift+tab switches the mode). true: the key was the page's.
  const homeKey = (ch, key) => {
    const cur = self.S.current;
    const focus = self.homeFocusRef.current;
    if (!self.holdRef.current || lookOf(cur.homeLook) === 'launcher' || self.menu) { if (focus) self.setHomeFocus(null); return false; }
    const items = () => homeItems(self.start, self.width);
    if (!focus) {
      if (!key.tab || key.shift || cur.input.value) return false;
      const first = items()[0];
      if (first) self.setHomeFocus(first.key);
      return Boolean(first);
    }
    const dir = key.upArrow ? 'up' : key.downArrow ? 'down' : key.leftArrow ? 'left' : key.rightArrow ? 'right' : key.tab && !key.shift ? 'next' : null;
    if (dir) { self.setHomeFocus(homeNav(items(), focus, dir)); return true; }
    if (key.return) { const it = items().find((x) => x.key === focus); if (it) doHomeItem(it); else self.setHomeFocus(null); return true; }
    self.setHomeFocus(null);
    return Boolean(key.escape);
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
    // The footer's row is inside the box, under its dotted rule (8 Oct 2026): a press on the model's label switches it.
    const f = self.footerRef.current;
    if (row === boxRows + 1 && f?.labelAt && ev.col >= f.labelAt.from && ev.col <= f.labelAt.to) { m.down = false; self.toggleFnRef.current('click'); return; }
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
  // What the pointer is on, above the live part (the prompt box, the footer, the tray, the bot and the reply
  // under way, which stay the app's): { kind: 'group', id } on a task row, or a row of an open one, that a
  // click opens or closes (screen.jsx pieceAt), else
  // { kind: 'text' }, the printed conversation, Terminal's to highlight. null on the live part, or while the
  // start page is up (its rows take clicks, printed or not). The row is counted up from the live part, which
  // ends on the row over the cursor's (screen.jsx printedAt).
  const onConversation = (ev) => {
    if (self.holdRef.current || self.startClicks) return null;
    const h = self.liveBoxRef.current?.yogaNode?.getComputedHeight?.();
    const top = h ? (self.rows ?? 40) - h : null; // the last row printed above it (rows count from 1)
    if (top == null || ev.row > top) return null;
    if (self.stepsView.steps !== 'grouped') return { kind: 'text' };
    const hit = printedAt(self.itemsRef.current, self.measure.current, self.S.current.live?.phase === 'working', top - ev.row + 1);
    const id = hit ? pieceAt(hit.it, hit.row, self.measure.current) : null;
    return id ? { kind: 'group', id } : { kind: 'text' };
  };
  // The mouse back to Terminal until a key or a paste (App.jsx handedBack): its own highlight, double and
  // triple click and scrolling, as in Claude Code. Said once a window.
  const handBack = () => {
    const m = self.mouseRef.current;
    clearTimeout(m.rest);
    m.down = false;
    self.setHandedBack(true);
    if (!m.told) { m.told = true; self.flash('The conversation’s text is Terminal’s: drag to highlight, ⌘C copies · any key gives the mouse back', 4000); }
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
    if (ev?.kind === 'move') {
      self.botPointer.current = { col: ev.col, row: ev.row }; // the bot's eyes follow it (bot-layer.jsx)
      // Resting on the conversation's text, the pointer hands the mouse to Terminal (mouse.mjs REST_MS).
      clearTimeout(m.rest);
      if (self.mouse && onConversation(ev)?.kind === 'text') m.rest = setTimeout(handBack, REST_MS);
      return;
    }
    if (!ev || ev.kind === 'other') return;
    // A press on the conversation: on a box of steps it opens it, or on an open one's top edge closes it
    // (/steps grouped); on its text it hands the mouse to Terminal, for the drag to be Terminal's own.
    const on = ev.kind === 'press' ? onConversation(ev) : null;
    if (on?.kind === 'group') { self.toggleGroup(on.id); return; }
    if (on) {
      if (self.mouse) { handBack(); self.flash('Terminal has the mouse now: drag again to highlight, ⌘C copies · any key gives it back', 3500); }
      return;
    }
    // A press on a Recent activity row of the start page: that conversation, as /resume would open it.
    // The page's row on screen is Ink's own layout of it (its box's top and its parents'), counted from
    // the window's first row, where the app starts drawing (cli.jsx).
    const top = ev.kind === 'press' && self.startClicks ? startPageTop() : null;
    if (top != null) {
      const hit = itemAt(homeItems(self.start, self.width), ev.row - 1 - top, ev.col);
      if (hit) { doHomeItem(hit); return; }
    }
    if (!self.mouse) return; // armed only for the start page's rows
    if (ev.kind === 'wheel') { handBack(); return; }
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
    // one at a time while an item of the start page is picked: each moves the pick (homeKey)
    if (keys.length === 1 || self.homeFocusRef.current) { keys.forEach((k) => onKey('', k)); return; }
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
  const { permKeys, btwKeys, serviceKeys, modelKeys, formKeys, limitsKeys, choiceKeys, rewindKeys } = pickerKeysPart(self);
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
    if (cur.perm) { permKeys(cur, ch, key); return; }
    // The /btw panel: its keys only, and the main job goes on. esc, enter,
    // space or ctrl+c close it (stopping an answer still being written).
    if (cur.btw && !cur.answerWait) { btwKeys(cur, ch, key); return; }
    // Model picker: ↑↓ model, ←→ thinking, enter saves
    // /model on an Ollama service (remote-models.mjs): ↑↓ a row, ←→ the highlighted model's effort,
    // letters filter by name (backspace takes one back, esc clears it, then closes), enter switches
    // to the model (one without tools asks first), opens or shuts a fold, or goes to a model here.
    // /profiles and /model's step 2 (app-profiles.mjs).
    if (cur.picker?.kind === 'profiles') { self.profilesKey(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'profile-step') { self.profileStepKey(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'service') { serviceKeys(cur, ch, key); return; }
    if (cur.picker?.kind === 'model') { modelKeys(cur, ch, key); return; }
    // /remote: ↑↓ a row (↑ from Run on lands on Connect), ←→ a choice row (More: open / fold;
    // the last row: Connect or Save only; a text row: edit it), a letter edits a text row. Once the
    // service has what Connect needs, enter connects from any row, or saves on Save only (the owner's
    // pick, 3 Oct 2026); before that, enter edits a text row, opens or folds More, and on a choice
    // row goes to the next row. While a row is being edited, its keys only. /web: the same form
    // keys, its own rows (web-form.mjs), Test and Save.
    // /mcp: the list of your MCP servers, one server's form, its tools (mcpKeys).
    if (cur.picker?.kind === 'mcp') { self.mcpKeys(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'hooks') { self.hooksKeys(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'remote' || cur.picker?.kind === 'web') { formKeys(cur, ch, key); return; }
    // /effort: ↑↓ a row (Effort first, then the limits), ←→ lower / raise it, enter saves all of it (on the last row: everything back to its default), esc keeps them.
    // /model's menu for a model on the service is the same panel with its own rows (pk.own): enter switches to it, esc goes back to the list.
    // On a service, s fills in the suggested values, and the last row puts the model back on the shared settings.
    if (cur.picker?.kind === 'limits') { limitsKeys(cur, ch, key); return; }
    // A choice menu (/mode, /meters, /mouse): ↑↓ or a number, enter picks, esc goes back unchanged
    // /jumptomac alone: the box of your Macs (jump-box.mjs).
    if (cur.picker?.kind === 'jump') { self.jumpBoxKey(cur.picker, ch, key); return; }
    if (cur.picker?.kind === 'choice') { choiceKeys(cur, ch, key); return; }
    // /rewind: ↑↓ a message, enter shows what would go back; then ↑↓ or a
    // number picks what to put back, esc goes back to the list.
    if (cur.picker?.kind === 'rewind') { rewindKeys(cur, ch, key); return; }
    // /usage: r asks Anthropic for the limits now (one tiny request) and its bill; l your limit, s the month's
    // spend as the Console shows it, k an Admin key, each typed in the card's last row (enter saves, esc
    // goes back); esc, enter or q closes it.
    if (cur.picker?.kind === 'usage') {
      const pk = cur.picker;
      if (pk.editing) {
        if (key.return) self.saveUsageEdit(pk.editing);
        else if (key.escape || (key.ctrl && ch === 'c')) self.setPicker({ ...pk, editing: null });
        else self.setPicker({ ...pk, editing: editField(pk.editing, ch, key) });
        return;
      }
      const id = { l: 'limit', s: 'spent', k: 'key' }[ch];
      if (ch === 'r' && !pk.asking) self.askUsage();
      else if (id) { const value = id === 'limit' && self.S.current.usage?.ownLimit ? String(self.S.current.usage.ownLimit) : ''; self.setPicker({ ...pk, editing: { id, value, cursor: value.length } }); }
      else if (key.escape || key.return || ch === 'q' || (key.ctrl && ch === 'c')) self.setPicker(null);
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
    // ctrl+o's list of task rows: ↑↓ one, enter opens or closes it, esc goes back
    if (cur.picker?.kind === 'groups') {
      const pk = cur.picker;
      if (key.upArrow) self.setPicker({ ...pk, index: Math.max(0, pk.index - 1) });
      else if (key.downArrow) self.setPicker({ ...pk, index: Math.min(pk.items.length - 1, pk.index + 1) });
      else if (key.return) { self.setPicker(null); self.toggleGroup(pk.items[pk.index].key); }
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
    if (homeKey(ch, key)) return;
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
      // grouped (/steps): the task rows printed, newest first, an open one's rows under it; enter opens or
      // closes the one picked
      if (self.stepsView.steps === 'grouped') {
        const runs = stepRuns(self.itemsRef.current, self.stepsView).reverse();
        const items = runs.flatMap((t) => [
          { key: t.id, label: runWords(t.run), desc: t.open ? '· open: enter closes it' : '' },
          ...(t.open ? t.run.rows.map((r) => ({ key: r.id, label: rowWords(r), desc: t.openRows.has(r.id) ? '· open' : '' })) : []),
        ]);
        if (items.length) { self.setPicker({ kind: 'groups', title: 'Open or close a task row', items, index: 0 }); return; }
      }
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
