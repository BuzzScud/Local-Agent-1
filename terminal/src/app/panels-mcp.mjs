// The window's panels, /mcp: the servers, their keys, and their news (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { join } from 'node:path';
import { permissionOptions } from './permission-options.mjs';
import { pasteField, editField } from './remote-form.mjs';
import { reloadMcp } from './mcp-start.mjs';
import { readProject, serverKey, saveServer, removeServerKey, saveServerKey, mcpLogFile, saveMarks, removeServer, commandLine, answerProject } from './mcp-store.mjs';
import { openMcpList, mcpWarning, formServer, savedNote as mcpSavedNote, listRows as mcpListRows, toggleTool, formRows as mcpFormRows, startMcpEdit, commitMcpEdit, moveMcpRow, openMcpForm, openMcpTools } from './mcp-form.mjs';
import { whereOf as mcpWhere } from '../tools/mcp.mjs';
import { signIn as mcpSignIn, signedIn as mcpSignedIn, signOut as mcpSignOut } from './mcp-auth.mjs';
import { short } from './app-common.mjs';

export function panelsMcp(self, own) {
  const offerList = (kind, name) => {
    const box = self.mcpLists.current[kind];
    if (box[name] === undefined && self.mcpHub) {
      box[name] = null;
      (kind === 'resources' ? self.mcpHub.resources(name) : self.mcpHub.prompts(name)).then((list) => { box[name] = list; self.bumpLists((n) => n + 1); }, () => { box[name] = []; self.bumpLists((n) => n + 1); });
    }
    return box[name] ?? [];
  };
  // Sign in to a server (mcp-auth.mjs): the browser round trip, then the server starts with its token.
  const runMcpSignIn = (cfg, after) => {
    if (self.mcpSigning.current) return;
    const ac = new AbortController();
    self.mcpSigning.current = ac;
    const say = (text, tone) => self.setPicker((p) => (p?.kind === 'mcp' ? { ...p, note: { text, tone }, signing: text.startsWith('Opened') || text.startsWith('Signed in in') ? cfg.name : null } : p));
    say(`Signing in to ${cfg.name}…`);
    mcpSignIn(cfg, { open: self.signinOpen, signal: ac.signal, onStep: (t) => say(t) }).then(async (r) => {
      self.mcpSigning.current = null;
      if (!r.ok) { say(`Not signed in to ${cfg.name}: ${r.error}.`, 'warn'); return; }
      if (after) { await after(); return; }
      if (self.mcpHub.has(cfg.name)) { await self.mcpHub.start(cfg.name); self.agent.mcpStale = true; }
      self.setPicker((p) => (p?.kind === 'mcp' ? { ...mcpList({ index: p.index }), note: { text: r.already ? `${cfg.name}: already signed in.` : `Signed in to ${cfg.name}: the token is in the Keychain. Its tools join at your next message.` } } : p));
    });
  };
  const mcpProjectNow = () => { try { return readProject(self.agent.cwd); } catch { return null; } };
  const mcpList = (more = {}) => openMcpList({ status: self.mcpHub.status(), project: mcpProjectNow(), extras: self.MCP_EXTRAS, ...more });
  const openMcpPicker = () => {
    if (!self.mcpHub) { self.push({ type: 'note', text: 'MCP is switched off for this window (AGENTIC_MCP=off where it started).', tone: 'warn' }); return; }
    self.setPicker(mcpList());
  };
  // The servers as the files have them now, handed to the hub; the model gets the new list at your next message.
  const applyMcp = () => { const r = reloadMcp(self.mcpHub, self.agent.cwd); self.agent.mcpStale = true; self.mcpLists.current = { resources: {}, prompts: {} }; return r; };
  const runMcpTest = (pk) => {
    if (mcpWarning(pk)) { self.setPicker({ ...pk, error: 'Nothing to test yet: fix the line above first.' }); return; }
    const id = ++self.mcpTests.current;
    const server = formServer(pk, { cwd: self.agent.cwd });
    // The key as the form has it now: typed, taken away, or the kept one.
    const key = pk.key !== null ? pk.key || null : pk.server?.hasKey ? serverKey(pk.server) : null;
    self.setPicker({ ...pk, test: { running: true, id }, error: null });
    const test = () => self.mcpHub.test(server, { key }).then((res) => self.setPicker((p) => (p?.kind !== 'mcp' || p.view !== 'form' || p.test?.id !== id ? p : { ...p, test: { ...res, id } })));
    // A server you sign in to: the sign-in first (its token is kept under the server's name), then the test.
    if (server.runs === 'address' && server.auth === 'oauth' && !mcpSignedIn(server)) {
      mcpSignIn(server, { open: self.signinOpen, onStep: (t) => self.setPicker((p) => (p?.kind === 'mcp' && p.test?.id === id ? { ...p, test: { running: true, id, step: t } } : p)) })
        .then((r) => (r.ok ? test() : self.setPicker((p) => (p?.kind !== 'mcp' || p.test?.id !== id ? p : { ...p, test: { ok: false, error: `not signed in: ${r.error}`, id } }))));
      return;
    }
    test();
  };
  // Save: the key to the Keychain (its own entry), the rest to mcp.json; the server starts (again) with it.
  const saveMcp = (pk) => {
    if (mcpWarning(pk)) { self.setPicker({ ...pk, error: 'Nothing was saved: fix the line above first.' }); return; }
    const server = formServer(pk, { cwd: self.agent.cwd });
    try {
      if (pk.key) { server.keyEnd = saveServerKey(server, pk.key); server.hasKey = true; }
      else if (pk.key === '' && pk.server) removeServerKey(pk.server);
      // Renamed: its kept key goes with it.
      else if (pk.was && pk.was !== server.name && pk.server?.hasKey) { const k = serverKey(pk.server); if (k) { saveServerKey(server, k); removeServerKey(pk.server); } }
    } catch (e) { self.setPicker({ ...pk, error: `Nothing was saved: the key could not be kept (${e.message}).` }); return; }
    const r = saveServer(server, { was: pk.was });
    if (!r.ok) { self.setPicker({ ...pk, error: `Nothing was saved: ${r.error}` }); return; }
    applyMcp();
    // A new key under the same settings: started again so it is used.
    if (pk.key !== null && pk.was === server.name) self.mcpHub.start(server.name);
    const list = mcpList();
    self.setPicker({ ...list, index: Math.max(0, list.status.findIndex((s) => s.name === server.name)), note: { text: mcpSavedNote(server) } });
  };
  // /mcp's keys. The list: ↑↓, enter (a server's tools; the form when it is not running), e edit,
  // space on/off, r start again, d d remove. The form: as /web's. The tools: space on/off, r "reads".
  const mcpKeys = (pk, ch, key) => {
    if (key.ctrl && ch === 'c') { self.setPicker(null); return; }
    const cfgOf = (name) => self.mcpHub.servers.get(name)?.cfg ?? null;
    const at = (name) => Math.max(0, self.mcpHub.status().findIndex((s) => s.name === name));
    if (pk.view === 'tools') {
      const n = pk.tools.length;
      if (key.escape) self.setPicker(mcpList({ index: at(pk.server.name) }));
      else if (key.upArrow && n) self.setPicker({ ...pk, toolIndex: (pk.toolIndex + n - 1) % n, open: false });
      else if ((key.downArrow || key.tab) && n) self.setPicker({ ...pk, toolIndex: (pk.toolIndex + 1) % n, open: false });
      else if (key.return && n) self.setPicker({ ...pk, open: !pk.open });
      else if ((ch === ' ' || ch === 'r') && n) {
        // Your marks are kept at once, and the model gets the list with them at your next message.
        const next = toggleTool(pk, ch === ' ' ? 'on' : 'reads');
        const r = saveMarks(pk.server, next.marks, self.agent.cwd);
        if (!r.ok) { self.setPicker({ ...pk, error: 'That could not be kept: mcp.json cannot be read or no longer has this server.' }); return; }
        self.mcpHub.setMarks(pk.server.name, next.marks);
        self.agent.mcpStale = true;
        self.setPicker({ ...next, server: { ...pk.server, marks: next.marks }, status: self.mcpHub.status(), error: null });
      }
      return;
    }
    if (pk.view === 'form') {
      if (pk.editing) {
        if (key.return) self.setPicker(commitMcpEdit(pk));
        else if (key.escape) self.setPicker({ ...pk, editing: null });
        else self.setPicker({ ...pk, editing: editField(pk.editing, ch, key) });
        return;
      }
      const rows = mcpFormRows(pk);
      const n = rows.length;
      const i = Math.min(pk.index, n - 1);
      const row = rows[i];
      const greyed = (row.id === 'net' || row.id === 'local') && !pk.values.sandbox;
      const text = (row.type === 'text' || row.type === 'secret') && !greyed;
      const typed = ch && !key.ctrl && !key.meta && !key.escape && !key.return && !key.tab && ch >= ' ';
      if (key.upArrow) self.setPicker({ ...pk, index: (i + n - 1) % n });
      else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: (i + 1) % n });
      else if ((key.leftArrow || key.rightArrow) && row.type === 'choice' && !greyed) { const next = moveMcpRow(pk, row.id, key.rightArrow ? 1 : -1); self.setPicker({ ...next, index: Math.max(0, mcpFormRows(next).findIndex((r) => r.id === row.id)) }); }
      else if (key.return && text) self.setPicker(startMcpEdit(pk, row.id));
      else if (key.return && row.id === 'test') { if (!pk.test?.running) runMcpTest(pk); }
      else if (key.return && row.id === 'save') saveMcp(pk);
      else if (key.return) self.setPicker({ ...pk, index: Math.min(n - 1, i + 1) });
      // Typing on a text row starts it over with what you type (enter keeps the old text to change it).
      else if (typed && text) self.setPicker({ ...startMcpEdit(pk, row.id), editing: pasteField({ id: row.id, value: '', cursor: 0 }, ch) });
      else if (key.escape) self.setPicker(mcpList({ index: pk.was ? at(pk.was) : pk.status.length, note: { text: pk.was ? `${pk.was} kept as it was.` : 'No server was added.' } }));
      return;
    }
    const rows = mcpListRows(pk);
    const n = rows.length;
    const row = rows[Math.min(pk.index, n - 1)];
    const cfg = row.server ? cfgOf(row.server.name) : null;
    const theirs = cfg?.from === 'project';
    const say = (text, tone) => self.setPicker({ ...pk, confirm: null, note: { text, tone } });
    if (self.mcpSigning.current && key.escape) { self.mcpSigning.current.abort(); return; }
    if (pk.confirm) {
      if (ch === 'd' && cfg && pk.confirm === cfg.name) {
        removeServer(cfg.name);
        try { removeServerKey(cfg); } catch { /* no key was kept */ }
        applyMcp();
        self.setPicker(mcpList({ index: Math.min(pk.index, self.mcpHub.status().length), note: { text: `${cfg.name} removed.` } }));
      } else self.setPicker({ ...pk, confirm: null });
      return;
    }
    const edit = () => self.setPicker({ ...openMcpForm(pk, cfg), names: pk.status.map((s) => s.name) });
    const tools = () => self.setPicker(openMcpTools(pk, cfg, self.mcpHub.toolsOf(cfg.name)));
    if (key.upArrow) self.setPicker({ ...pk, index: (Math.min(pk.index, n - 1) + n - 1) % n, note: null });
    else if (key.downArrow || key.tab) self.setPicker({ ...pk, index: (Math.min(pk.index, n - 1) + 1) % n, note: null });
    else if (key.escape) self.setPicker(null);
    else if (row.id === 'add') { if (key.return || ch === ' ') self.setPicker({ ...openMcpForm(pk), names: pk.status.map((s) => s.name) }); }
    else if (row.id === 'project') { if (key.return) askMcpProject(mcpProjectNow()); }
    else if (!cfg) return;
    else if (key.return && row.server.state === 'signin') runMcpSignIn(cfg);
    else if (key.return) { if (row.server.state === 'connected') tools(); else if (theirs) say(`${cfg.name} is this project's own (.agentic/mcp.json): it is changed in that file. It is ${row.server.state === 'off' ? 'off' : `not running: ${row.server.error ?? ''}`}.`, 'warn'); else edit(); }
    else if (ch === 't') tools();
    else if (ch === 'e') { if (theirs) say(`${cfg.name} is this project's own: it is changed in .agentic/mcp.json (and asked about again after).`, 'warn'); else edit(); }
    else if (ch === ' ') {
      if (theirs) { say(`${cfg.name} follows this project's file. To stop the project's servers, answer "never" (the project's line, or /mcp after a change).`, 'warn'); return; }
      const r = saveServer({ ...cfg, on: cfg.on === false });
      if (!r.ok) { say(r.error ?? 'That could not be kept.', 'warn'); return; }
      applyMcp();
      self.setPicker(mcpList({ index: pk.index, note: { text: cfg.on === false ? `${cfg.name} switched on: starting it. Its tools join at your next message.` : `${cfg.name} switched off: stopped, and its tools leave at your next message.` } }));
    } else if (ch === 'r') { self.mcpHub.start(cfg.name); self.agent.mcpStale = true; self.setPicker({ ...pk, status: self.mcpHub.status(), note: { text: `Starting ${cfg.name} again… Its tools join at your next message.` } }); }
    else if (ch === 'd') { if (theirs) say(`${cfg.name} is this project's own: remove it from .agentic/mcp.json.`, 'warn'); else self.setPicker({ ...pk, confirm: cfg.name, note: null }); }
    else if (ch === 'l') say(`${cfg.name}'s own messages: ${short(mcpLogFile(cfg.name))}`);
    else if (ch === 's') { if (cfg.runs === 'address' && cfg.auth === 'oauth') runMcpSignIn(cfg); else say(`${cfg.name} does not sign in in a browser${cfg.runs === 'address' ? ' (its Sign in row: e to change it)' : ''}.`); }
    else if (ch === 'o') { if (cfg.runs === 'address' && cfg.auth === 'oauth') { mcpSignOut(cfg); self.mcpHub.start(cfg.name); self.agent.mcpStale = true; say(`Signed out of ${cfg.name}: its token is gone from the Keychain. s signs in again.`); } else say(`${cfg.name} has no sign-in to take back.`); }
  };
  // A project's own servers (.agentic/mcp.json): asked before they may start, in every mode, and
  // again when the file changes. Yes starts them; never is kept; "not now" asks again next time.
  const askMcpProject = (project) => {
    if (!project?.servers.length || self.S.current.perm) return;
    const req = { name: 'McpProject', args: {}, changed: project.changed, servers: project.servers.map((s) => ({ name: s.name, line: s.runs === 'command' ? commandLine(s) : s.url, where: mcpWhere(s) })) };
    self.setPerm({ req, selected: 0, options: permissionOptions(req, null), offer: null, resolve: ({ choice }) => {
      if (choice === 'yes') { answerProject(self.agent.cwd, project.print, 'yes'); applyMcp(); self.push({ type: 'note', text: `This project's MCP server${project.servers.length === 1 ? '' : 's'} (${project.servers.map((s) => s.name).join(', ')}) may start. Each tool still asks before its first use; /mcp lists them.`, tone: 'dim' }); }
      else if (choice === 'never') { answerProject(self.agent.cwd, project.print, 'never'); self.push({ type: 'note', text: "This project's MCP servers will not be started. /mcp can change that.", tone: 'dim' }); }
      else self.push({ type: 'note', text: "This project's MCP servers are not started. /mcp shows them when you want to look.", tone: 'dim' });
      self.setPicker((p) => (p?.kind === 'mcp' ? mcpList({ index: p.index }) : p));
    } });
  };
  // The hub's news: a server that stopped or would not start, and one that changed its tools (the
  // conversation keeps the list it started with: agent.mjs mcpTake).
  const mcpNews = () => {
    if (!self.mcpHub) return undefined;
    if (self.mcpRef.current.broken) self.push({ type: 'note', text: `MCP: ${self.mcpRef.current.broken}. No server of that file is started until it is fixed.`, tone: 'warn' });
    const onState = ({ name, state, error }) => {
      self.setPicker((p) => (p?.kind === 'mcp' ? { ...p, status: self.mcpHub.status() } : p));
      if (state === 'failed') self.push({ type: 'note', text: `MCP: ${name} is not running: ${error}. /mcp shows it; its log is ${short(mcpLogFile(name))}.`, tone: 'warn' });
      if (state === 'signin') self.push({ type: 'note', text: `MCP: ${name} needs you to sign in: /mcp, then s on it.`, tone: 'warn' });
    };
    const onChanged = ({ name, added, removed, changed }) => {
      const parts = [added.length ? `${added.length} new` : '', changed.length ? `${changed.length} changed` : '', removed.length ? `${removed.length} gone` : ''].filter(Boolean).join(', ');
      self.setPicker((p) => (p?.kind === 'mcp' ? { ...p, status: self.mcpHub.status() } : p));
      self.push({ type: 'note', text: `MCP: ${name} changed its tools (${parts}). This conversation keeps the list it started with; /clear or the next conversation uses the new one.${changed.length ? ' A changed tool you had allowed asks again.' : ''}`, tone: 'dim' });
    };
    self.mcpHub.on('state', onState);
    self.mcpHub.on('changed', onChanged);
    // A project's own servers, when its file has not been answered (or changed since).
    const p = self.mcpRef.current.project;
    const t = p?.servers.length && p.answer === null ? setTimeout(() => askMcpProject(mcpProjectNow()), 50) : null;
    return () => { self.mcpHub.off('state', onState); self.mcpHub.off('changed', onChanged); clearTimeout(t); };
  };
  return { offerList, runMcpSignIn, mcpProjectNow, mcpList, openMcpPicker, applyMcp, runMcpTest, saveMcp, mcpKeys, askMcpProject, mcpNews };
}
