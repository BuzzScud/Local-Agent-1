// The window's panels, /hooks: your own hooks and the app's checks (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { permissionOptions } from './permission-options.mjs';
import { hooksEnv, changeHooks } from '../agent/way.mjs';
import { writeUserHooks, eventOf, answerProjectHooks } from '../agent/user-hooks.mjs';
import { openHooksList, testHookForm, hookWarning, toHook, hookListRows, hookFormRows, startHookEdit, commitHookEdit, moveHookRow, openHookForm, checkOn } from './hooks-form.mjs';
import { pasteField, editField } from './remote-form.mjs';
import { saveSettings } from './store.mjs';

export function panelsHooks(self, own) {
  // ---- /hooks (hooks-form.mjs): your own hooks and the app's checks ----
  const hooksList = (patch = {}) => { self.agent.userHooks?.reload(); return { ...openHooksList({ hooks: self.agent.userHooks, checks: self.agent.hooks, way: self.agent.way, lean: self.agent.lean, ...patch }), envSet: hooksEnv(), off: !self.agent.userHooks }; };
  // Your hooks written to ~/.agentic-coder/hooks.json; they work from the next step on.
  const keepHooks = (pk, list) => {
    if (!self.agent.userHooks) { self.setPicker({ ...pk, confirm: null, note: { text: 'Your hooks are off in this window (AGENTIC_USER_HOOKS=off).', tone: 'warn' } }); return false; }
    try { writeUserHooks(list); self.agent.userHooks.reload(); return true; } catch (e) { self.setPicker({ ...pk, confirm: null, note: { text: `That could not be kept: ${e.message}`, tone: 'warn' } }); return false; }
  };
  const runHookTest = (pk) => {
    const id = Date.now();
    self.setPicker({ ...pk, test: { running: true, id } });
    testHookForm(pk, { cwd: self.agent.cwd }).then((res) => self.setPicker((p) => (p?.kind !== 'hooks' || p.test?.id !== id ? p : { ...p, test: { ...res, id } })));
  };
  const saveHookForm = (pk) => {
    const w = hookWarning(pk);
    if (w) { self.setPicker({ ...pk, error: w.text }); return; }
    const hook = toHook(pk, pk.at === null ? {} : pk.yours[pk.at]);
    const list = pk.at === null ? [...pk.yours, hook] : pk.yours.map((h, k) => (k === pk.at ? hook : h));
    if (!keepHooks(pk, list)) return;
    const ev = eventOf(hook.event);
    self.setPicker(hooksList({ index: pk.at ?? list.length - 1, note: { text: `Saved. ${ev.label}${ev.tool ? ` (${hook.matcher || 'every step'})` : ''}, it runs: ${hook.command}. It works from the next step on.` } }));
  };
  const hooksKeys = (pk, ch, key) => {
    if (key.ctrl && ch === 'c') { self.setPicker(null); return; }
    if (pk.view === 'form') {
      if (pk.editing) {
        if (key.return) self.setPicker(commitHookEdit(pk));
        else if (key.escape) self.setPicker({ ...pk, editing: null });
        else self.setPicker({ ...pk, editing: editField(pk.editing, ch, key) });
        return;
      }
      const rows = hookFormRows(pk);
      const n = rows.length;
      const i = Math.min(pk.formIndex, n - 1);
      const row = rows[i];
      const text = row.type === 'text';
      const typed = ch && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab && ch >= ' ';
      if (key.upArrow) self.setPicker({ ...pk, formIndex: (i + n - 1) % n });
      else if (key.downArrow || key.tab) self.setPicker({ ...pk, formIndex: (i + 1) % n });
      else if ((key.leftArrow || key.rightArrow) && row.type === 'choice') { const next = moveHookRow(pk, row.id, key.rightArrow ? 1 : -1); self.setPicker({ ...next, formIndex: Math.max(0, hookFormRows(next).findIndex((r) => r.id === row.id)) }); }
      else if (key.return && text) self.setPicker(startHookEdit(pk, row.id));
      else if (key.return && row.id === 'test') { if (!pk.test?.running) runHookTest(pk); }
      else if (key.return && row.id === 'save') saveHookForm(pk);
      else if (key.return) self.setPicker({ ...pk, formIndex: Math.min(n - 1, i + 1) });
      // Typing on a text row starts it over with what you type (enter keeps the old text to change it).
      else if (typed && text) self.setPicker({ ...startHookEdit(pk, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, ch) });
      else if (key.escape) self.setPicker(hooksList({ index: pk.back, note: { text: pk.at === null ? 'No hook was added.' : 'The hook was kept as it was.' } }));
      return;
    }
    const rows = hookListRows(pk);
    const n = rows.length;
    const i = Math.min(pk.index, n - 1);
    const row = rows[i];
    const say = (text, tone) => self.setPicker({ ...pk, confirm: null, note: { text, tone } });
    const add = () => (self.agent.userHooks ? self.setPicker(openHookForm(pk)) : say('Your hooks are off in this window (AGENTIC_USER_HOOKS=off).', 'warn'));
    if (pk.confirm) {
      if (ch === 'd' && row.hook && !row.theirs && pk.confirm === row.id) {
        if (keepHooks(pk, pk.yours.filter((_, k) => k !== row.at))) self.setPicker(hooksList({ index: Math.max(0, i - 1), note: { text: `Removed: ${row.hook.command}` } }));
      } else self.setPicker({ ...pk, confirm: null });
      return;
    }
    if (key.upArrow) self.setPicker({ ...pk, index: (i + n - 1) % n, note: null });
    else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: (i + 1) % n, note: null });
    else if (key.escape) self.setPicker(null);
    else if (row.id === 'add') { if (key.return || ch === ' ' || ch === 'a') add(); }
    else if (ch === 'a') add();
    else if (row.id === 'project') { if (key.return) askHooksProject(); }
    else if (row.theirs) { if (key.return || ch === ' ') say("This project's hooks follow its file (.agentic/hooks.json); its line above stops them all.", 'dim'); }
    else if (row.check) {
      if (!(key.return || ch === ' ')) return;
      if (self.agent.busy) { say('Wait for Agentic Coder to finish first.', 'warn'); return; }
      if (self.agent.lean) { say('The lean harness is on, so none of these run: /hooks full brings them back.', 'warn'); return; }
      const r = changeHooks(self.agent.hooks, checkOn({ ...pk, way: 'model' }, row.check) ? 'off' : 'on', row.check.id);
      if (r.changed) { self.agent.hooks = r.on; saveSettings({ hooks: [...r.on] }); }
      self.setPicker({ ...pk, checks: new Set(self.agent.hooks), note: { text: `${r.text}${r.changed && self.agent.way === 'app' ? ' (Who decides is App in /effort, so every check runs now anyway.)' : ''}`, tone: r.tone ?? 'dim' } });
    } else if (row.hook) {
      if (key.return || ch === 'e') self.setPicker(openHookForm(pk, row.at));
      else if (ch === ' ') { if (keepHooks(pk, pk.yours.map((h, k) => (k === row.at ? { ...h, off: !h.off } : h)))) self.setPicker(hooksList({ index: i, note: { text: row.hook.off ? `Switched on: ${row.hook.command}` : `Switched off: ${row.hook.command} does not run until you switch it on.` } })); }
      else if (ch === 't') { const f = openHookForm(pk, row.at); runHookTest({ ...f, formIndex: hookFormRows(f).findIndex((r) => r.id === 'test') }); }
      else if (ch === 'd') self.setPicker({ ...pk, confirm: row.id, note: null });
    }
  };
  // A project's own hooks (.agentic/hooks.json): never run before a yes to that very file, asked
  // from /hooks; again when the file changes. Running, the same line stops them.
  const askHooksProject = () => {
    const p = self.agent.userHooks?.project;
    if (!p?.list.length || self.S.current.perm) return;
    const req = { name: 'HooksProject', args: {}, changed: p.changed, running: p.answer === 'yes', hooks: p.list.map((h) => ({ when: eventOf(h.event)?.label ?? h.event, for: eventOf(h.event)?.tool ? h.matcher || 'every step' : '', command: h.command })) };
    self.setPerm({ req, selected: 0, options: permissionOptions(req, null), offer: null, resolve: ({ choice }) => {
      if (choice === 'yes') answerProjectHooks(self.agent.cwd, p.print, 'yes');
      else if (choice === 'never') answerProjectHooks(self.agent.cwd, p.print, 'never');
      else if (choice === 'stop') answerProjectHooks(self.agent.cwd, p.print, null);
      self.agent.userHooks.reload();
      const said = { yes: "This project's hooks run from the next step on. /hooks lists them.", never: "This project's hooks will not run. /hooks can change that.", stop: "This project's hooks stopped; asked again next time." }[choice];
      if (said) self.push({ type: 'note', text: said, tone: 'dim' });
      self.setPicker((x) => (x?.kind === 'hooks' ? hooksList({ index: x.index }) : x));
    } });
  };
  return { hooksList, keepHooks, runHookTest, saveHookForm, hooksKeys, askHooksProject };
}
