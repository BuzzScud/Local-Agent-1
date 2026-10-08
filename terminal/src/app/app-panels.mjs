// The window's panels (App.jsx): the helpers, /web, /mcp, /hooks, pictures, /settings, /rewind,
// /permissions, /effort and its limits, and the choices they save.
// The functions are the App's own, moved here word for word: the App's names (and App.jsx's) are read through
// self, which App makes at each render, so a function sees the values of the render that made it.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { permissionOptions } from './screen.jsx';
import { hooksEnv, changeHooks, HOOKS } from '../agent/way.mjs';
import { writeUserHooks, eventOf, answerProjectHooks } from '../agent/user-hooks.mjs';
import { openHooksList, testHookForm, hookWarning, toHook, hookListRows, hookFormRows, startHookEdit, commitHookEdit, moveHookRow, openHookForm, checkOn } from './hooks-form.mjs';
import { screenAccess } from '../tools/screen.mjs';
import { preloadOllama, DEFAULT_REMOTE, saveKey, removeKey, MODELS, modelPath, visionPath, remoteLabel, withVision, readRecord, battleCounts, battleHold, availableBytes, freeWithHandBack, scanServers, searchBytes, thinkingLevel, remoteModel, getVision, setEndpoint, endpointOf, macMemory, ollamaPs, OPEN_KEEP, OPEN_KEEP_MS } from '../../../models/index.mjs';
import { copyDiff } from './copies.mjs';
import { pasteField, editField } from './remote-form.mjs';
import { ctxWord } from './remote-models.mjs';
import { suggestedFor } from './remote-suggested.mjs';
import { jobsOf, MAIN } from './subagents.mjs';
import { serverOf } from './profiles.mjs';
import { RemoteEmbedder } from '../agent/helper-models.mjs';
import { serviceKey, readTryouts } from './tryouts.mjs';
import { openWebForm, testWebForm, webWarning, toWebSettings, webSettings, searchKeyId } from './web-form.mjs';
import { PROVIDER_NAMES } from '../tools/web.mjs';
import { withUndo } from './edit-input.mjs';
import { SETTINGS } from './commands.mjs';
import { listDocs, findDocsDir } from './weights.mjs';
import { VERSION, MODE_OPTIONS } from './help.mjs';
import { memoryDirs, readFacts } from '../agent/facts.mjs';
import { rulesList } from './rules.mjs';
import { saveSettings, loadSettings, saveSession } from './store.mjs';
import { rowNote, rewindChoices, planLines, names } from './rewind.mjs';
import { reloadMcp } from './mcp-start.mjs';
import { readProject, serverKey, saveServer, removeServerKey, saveServerKey, mcpLogFile, saveMarks, removeServer, commandLine, answerProject } from './mcp-store.mjs';
import { openMcpList, mcpWarning, formServer, savedNote as mcpSavedNote, listRows as mcpListRows, toggleTool, formRows as mcpFormRows, startMcpEdit, commitMcpEdit, moveMcpRow, openMcpForm, openMcpTools } from './mcp-form.mjs';
import { whereOf as mcpWhere } from '../tools/mcp.mjs';
import { signIn as mcpSignIn, signedIn as mcpSignedIn, signOut as mcpSignOut } from './mcp-auth.mjs';
import { settingsValue, summary as permSummary, changePermissions } from './perms.mjs';
import { readInstructions } from '../agent/instructions.mjs';
import { searchModels, ownOf, readLimits, OWN_ROWS, effortNote, limitChanges, applyLimits, applySearch, limitsToSave, modelWithLimits, showLimit } from './limits.mjs';
import { short, IDLE } from './app-common.mjs';

