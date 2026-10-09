// onKey's panel keys (app-keys.mjs): the permission prompt, /btw, /model, /remote and /web, /effort,
// a choice menu and /rewind, each moved word for word out of onKey, which calls it and returns.
import { existsSync } from 'node:fs';
import { btwLayout } from './screen.jsx';
import { modelPath, serverBinOf, engineOf } from '../../../models/index.mjs';
import { pasteField, rowsOf as remoteRows, startEdit, formReady, modelChoices, moveRow, openModelPick, commitEdit, editField, movePick, moveCopy, closePick, commitPick } from './remote-form.mjs';
import { serviceRows, atRow, moveService, filterService, toggleFold } from './remote-models.mjs';
import { WEB_ROWS, moveWebRow } from './web-form.mjs';
import { withUndo } from './edit-input.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { saveSettings } from './store.mjs';
import { addRule } from './perm-store.mjs';
import { rememberAllowed } from './mcp-store.mjs';
import { sendToMain } from '../agent/btw.mjs';
import { shownLimits, moveLimit, defaultLevelId, defaultLimits } from './limits.mjs';
import { pick } from './app-common.mjs';
import { askKey, askState } from './app-ask.mjs';

export function pickerKeysPart(self) {
  const permKeys = (cur, ch, key) => {
    const p = cur.perm;
    // Agentic Coder's question: the box's own keys (app-ask.mjs): tabs, ticks, the row you type into.
    if (p.req.name === 'Ask') {
      if (key.ctrl && ch === 'c') { self.interrupt(); return; }
      const box = p.ask ?? askState(p.req);
      const r = askKey(p.req, box, ch, key);
      if (r.flash) self.flash(r.flash, 2500);
      if (r.done) {
        self.setPerm(null);
        p.resolve(r.done);
        if (r.done.choice === 'no' || r.done.stopped) self.setPlaceholder('Tell Agentic Coder what to do instead');
      } else if (r.box !== box) self.setPerm({ ...p, ask: r.box });
      return;
    }
    const n = p.options.length;
    const choose = (i) => {
      const o = p.options[i];
      self.setPerm(null);
      if (!o) { p.resolve({ choice: 'no' }); return; }
      const choice = o.choice;
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
    else if (key.return) choose(p.selected);
    else if (key.escape) choose(no);
    else if (key.tab && key.shift && always >= 0 && p.req.name !== 'Bash') choose(always);
    else if (/^[1-9]$/.test(ch) && Number(ch) <= n) choose(Number(ch) - 1);
    else if (key.ctrl && ch === 'c') self.interrupt();
    return;
  };
  const btwKeys = (cur, ch, key) => {
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
  };
  const serviceKeys = (cur, ch, key) => {
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
  };
  const modelKeys = (cur, ch, key) => {
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
  };
  const formKeys = (cur, ch, key) => {
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
  };
  const limitsKeys = (cur, ch, key) => {
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
  };
  const choiceKeys = (cur, ch, key) => {
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
      if (pk.id === 'remote-scope') { self.applyChoice('remote-scope', 'later'); return; }
      if (pk.id === 'start-where') { self.applyChoice('start-where', 'main'); return; }
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
  };
  const rewindKeys = (cur, ch, key) => {
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
  };
  return { permKeys, btwKeys, serviceKeys, modelKeys, formKeys, limitsKeys, choiceKeys, rewindKeys };
}