export function panelsPart(self) {
  // The /subagents jobs as saved (settings.json `helperModels`, by service address): today's helpers, and
  // the first profiles when there is no profiles.json yet (/profiles shows and sets them since 8 Oct 2026).
  const subagentsKey = () => serviceKey(self.settings.remote?.address ?? '');
  // The jobs the agent works with (helper-models.mjs): each with the service's entry for its
  // model, and the code search's embedder from the service when that job is on.
  const applyHelpers = (c = self.catalog) => {
    const conn = self.remoteRef.current.conn;
    if (!(self.model.remote?.ollama && conn?.info?.ollama && c?.models?.length)) { self.agent.helperJobs = null; self.agent.searchEmbedder = null; return; }
    const jobs = jobsOf(self.settings.helperModels?.[subagentsKey()] ?? {}, c.models, self.model.remote.model);
    self.agent.helperJobs = Object.fromEntries(jobs.map((j) => [j.id, { on: j.on, model: j.model, entry: c.models.find((m) => m.id === j.model) ?? null }]));
    // Profiles saved (/profiles): they decide the helpers and the code search's model (app-profiles.mjs).
    self.agent.router?.setCatalog(serverOf(self.settings.remote), c.models);
    if (self.agent.router?.active()) { self.applyProfiles(); return; }
    const search = self.agent.helperJobs.search;
    const want = search?.on && search.model && search.model !== MAIN ? `${conn.url}|${search.model}` : null;
    if (!want) self.agent.searchEmbedder = null;
    else if (self.agent.searchEmbedder?.key !== want) { self.agent.searchEmbedder = new RemoteEmbedder({ url: conn.url, model: search.model }); self.agent.searchEmbedder.key = want; }
  };
  // What the service's /model draws from: what was set as it opened, and what moves (the list, the chat).
  const serviceOf = (pk) => ({ ...pk.sv, catalog: self.catalog, version: self.catalog?.version ?? self.model.remote?.ollama ?? null, inUse: self.model.remote?.model ?? null, used: self.agent.ctxUsed ?? 0, tried: readTryouts(self.settings.remote?.address) });
  // The screen's part of it: the list.
  const serviceProps = (pk) => ({ service: serviceOf(pk) });
  // A model on this Mac picked while on a remote: back to this Mac with it (the remote stays saved, off).
  const pickHere = (picked) => {
    self.localModelRef.current = picked;
    self.settings.remote = saveSettings({ model: picked.id, remote: { ...(self.settings.remote ?? DEFAULT_REMOTE), use: false } }).remote;
    self.useLocal({ note: `Now on ${picked.name}, on this Mac. /remote turns the remote back on.` });
  };

  // ---- /web: what the model may do on the web (web-form.mjs, tools/web.mjs) ----
  const openWebPicker = () => self.setPicker(openWebForm(self.settings.web, { claude: self.model.remote?.kind === 'claude' }));
  const runWebTest = (pk) => {
    const id = (self.remoteRef.current.tests = (self.remoteRef.current.tests ?? 0) + 1);
    self.setPicker({ ...pk, test: { running: true, id }, error: null });
    testWebForm(pk).then((res) => self.setPicker((p) => (p?.kind !== 'web' || p.test?.id !== id ? p : { ...p, test: { ...res, id } })));
  };
  // Save: the search service's key to the Keychain (its own entry), the rest to settings.json.
  // The tools change with it, so the next reply reads the instructions again.
  const saveWeb = (pk) => {
    if (webWarning(pk)?.tone === 'error') { self.setPicker({ ...pk, error: 'Nothing was saved: fix the line above first.' }); return; }
    const v = pk.values;
    if (v.search !== 'off' && pk.key !== null) {
      try { if (pk.key) saveKey(pk.key, searchKeyId(v.search), 'Agentic Coder web search'); else removeKey(searchKeyId(v.search)); } catch (e) { self.setPicker({ ...pk, error: `Nothing was saved: the key could not be kept (${e.message}).` }); return; }
    }
    const w = toWebSettings(pk);
    self.setPicker(null);
    self.settings.web = saveSettings({ web: w }).web;
    self.agent.web = webSettings(self.settings.web);
    self.push({ type: 'note', text: `Web saved: ${w.search === 'off' ? 'no search' : `search with ${PROVIDER_NAMES[w.search]}${w.keys[w.search] ? '' : ' (no key yet)'}`} · ${w.fetch ? 'pages can be read, each site asked about first' : 'no pages read'}${self.model.remote?.kind === 'claude' ? ` · on the Claude API: ${w.claude ? 'Claude’s own web tools' : 'none'}` : ''}.`, tone: 'dim' });
  };
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

  // ---- pictures: the model's vision add-on, loaded when a picture is first attached ----
  // The other models on this Mac that can look at pictures (their file and their add-on here).
  const seeingModels = () => Object.values(MODELS).filter((m) => m.id !== self.model.id && m.vision && existsSync(modelPath(m)) && existsSync(visionPath(m)));
  // true: the message waits (vision turning on, or a question about downloading it);
  // false: it goes now (text only, with a note why).
  const needVision = (value, shown) => {
    // A Pictures helper on the service (/subagents) describes it; the message goes now.
    if (self.model.remote && self.agent.helperUse?.('pictures')) return false;
    if (self.model.remote) { self.push({ type: 'note', text: `The remote model (${remoteLabel(self.settings.remote)}) cannot look at pictures${self.model.remote.kind === 'llama' ? ': its coding serve has no vision add-on (coding setup there gets it)' : ''}. The message goes with a line saying so.`, tone: 'warn' }); return false; }
    if (self.opts.url) { self.push({ type: 'note', text: 'The model server given with --url is not looking at pictures (start it with its --mmproj file). The message goes with a line saying so.', tone: 'warn' }); return false; }
    if (!self.model.vision) {
      // Another model on this Mac can: you are asked whether it takes this message.
      if (seeingModels().length) { self.visionWaitRef.current = { value, shown }; self.openChoice('vision-switch'); return true; }
      self.push({ type: 'note', text: `${self.model.name} cannot look at pictures. The message goes with a line saying so.`, tone: 'warn' });
      return false;
    }
    self.visionWaitRef.current = { value, shown };
    if (!existsSync(visionPath(self.model))) { self.openChoice('vision-get'); return true; }
    turnVisionOn();
    return true;
  };
  const turnVisionOn = async () => {
    const wait = self.visionWaitRef.current;
    self.push({ type: 'note', text: `Turning on ${self.model.name}'s vision: a reload of about 20 s (the conversation stays). Your message goes as soon as it can see.`, tone: 'dim' });
    await self.switchModel(withVision(self.model), () => `${self.model.name} can look at pictures now: it stays on for this window.`);
    self.visionWaitRef.current = null;
    if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50);
  };
  // /settings: the commands kept out of the / menu, each row with what it
  // holds right now (none reads blank); enter runs the row's command.
  const openSettings = () => {
    const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const tokK = (t) => `${(t / 1024).toFixed(t < 10240 ? 1 : 0)}k`;
    const dirs = self.agent.memory ? memoryDirs(self.cwd) : null;
    const facts = (d) => (d ? readFacts(d).length : 0);
    let ins = null;
    try { ins = readInstructions(); } catch {}
    const steps = (t) => (String(t ?? '').match(/^\d+\./gm) ?? []).length;
    const docs = listDocs(findDocsDir());
    const runs = readRecord();
    const last = runs[0];
    const bc = battleCounts();
    const value = {
      meters: self.S.current.meters ? 'on' : 'off',
      mouse: self.S.current.mouse ? 'on' : 'off',
      autostart: self.settings.modelAtStart ? 'on · loads at once' : 'off · /start loads it',
      helpers: `${self.agent.helpers.size} of 4 on`,
      hooks: self.agent.way === 'app' ? 'all run: App decides' : `${self.agent.hooks.size} of ${HOOKS.length} on`,
      permissions: settingsValue(self.agent.cwd),
      web: (() => { const w = webSettings(self.settings.web); return `${w.search === 'off' ? 'no search' : PROVIDER_NAMES[w.search]} · pages ${w.fetch ? 'on' : 'off'}`; })(),
      rules: dirs ? n(rulesList(dirs).always.length, 'rule') : 'memory off here',
      instructions: ins ? `${steps(ins.sections.general)} general · ${steps(ins.sections.planning)} planning` : 'could not read',
      memory: dirs ? `${facts(dirs.you)} about you · ${facts(dirs.project)} here` : 'off here',
      weights: (() => { const here = Object.values(MODELS).filter((m) => m.format !== 'mlx' && existsSync(modelPath(m))); return here.length > 1 ? here.map((m) => m.name).join(' · ') : here.length ? `${here[0].name} · ${(statSync(modelPath(here[0])).size / 1e9).toFixed(2)} GB` : 'no model file here yet'; })(),
      docs: docs.missing ? 'DOCS folder not found' : n(docs.pages.length, 'page'),
      tests: last ? `${n(runs.length, 'run')} · last ${last.total != null ? `${last.passed}/${last.total}` : last.result}` : 'no runs yet',
      arena: battleHold() ? 'something is running there' : `${n(bc.tests, 'test')} · ${n(bc.battles, 'run')}`,
      stats: `${tokK(self.agent.ctxUsed ?? 0)} of ${tokK(self.agent.ctx)} context`,
      doctor: `${(availableBytes() / 1e9).toFixed(1)} GB free now`,
      init: existsSync(join(self.cwd, 'AGENTS.md')) ? 'AGENTS.md is here' : 'no AGENTS.md yet',
      update: self.update ? (self.update.kind === 'pull' ? 'new code on GitHub' : 'new code waiting') : `${VERSION} · nothing new`,
    };
    const groups = SETTINGS.map((g) => ({ group: g.group, rows: g.rows.map((r) => ({ ...r, value: value[r.name] })) }));
    self.setPicker({ kind: 'settings', groups, rows: groups.flatMap((g) => g.rows), index: 0 });
  };
  // /permissions alone: its five rows, each with what it holds now; enter opens
  // one (a list, or the start-up mode picker) by running its typed form.
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

  const openPermissions = () => {
    const at = self.agent.cwd;
    const v = permSummary(at, { session: self.agent.allowedPrefixes });
    const rows = [
      { name: 'permissions mode', label: 'Start-up mode', value: v.mode, note: 'what it starts in; /mode changes one conversation' },
      { name: 'permissions allow', label: 'Runs without asking', value: v.allow, note: 'on top of commands that only read' },
      { name: 'permissions never', label: 'Never runs', value: v.never, note: 'every mode; a commit always asks' },
      { name: 'permissions protect', label: 'Protected files', value: v.protect, note: 'always ask before a change, even in Accept edits and Auto' },
      { name: 'permissions folders', label: 'Trusted folders', value: v.folders, note: 'folders you said yes to in the safety check' },
      // The Screen tool (tools/screen.mjs): /screen, typed in full, is the same.
      { name: 'screen', label: 'Screen', value: process.platform !== 'darwin' ? 'Mac only' : `${screenAccess() ? 'allowed' : 'not allowed yet'} · ${self.agent.canSee || self.agent.mayLook?.() ? 'model sees' : 'model is blind'}`, note: 'the model may look at an app or the whole screen; each app asks once' },
    ];
    self.setPicker({ kind: 'settings', title: 'Permissions', blurb: `Saved for ${at.replace(homedir(), '~')}. Each row opens; /permissions test <command> tries one.`, groups: [{ group: 'What Agentic Coder may do here', rows }], rows, index: 0 });
  };
  // Memory for /effort's panel and for a restart, counted one way for both:
  // what is free now plus what the model server holds (a restart hands it
  // back first), and search(values): the search models those values turn on
  // that are not loaded yet.
  const memoryForRestart = () => {
    const cur = self.serverRef.current;
    const free = cur?.port ? freeWithHandBack(cur.model, cur.ctx ?? self.agent.ctx, { draft: Boolean(cur.draft) }) : availableBytes();
    const loaded = new Set(scanServers().map((e) => e.model));
    return { free, search: (values) => searchBytes(searchModels(self.agent, values), (m) => loaded.has(m.file)) };
  };
  // /effort, one panel: Effort on top, then every limit that can move, with
  // what each value costs; ←→ moves, enter saves all of it.
  const openEffortLimits = () => {
    const mem = memoryForRestart();
    const levels = self.model.thinkingLevels ?? [];
    const level = Math.max(0, levels.findIndex((l) => l.id === thinkingLevel(self.model, self.agent.thinking, self.agent.effort).id));
    // On an Ollama service the Context row is the model's own (serviceCtx), not this Mac's, and the
    // ranks page's values for it are suggested beside its rows (remote-suggested.mjs).
    const svc = self.onService();
    const values = svc ? { ...self.limitsRef.current, context: self.serviceCtx() } : { ...self.limitsRef.current };
    self.setPicker({ kind: 'limits', index: 0, level, savedLevel: level, values, saved: { ...values }, model: self.model, ...(svc ? { suggested: suggestedFor(self.model.remote.model, self.model) } : {}), env: { model: self.model, freeBytes: mem.free, searchBytes: mem.search, tps: self.stats.tps, pps: self.stats.pps, ctxNow: self.agent.ctx, lastRerank: self.agent.reranker?.last ?? null } });
  };
  // /model's menu for one model on the service (the user's pick, 2 Oct 2026): its own Effort and
  // rows, with the ranks page's values suggested beside them, before anything loads; enter switches
  // to it with them, esc goes back to the list (back). On the model in use it is saved at once.
  // A model not in use is read from the service's entry for it (what it can do, its longest context).
  const openOwnSettings = (entry, { back = null, profile = null } = {}) => {
    const inUse = entry.id === self.model.remote?.model;
    const m = inUse ? self.model : remoteModel(self.settings.remote, { model: entry.id, ollama: { version: self.catalog?.version ?? self.model.remote?.ollama ?? '?', ...entry }, ctx: entry.loadedCtx || entry.ctx || null });
    const levels = m.thinkingLevels ?? [];
    const own = ownOf(self.settings, entry.id);
    const lvNow = (levels.length > 1 && levels.find((l) => l.id === own?.level)) || (inUse ? thinkingLevel(m, self.agent.thinking, self.agent.effort) : thinkingLevel(m, m.thinkingDefault ?? true, m.thinkingEffort));
    const level = Math.max(0, levels.findIndex((l) => l.id === lvNow.id));
    const mine = readLimits({ ...loadSettings(self.opts.cwd), remote: self.settings.remote }, m);
    const values = { ...self.limitsRef.current, ...Object.fromEntries(OWN_ROWS.map((id) => [id, mine[id]])), context: self.serviceCtx(entry.id) };
    self.setPicker({ kind: 'limits', index: 0, level, savedLevel: level, values, saved: { ...values }, model: m, suggested: suggestedFor(entry.id, m),
      own: { id: entry.id, entry, inUse, back, profile },
      env: { model: m, switching: !inUse, freeBytes: null, searchBytes: null, tps: self.stats.tps, pps: self.stats.pps, ctxNow: inUse ? self.agent.ctx : entry.loadedCtx || null, lastRerank: null } });
  };
  // The menu's values with every suggested one filled in (s).
  const fillSuggested = (pk) => {
    const sg = pk.suggested;
    const li = sg?.level ? (pk.model.thinkingLevels ?? []).findIndex((l) => l.id === sg.level) : -1;
    return { ...pk, values: { ...pk.values, ...(sg?.limits ?? {}) }, ...(li >= 0 ? { level: li } : {}) };
  };
  // A model on the service back to the shared settings: its own rows as every model has them, its Context the service's own.
  const sharedValues = (pk) => {
    const shared = readLimits(loadSettings(self.opts.cwd), pk.model, { own: false });
    return { ...pk.values, ...Object.fromEntries(OWN_ROWS.map((id) => [id, shared[id]])), context: 0 };
  };
  // The menu saved: on the model in use, as /effort saves; on another, its own set (the rows you
  // moved, with the ones it had, and its Effort when it has more than one) and its Context are
  // kept for it, then the switch to it, which puts them in use (relimit). Reset: back to the shared ones.
  const saveOwnSettings = (pk, { reset = false } = {}) => {
    const { id, entry, inUse } = pk.own;
    const levels = pk.model.thinkingLevels ?? [];
    const lv = levels[pk.level] ?? null;
    if (inUse) { self.setPicker(null); saveEffortLimits(lv?.id ?? null, reset ? sharedValues(pk) : pk.values, { reset }); return; }
    if (self.busyNow()) { self.push({ type: 'note', text: `Agentic Coder is busy (a reply, or a model loading). Press enter again when it is done; nothing was saved and ${self.model.remote?.model ?? self.model.name} is still in use.`, tone: 'warn' }); return; }
    self.setPicker(null);
    keepOwnSettings(pk, { reset });
    // Its Effort goes in use once the switch has worked (relimit's ownLevel): one that fails leaves the model in use as it was.
    self.switchService(entry);
  };
  // A model's own settings kept for it (its moved rows, its Effort, its Context), with no switch: the
  // menu's save above, and /model's step 3 for a profile (app-profiles.mjs).
  const keepOwnSettings = (pk, { reset = false } = {}) => {
    const { id } = pk.own;
    const levels = pk.model.thinkingLevels ?? [];
    const lv = levels[pk.level] ?? null;
    const prev = ownOf(self.settings, id);
    const moved = OWN_ROWS.filter((r) => pk.values[r] !== pk.saved[r]);
    const limits = reset ? {} : { ...(prev?.limits ?? {}), ...Object.fromEntries(moved.map((r) => [r, pk.values[r]])) };
    const level = reset ? null : levels.length > 1 && lv && pk.level !== pk.savedLevel ? lv.id : prev?.level ?? null;
    const own = { ...(level ? { level } : {}), ...(Object.keys(limits).length ? { limits } : {}) };
    if (Object.keys(own).length || prev) self.setOwn(id, Object.keys(own).length ? own : null);
    const ctx = reset ? 0 : pk.values.context ?? 0;
    if (ctx !== self.serviceCtx(id)) self.setServiceCtx(id, ctx);
  };
  const applyChoice = (id, value) => {
    if (id === 'memory-save') { const p = self.pendingSaveRef.current; self.pendingSaveRef.current = null; p?.resolve(value === 'save'); return; }
    if (id === 'vision-get') {
      const wait = self.visionWaitRef.current;
      if (value === 'skip') { self.visionWaitRef.current = null; if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); return; }
      self.push({ type: 'note', text: `Downloading ${self.model.name}'s vision add-on…`, tone: 'dim' });
      getVision(self.model, (t) => self.flash(String(t).trim(), 4000))
        .then(() => turnVisionOn())
        .catch((e) => { self.visionWaitRef.current = null; self.push({ type: 'note', text: `The vision add-on did not download: ${e.message}. The message goes without the picture.`, tone: 'error' }); if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); });
      return;
    }
    if (id === 'vision-switch') {
      const wait = self.visionWaitRef.current;
      self.visionWaitRef.current = null;
      const go = () => { if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50); };
      const seer = String(value).startsWith('use:') ? MODELS[String(value).slice(4)] : null;
      if (!seer) { go(); return; }
      const back = self.model;
      (async () => {
        await self.switchModel(withVision(seer), () => `${seer.name} looks at the picture; ${back.name} comes back after its reply.`);
        self.switchBackRef.current = back;
        // It did not load (or loaded without its add-on): the message goes to the model you had.
        if (!self.agentRef.current?.canSee) { self.push({ type: 'note', text: `${seer.name} could not take the picture; back to ${back.name}, and the message goes without it.`, tone: 'warn' }); await self.remoteFnRef.current.switchBack(); }
        go();
      })();
      return;
    }
    if (id === 'service-chat-only') {
      const pick = self.chatOnlyRef.current;
      self.chatOnlyRef.current = null;
      if (value !== 'switch' || !pick) return;
      openOwnSettings(pick.m, { back: pick.back });
      return;
    }
    if (id === 'same-folder') {
      if (value !== 'copy') { self.push({ type: 'note', text: 'Sharing this folder with the other window: both can change the same files.', tone: 'dim' }); return; }
      if (self.agent.busy) { self.push({ type: 'note', text: 'Wait for the reply to finish, then type /copy to work in your own copy.', tone: 'warn' }); return; }
      self.startCopy();
      return;
    }
    if (id === 'copy-back') {
      if (value === 'show') {
        let diff = '';
        try { diff = copyDiff(self.copyRef.current); } catch (e) { diff = `Could not show them: ${e.message}`; }
        self.push({ type: 'note', text: diff || 'Nothing changed in the copy.', tone: 'dim' });
        setTimeout(() => self.openChoice('copy-back'), 60);
      } else if (value === 'back') self.doPutBack();
      else self.push({ type: 'note', text: 'Your changes stay in the copy for now. /copy brings the question back.', tone: 'dim' });
      return;
    }
    if (id === 'copy-conflict') {
      if (value === 'mine') self.doPutBack({ only: self.copyAsk.current.conflicts, force: true });
      else self.push({ type: 'note', text: `Left ${self.copyAsk.current.conflicts.join(', ')} as they are in the real folder; /copy asks again later.`, tone: 'dim' });
      return;
    }
    if (id === 'remote-saved') {
      const a = self.savedAskRef.current;
      self.savedAskRef.current = null;
      if (!a) return;
      if (value !== 'connect') { self.push({ type: 'note', text: `Left saved, not connected. /remote ${self.remoteWord(a.source)} connects it any time.`, tone: 'dim' }); return; }
      // The one in use with new settings connects again; any other is switched to as /remote service would.
      if (a.again) self.useRemote(self.settings.remote);
      else self.remoteTo(a.source);
      return;
    }
    if (id === 'remote-down') {
      if (value === 'retry') self.useRemote(self.settings.remote);
      else if (value === 'local') self.useLocal({ note: 'This window uses the model on this Mac for now; /remote is still on for the next start.', load: true });
      else self.openRemoteForm();
      return;
    }
    if (id === 'mode') {
      const o = MODE_OPTIONS.find((x) => x.id === value); if (!o) return;
      self.setMode(o.id);
      const MODE_SAYS = {
        auto: 'Mode is auto: reading, searching and edits inside the project go through; a command or web page no rule covers is checked by the model against your request first, and runs only when it fits and can be undone. Commits and protected files still ask.',
        ask: 'Mode is manual: Agentic Coder asks before every change and every command that can change things.',
        edits: 'Mode is accept edits: file edits go through without asking; commands still ask.',
        plan: 'Mode is plan: it only reads and searches, then replies with a plan.',
        bypass: 'Bypass permissions is on: nothing asks. Still never: rm -rf, sudo, git push, stopping processes, a change to Agentic Coder’s own settings, your never-list, secrets outside the project (keys, .ssh, .env), or reaching what already runs on this Mac. Files and commands may use any folder, and commands the internet. shift+tab goes back to manual.',
      };
      self.push({ type: 'note', text: MODE_SAYS[o.id], tone: o.id === 'bypass' ? 'warn' : 'dim' });
    } else if (id === 'meters') {
      const on = value === 'on';
      self.setMeters(on);
      saveSettings({ meters: on });
      self.push({ type: 'note', text: on ? 'Status bar on: model, speed, memory and effort under the prompt.' : 'Status bar off. /stats has the numbers; a memory note appears only when it runs low.', tone: 'dim' });
    } else if (id === 'mouse') {
      const on = value === 'on';
      self.setMouse(on);
      saveSettings({ mouse: on });
      self.push({ type: 'note', text: on ? 'Mouse on: a click in the prompt box puts the cursor there and a drag highlights (copied at once; delete removes it); a click on the model’s label in the footer starts or stops it. Hold fn to highlight the way Terminal does.' : 'Mouse off: the mouse is Terminal’s again. option+click, shift+arrows and ctrl+t still work.', tone: 'dim' });
    } else if (id === 'autostart') {
      const on = value === 'on';
      self.settings.modelAtStart = on;
      saveSettings({ modelAtStart: on });
      self.push({ type: 'note', text: on ? `Model at start on: ${self.model.name} loads as soon as a window opens. /stop still unloads it.` : 'Model at start off: a window opens with the model off, and /start loads it.', tone: 'dim' });
    } else if (id === 'startmode') {
      const r = changePermissions(self.agent.cwd, `mode ${value}`, { mode: self.agent.mode, session: self.agent.allowedPrefixes });
      if (r.mode) self.setMode(r.mode);
      self.push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
    }
  };
  // What the note after an effort change says; a level's note can name the
  // thinking cap, so it is given the cap in use.
  const sayEffort = (lv, cap) => self.push({ type: 'note', text: `Effort is ${lv.label.toLowerCase()}: it ${effortNote(lv, cap) || 'thinks before each step'}.`, tone: 'dim' });
  // The Effort and limits panel saved (`levelId` is null when the model has no
  // levels): the effort and the agent's limits change at once; a new context or
  // thinking cap restarts the model server (the window and conversation stay).
  // All of it or none: a restart is refused in the middle of a reply and while the model is still starting.
  // On an Ollama service the model's own rows and Effort are kept for it alone (/model's menu, 2 Oct
  // 2026); reset: it goes back to the shared ones (its own set and its Context dropped).
  const saveEffortLimits = (levelId, next, { reset = false } = {}) => {
    const lv = levelId ? (self.model.thinkingLevels ?? []).find((l) => l.id === levelId) : null;
    const effortChanged = !!lv && lv.id !== thinkingLevel(self.model, self.agent.thinking, self.agent.effort).id;
    // On an Ollama service the Context row is the model's own: kept by model, and the model loads
    // again on the service at that size (the conversation stays); this Mac's Context is left as it was.
    const svc = self.onService();
    const svcCtx = svc ? next.context ?? 0 : 0;
    const ctxChanged = svc && svcCtx !== self.serviceCtx();
    if (svc) next = { ...next, context: self.limitsRef.current.context };
    const changes = limitChanges(self.limitsRef.current, next);
    const prevOwn = svc ? ownOf(self.settings, self.model.remote.model) : null;
    if (!effortChanged && !changes.length && !ctxChanged && !(reset && prevOwn)) { self.push({ type: 'note', text: 'Effort and limits unchanged.', tone: 'dim' }); return; }
    if (ctxChanged && self.busyNow()) { self.push({ type: 'note', text: 'Agentic Coder is busy (a reply, or a model loading). Save the Context again in /effort when it is done. Nothing was changed.', tone: 'warn' }); return; }
    const restart = changes.some((c) => c.restart);
    if (restart && !self.opts.url && !self.model.remote) {
      // A restart needs a quiet model: no reply running, and no start still going
      // (a prompt queued meanwhile would be sent to the server just stopped).
      const why = self.S.current.starting ? 'still starting. Wait until it is ready' : self.S.current.live !== IDLE || self.agent.busy ? 'in the middle of a reply. Let it finish (or press esc)' : null;
      if (why) { self.push({ type: 'note', text: `Agentic Coder is ${why}, then save again in /effort. Nothing was changed.`, tone: 'warn' }); return; }
    }
    if (effortChanged) { self.setThinking(!!lv.effort, lv.effort ? lv.id : undefined); sayEffort(lv, next.thinking); }
    // The model's own set on the service: the rows moved here (with the ones it had), and its
    // Effort when it has more than one; the shared rows are saved below as before.
    const ownMoved = svc ? changes.filter((c) => OWN_ROWS.includes(c.id)).map((c) => c.id) : [];
    if (svc && (ownMoved.length || effortChanged || reset)) {
      const limits = reset ? {} : { ...(prevOwn?.limits ?? {}), ...Object.fromEntries(ownMoved.map((id) => [id, next[id]])) };
      const level = reset ? null : effortChanged && self.model.thinkingLevels.length > 1 ? lv.id : prevOwn?.level ?? null;
      const own = { ...(level ? { level } : {}), ...(Object.keys(limits).length ? { limits } : {}) };
      if (Object.keys(own).length || prevOwn) self.setOwn(self.model.remote.model, Object.keys(own).length ? own : null);
      if (reset && prevOwn && !changes.length) self.push({ type: 'note', text: `${self.model.remote.model} follows the shared settings again.`, tone: 'dim' });
    }
    if (ctxChanged) {
      const conn = self.remoteRef.current.conn;
      const name = self.model.remote.model;
      const from = self.serviceCtx();
      self.setServiceCtx(name, svcCtx);
      conn.numCtx = svcCtx || null;
      setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx: conn.numCtx });
      if (svcCtx) { conn.ctx = svcCtx; self.agent.ctx = svcCtx; self.setCtx(svcCtx); self.agent.syncRules(); }
      self.push({ type: 'note', text: `Context ${from ? ctxWord(from) : 'auto'} → ${svcCtx ? ctxWord(svcCtx) : 'auto (the service’s own)'} for ${name}, kept for it: it loads again on the service at that size; the chat stays.`, tone: 'dim' });
      // Loaded again even when it is loaded: at the new size (or the service's own).
      conn.info.ollama = { ...conn.info.ollama, loaded: false };
      self.preloadRemote(conn);
    }
    if (!changes.length) return;
    self.limitsRef.current = next;
    applyLimits(self.agent, next);
    // A model on a service: its Reply length and sampling from the next step, Keep loaded from the next request.
    if (svc) { self.agent.model = modelWithLimits(self.model, next); self.applyKeep(next); }
    const searchNote = applySearch(self.agent, next);
    if (searchNote) self.push({ type: 'note', text: searchNote, tone: 'warn' });
    // A row this save left alone stays saved as it was (limitsToSave's keep). On a service only the
    // shared rows go there, laid over what every model shares (its own rows are kept above).
    const touched = new Set(changes.map((c) => c.id).filter((id) => !ownMoved.includes(id)));
    const kept = Object.fromEntries(Object.entries(loadSettings(self.opts.cwd).limits ?? {}).filter(([id]) => !touched.has(id)));
    if (touched.size) saveSettings({ limits: limitsToSave(svc ? { ...readLimits(loadSettings(self.opts.cwd), self.model, { own: false }), ...Object.fromEntries([...touched].map((id) => [id, next[id]])) } : next, self.model, kept) });
    const list = changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ');
    // Who decides changes the prompt and the tools: the next reply reads the instructions again, once.
    const way = changes.some((c) => c.id === 'way') ? ` ${next.way === 'model' ? 'The model decides from the next message: no sorting, no reading ahead, the checks only as /hooks switches them' : 'The app decides again from the next message'}; that reply reads the instructions again, once.` : '';
    const forIt = svc && ownMoved.length ? (reset ? ` ${self.model.remote.model} follows the shared settings again.` : ` Kept for ${self.model.remote.model} alone${touched.size ? ' (Who decides and the search for every model)' : ''}.`) : '';
    if (!restart) { self.push({ type: 'note', text: `Saved: ${list}. In use from the next step; kept for next time.${forIt}${way}`, tone: 'dim' }); return; }
    if (self.opts.url) { self.agent.model = modelWithLimits(self.model, next); self.push({ type: 'note', text: `Saved: ${list}. The model server was given with --url, so restart it yourself for the context or thinking cap to take effect.`, tone: 'warn' }); return; }
    if (self.model.remote) { self.agent.model = modelWithLimits(self.model, next); self.push({ type: 'note', text: `Saved: ${list}. The model runs on the remote: its context is set there (coding serve --ctx, or /remote's Context row), and the new cap is asked for with each reply.`, tone: 'dim' }); return; }
    if (self.modelOffNow()) { self.agent.model = modelWithLimits(self.model, next); self.push({ type: 'note', text: `Saved: ${list}. The model is off, so it applies when you type /start; kept for next time.${way}`, tone: 'dim' }); return; }
    self.push({ type: 'note', text: `Saved: ${list}. Restarting ${self.model.name} for it (about a minute); the conversation stays.`, tone: 'dim' });
    self.switchModel(self.model, (ctx) => `${self.model.name} restarted: context ${Math.round(ctx / 1024)}k · thinking cap ${showLimit('thinking', next.thinking)}.`);
  };
  // target: the model the pick is for (the one in use unless said). A model on /remote keeps it as its
  // own; this Mac's models share one; null: only for now (a default, or one coming back).
  const setThinkingFn = (on, eff, { target = self.agent.model } = {}) => {
    self.agent.thinking = on;
    self.setThinkingState(on);
    if (eff) { self.agent.effort = eff; self.setEffortState(eff); }
    if (target === null) return;
    if (target?.remote) { self.saveOwnLevel(target, thinkingLevel(target, on, eff ?? self.agent.effort)); return; }
    saveSettings(eff ? { thinking: on, effort: eff } : { thinking: on });
  };
  const readMacMemory = () => {
    if (!self.opts.macMem) return;
    const id = setInterval(() => {
      // On a remote the footer shows the service instead (remote-footer.mjs): nothing to read here.
      if (self.remoteRef.current.on) return;
      const m = macMemory();
      if (!m) return;
      const prev = self.macRef.current;
      self.macRef.current = m;
      if (!prev || prev.level !== m.level) self.redrawMac((n) => n + 1);
    }, Number(process.env.AGENTIC_MAC_EVERY) || 5000); // ms; the tests read it faster
    return () => clearInterval(id);
  };
  const readServicePs = () => {
    self.psRef.current = null;
    if (!self.psConn) return;
    const name = self.model.remote.model;
    let on = true;
    const read = async () => {
      const p = await ollamaPs({ url: self.psConn.url, model: name }).catch(() => null);
      if (!on) return;
      const prev = self.psRef.current;
      self.psRef.current = p;
      const spill = (x) => (x?.loaded ? (x.gpuPct ?? 100) < 100 : null);
      if (!prev || spill(prev) !== spill(p) || Boolean(prev.loaded) !== Boolean(p?.loaded)) self.redrawPs((n) => n + 1);
      // Keep loaded "while open": with less than two thirds of OPEN_KEEP left, the model is kept
      // another OPEN_KEEP (an empty request at the context the replies use, so nothing loads again),
      // and so is one kept for ever (keep_alive -1, an older version's). One the service already let
      // go of is not loaded back from here: the next reply does that.
      // Only while the window is still on this service: a look already under way as it went back to
      // this Mac (leaveService) would load the model it has just let go.
      const ep = endpointOf(self.psConn.url);
      const left = p?.loaded && p.until ? Date.parse(p.until) - Date.now() : NaN;
      if (self.remoteRef.current.conn === self.psConn && ep?.keepAlive === OPEN_KEEP && (left < OPEN_KEEP_MS * 2 / 3 || left > 24 * 3600_000)) {
        self.renewRef.current = preloadOllama({ url: self.psConn.url, model: name, numCtx: ep.numCtx ?? null, keepAlive: OPEN_KEEP, timeoutMs: 10_000 }).catch(() => {}).finally(() => { self.renewRef.current = null; });
      }
    };
    read();
    const id = setInterval(read, Number(process.env.AGENTIC_PS_EVERY) || 30_000); // ms; the tests read it faster
    return () => { on = false; clearInterval(id); };
  };

  const saveNowFn = () => {
    const s = self.sessionRef.current;
    if (!s.title) return;
    // lessons: what happened in each turn, for the memory's review at night.
    const slimImages = (m) => (m.images ? { ...m, images: m.images.map(({ data, ...rest }) => rest) } : m);
    try { saveSession(self.cwd, s.id, { title: s.title, messages: self.agent.messages.map(slimImages), items: s.items.slice(-300), mode: self.agent.mode, lessons: self.agent.lessons }); } catch {}
  };
  return { applyHelpers, serviceOf, serviceProps, pickHere, openWebPicker, runWebTest, saveWeb, offerList, openMcpPicker, mcpKeys, hooksList, hooksKeys, mcpNews, seeingModels, needVision, openSettings, openRewind, chooseRewind, applyRewind, openPermissions, memoryForRestart, openEffortLimits, openOwnSettings, fillSuggested, sharedValues, saveOwnSettings, keepOwnSettings, applyChoice, sayEffort, saveEffortLimits, setThinkingFn, readMacMemory, readServicePs, saveNowFn };
}
