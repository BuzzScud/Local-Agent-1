// Where the window's model runs (App.jsx): /remote, a model on another machine, a service's models and
// their settings, the loops' badge, the jump box.
// The functions are the App's own, moved here word for word: the App's names (and App.jsx's) are read through
// self, which App makes at each render, so a function sees the values of the render that made it.
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { SESSION_MARK } from '../agent/prompt.mjs';
import { remoteModel, remoteRisk, connectRemote, remoteLabel, warmUp, modelById, MODELS, DEFAULT_MODEL, DEFAULT_REMOTE, saveKey, removeKey, sourceOf, ollamaCatalog, unloadOllama, authHeaders, OPEN_KEEP, isOutOfMemory, setEndpoint, endpointOf, preloadOllama, ollamaModel, floorCtx, modelPath, thinkingLevel, editedModels } from '../../../models/index.mjs';
import { windowSpend } from '../agent/spend.mjs';
import { modelsInUseOn, updateWindow } from './copies.mjs';
import { kindWord, openForm, startEdit, rowsOf as remoteRows, savePlan, formWarning, sourceWord, testForm, withTest, connectionChanged, openModelPick, readyRemote, remotesOf, remoteChoices } from './remote-form.mjs';
import { ctxWord, suggestModel, openService } from './remote-models.mjs';
import { MAIN } from './subagents.mjs';
import { tryOut } from '../agent/tryout.mjs';
import { readTryouts, saveTryout } from './tryouts.mjs';
import { saveSettings, loadSettings } from './store.mjs';
import { askJump, DETACH_LABEL } from './sessions.mjs';
import { openJumpBox as jumpBox, jumpKey } from './jump-box.mjs';
import { Loops } from './loops.mjs';
import { loopsLine } from './loops-draw.mjs';
import { modelWithLimits } from './limits.mjs';
import { IDLE, remoteConfOf } from './app-common.mjs';

export function remotePart(self) {
  const useRemote = async (r, { atStart = false } = {}) => {
    if (!atStart && (self.S.current.live !== IDLE || self.agent.busy)) { self.push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return false; }
    const before = { model: self.model, server: self.serverRef.current };
    if (!self.model.remote) self.localModelRef.current = self.model;
    const was = self.remoteRef.current.conn;
    const wasConf = self.agent.remoteConf;
    self.remoteRef.current.conn = null;
    self.remoteRef.current.on = true;
    self.setModel(remoteModel(r));
    self.setStarting(true); self.setStartPhase('connecting');
    self.setRemoteState('connecting'); self.setCatalog(null);
    // Another service: what this window had there is let go. The same one: only a main model it moves off.
    const same = wasConf && wasConf.kind === r.kind && wasConf.address === r.address && (wasConf.port ?? null) === (r.port ?? null);
    const old = was?.info?.model;
    await leaveService(was, same ? { only: r.model && old && r.model !== old ? [old] : [] } : {});
    let conn;
    try { conn = await connectRemote(r, { serviceSize: true }); } catch (e) {
      self.remoteRef.current.why = e.message;
      self.setStarting(false);
      if (before.server && !before.model.remote) {
        self.remoteRef.current.on = false;
        self.setModel(before.model);
        self.setRemoteState(null);
        // Kept, but off: the next start does not try a remote that just failed.
        if (self.settings.remote?.use) self.settings.remote = saveSettings({ remote: { ...self.settings.remote, use: false } }).remote;
        self.push({ type: 'note', text: `The remote at ${remoteLabel(r)} did not answer, so nothing changed: ${e.message}. Still on ${before.model.name}, on this Mac; the remote is saved but off (/remote to fix it and try again).`, tone: 'error' });
        return false;
      }
      self.setRemoteState('down');
      self.push({ type: 'note', text: `The remote model at ${remoteLabel(r)} did not answer: ${e.message}.`, tone: 'error' });
      self.openChoice('remote-down');
      return false;
    }
    self.remoteRef.current.conn = conn;
    self.remoteRef.current.why = null;
    self.lendConn(r, conn);
    // The service this window connected with (never its key): its memory save after you close it goes
    // there too, not to whichever service another window saved since (autosave.mjs).
    self.agent.remoteConf = remoteConfOf(r);
    self.serverRef.current = null;
    // The Mac's own model is let go: back on this Mac, it is off until /start.
    self.wantRef.current = false;
    self.setModelOff(false);
    await before.server?.stop().catch(() => {});
    self.setRamGb(null);
    self.memoryNote.current = null;
    const m = conn.model;
    self.setModel(m);
    self.agent.url = conn.url;
    self.agent.canSee = Boolean(conn.vision);
    self.relimit(m);
    self.agent.model = modelWithLimits(m, self.limitsRef.current);
    self.applyKeep();
    self.agent.ctx = conn.ctx; self.setCtx(conn.ctx);
    self.agent.slots = conn.slots > 1 ? { main: 0, side: 1 } : null;
    self.setStartPhase('reading');
    // The MCP tools go into what the model reads ahead, when every server has settled (agent.mjs mcpTake).
    await self.agent.mcpTake({ settled: true }).catch(() => {});
    try { await warmUp({ sessionMark: SESSION_MARK, url: conn.url, model: m, system: self.agent.messages[0].content, tools: self.agent.tools(), thinking: self.agent.thinking, effort: self.agent.effort, slot: self.agent.slots?.main, onPhase: self.setStartPhase }); } catch {}
    self.setStarting(false);
    self.push({ type: 'note', text: `On the remote: ${m.name} · ${kindWord(r.kind)} · answered in ${conn.info.ms ?? '?'} ms · your prompts and files go there; /remote switches back`, tone: 'dim' });
    self.setRemoteState('on');
    // A model still loading on the service: a waiting message goes once it has (preloadRemote).
    const loading = preloadRemote(conn);
    refreshCatalog(conn);
    const risk = remoteRisk(r);
    if (risk) self.push({ type: 'note', text: `⚠ ${risk}.`, tone: 'warn' });
    const q = self.queuedRef.current;
    if (q && loading) { /* sent by preloadRemote */ }
    else if (q) { self.queuedRef.current = null; self.setQueued(null); setTimeout(() => self.remoteFnRef.current.send?.(q), 50); }
    // At the start, as after a start here: the last window's second look is asked about, then (first use here) what is written is read.
    else if (atStart) setTimeout(() => { self.autoRef.current.atStart(); }, 3000).unref?.();
    return true;
  };
  // Back to the model on this Mac: the tunnel closes. The model loads here only when you ask for
  // it (load: "Use … on this Mac for now", or /autostart on); otherwise it is off until /start.
  const useLocal = async ({ note, load = false } = {}) => {
    if (self.S.current.live !== IDLE || self.agent.busy) { self.push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return; }
    self.remoteRef.current.on = false;
    const was = self.remoteRef.current.conn;
    self.remoteRef.current.conn = null;
    self.setRemoteState(null); self.setCatalog(null);
    await leaveService(was);
    const back = self.localModelRef.current ?? modelById(self.settings.model) ?? MODELS[DEFAULT_MODEL];
    self.localModelRef.current = null;
    self.agent.slots = null;
    self.agent.remoteConf = null;
    if (!load && !self.wantRef.current && !self.loadsAtOpen()) {
      self.agent.url = 'http://127.0.0.1:0';
      self.setModel(back);
      self.relimit(back);
      self.agent.model = modelWithLimits(back, self.limitsRef.current);
      self.setModelOff(true);
      self.push({ type: 'note', text: `${note ?? `Back on ${back.name}, on this Mac.`} The model is off: /start loads it.`, tone: 'dim' });
      return;
    }
    self.wantRef.current = true;
    self.setModelOff(false);
    await self.switchModel(back, () => note ?? `Back on ${back.name}, on this Mac.`);
  };
  // The remote stopped answering in the middle of a reply: connect again once
  // (a new tunnel, say). If it cannot be reached, the reply stops and you are asked.
  const reconnect = async () => {
    self.remoteRef.current.conn?.stop();
    self.remoteRef.current.conn = null;
    self.setRemoteState('reconnecting');
    try {
      const conn = await connectRemote(self.settings.remote ?? DEFAULT_REMOTE);
      self.remoteRef.current.conn = conn;
      self.agent.url = conn.url;
      self.setRemoteState('on');
      self.push({ type: 'note', text: `Connected to the remote again (${remoteLabel(self.settings.remote)}).`, tone: 'dim' });
    } catch (e) {
      self.setRemoteState('down');
      self.remoteRef.current.why = e.message;
      setTimeout(() => self.openChoice('remote-down'), 0);
      throw new Error(`the remote model at ${remoteLabel(self.settings.remote)} stopped answering: ${e.message}`);
    }
  };
  // The form opens on the service in use in this window (This Mac when none is),
  // or on `source`; ask: a row to start typing in (/remote claude with no key yet).
  const openRemoteForm = ({ source = null, ask = null } = {}) => {
    const f = openForm(self.settings, { on: Boolean(self.remoteRef.current.on), source, mac: self.sharedRef.current });
    if (!ask) { self.setPicker(f); return; }
    self.setPicker({ ...startEdit({ ...f, index: remoteRows(f).findIndex((r) => r.id === ask) }, ask), ask });
  };
  const busyNow = () => self.S.current.live !== IDLE || self.agent.busy || self.S.current.starting;
  // The footer's count: the loops still open, and whether one waits for you.
  const loopsBadgeOf = (m) => { const open = m.open.length, need = m.needsYou.length + m.stuck.length + m.ready.length; return open ? `↻ ${open} loop${open === 1 ? '' : 's'}${need ? ` · ${need} needs you` : ''}` : null; };
  const loopsOf = () => {
    if (self.loopsRef.current) return self.loopsRef.current;
    self.loopsRef.current = new Loops({
      folder: self.agent.cwd, name: process.env.AGENTIC_IN_HOST || self.agent.cwd.split('/').filter(Boolean).pop() || 'this window',
      // Whether a run can start now, and how it reaches the model this window uses: the service /remote is
      // on, the server given with --url, or the copy loaded on this Mac (then one run at a time, and none
      // while this window itself is answering). Nothing loads for a loop: with the model off, they wait.
      status: () => {
        const a = self.agentRef.current;
        const name = a?.model?.name ?? 'the model';
        const mode = a?.mode ?? 'ask';
        if (self.remoteRef.current?.on) return { on: true, name, where: 'its service', limit: 3, mode, flows: self.opts.flows };
        const url = self.opts.url ?? null;
        if (!url && !self.serverRef.current?.port) return { on: false, why: self.S.current.starting ? 'the model is loading' : 'the model is off', name, where: 'this Mac', limit: 1, mode };
        if (self.S.current.live !== IDLE || a?.busy) return { on: false, why: 'this window is answering', name, where: 'this Mac', limit: 1, mode };
        return { on: true, name, where: 'this Mac', limit: 1, mode, url, slots: self.opts.slots, local: !url, flows: self.opts.flows };
      },
      spend: () => windowSpend().usd,
    });
    return self.loopsRef.current;
  };
  const tickLoops = () => {
    const t = setInterval(() => {
      const m = self.loopsRef.current;
      if (!m) return;
      m.tick();
      self.setLoopsBadge(loopsBadgeOf(m));
      // The line above the prompt, drawn again only when it changed.
      const segs = loopsLine({ loops: m.loops }, Date.now());
      const key = JSON.stringify(segs);
      if (key !== self.loopsSegsKey.current) { self.loopsSegsKey.current = key; self.setLoopsSegs(segs); }
      // A loop that needs you, and one that ended by itself, each say so here once.
      const seen = self.loopsSeen.current;
      for (const l of m.needsYou) {
        const key = `${l.id}-${l.current.n}-${l.current.needs.id}`;
        if (seen.asked.has(key)) continue;
        seen.asked.add(key);
        self.push({ type: 'note', text: `↻ Loop ${l.id} (${l.name}) needs you: ${l.current.needs.text} /loops to answer it.`, tone: 'warn' });
      }
      // A debugging loop that stopped getting closer waits for a hint (loops.mjs stuckWhy).
      for (const l of m.stuck) {
        const key = `${l.id}-${l.runs.at(-1)?.n}-stuck`;
        if (seen.asked.has(key)) continue;
        seen.asked.add(key);
        self.push({ type: 'note', text: `↻ Loop ${l.id} (${l.name}) needs you: ${l.stuck}. In /loops, type a hint to send it on with; ^R tries again as it is, ^S stops it.`, tone: 'warn' });
      }
      // Ask first: a run that waits for your go says so once.
      for (const l of m.ready) {
        const key = `${l.id}-${l.ready.n}-ready`;
        if (seen.asked.has(key)) continue;
        seen.asked.add(key);
        self.push({ type: 'note', text: `↻ Loop ${l.id} (${l.name}): run ${l.ready.n} is ready and waits for your go. In /loops, type y; or /loop ${l.id} go · /loop ${l.id} skip.`, tone: 'warn' });
      }
      for (const l of m.loops) {
        if (l.state !== 'done' || seen.ended.has(l.id)) continue;
        seen.ended.add(l.id);
        self.push({ type: 'note', text: `↻ Loop ${l.id} (${l.name}) ended: ${l.doneWhy}.`, tone: 'dim' });
      }
    }, 500);
    // The window closes: its loops end with it, and a run under way is stopped.
    const end = () => self.loopsRef.current?.close();
    process.once('exit', end);
    return () => { clearInterval(t); process.off('exit', end); end(); };
  };
  // Saves what the form changed: the keys first (nothing is written when one
  // cannot be kept), then settings.json. Answers the plan, or null.
  const keepForm = (pk, { connect }) => {
    const plan = savePlan(pk, self.settings, { connect });
    if (formWarning(pk)?.tone === 'error' && pk.source !== 'here') { self.setPicker({ ...pk, tried: true, error: 'Nothing was saved: fix the line above first.' }); return null; }
    try {
      for (const k of plan.keys) { if (k.op === 'save') saveKey(k.key, k.id, `Agentic Coder · ${sourceWord(k.source)}`); else removeKey(k.id); }
    } catch (e) { self.setPicker({ ...pk, error: `Nothing was saved: the key could not be kept (${e.message}).` }); return null; }
    const next = saveSettings({ remotes: plan.remotes, ...(plan.remote ? { remote: plan.remote } : {}), ...(plan.memoryToRemote ? { memoryToRemote: plan.memoryToRemote } : {}), ...('remoteCleanAt' in plan ? { remoteCleanAt: plan.remoteCleanAt } : {}) });
    self.settings.remotes = next.remotes;
    if (plan.remote) self.settings.remote = next.remote;
    if (plan.memoryToRemote) self.settings.memoryToRemote = next.memoryToRemote;
    if ('remoteCleanAt' in plan) { self.settings.remoteCleanAt = next.remoteCleanAt; self.agent.workRoom = Number(next.remoteCleanAt) || 0; }
    return plan;
  };
  // Connect: the shown service's rows are checked as they are (the tunnel opened
  // and closed for it); only when that works are they saved and the window
  // switched. One that does not work leaves the form open with what it found.
  // Several models and none named: the list opens (a coder highlighted); enter
  // picks one and the check runs again. This Mac: back to the model here.
  const connectForm = (pk) => {
    if (pk.source === 'here') {
      if (self.remoteRef.current.on && busyNow()) { self.setPicker({ ...pk, error: 'Agentic Coder is busy (a reply, or a model starting): switch when it is done.' }); return; }
      if (!keepForm(pk, { connect: true })) return;
      self.setPicker(null);
      if (self.remoteRef.current.on) useLocal();
      else self.push({ type: 'note', text: 'Already on this Mac. The remotes stay saved: Run on (or /remote claude) switches.', tone: 'dim' });
      return;
    }
    if (formWarning({ ...pk, tried: true })?.tone === 'error') { self.setPicker({ ...pk, tried: true, error: null }); return; }
    if (busyNow()) { self.setPicker({ ...pk, error: 'Agentic Coder is busy (a reply, or a model starting). Nothing was saved: connect again when it is done.' }); return; }
    const id = (self.remoteRef.current.tests = (self.remoteRef.current.tests ?? 0) + 1);
    self.setPicker({ ...pk, tried: true, test: { running: true, id }, error: null, pick: null });
    // The check's line says what it waits for and counts the seconds; closing the form (or a
    // new check) stops the request, so a model is not left loading on the service for nothing.
    const stop = new AbortController();
    const t0 = Date.now();
    let found = null;
    const mine = () => { const p = self.S.current.picker; return p?.kind === 'remote' && p.test?.id === id ? p : null; };
    const tick = setInterval(() => {
      const p = mine();
      if (!p) { stop.abort(); clearInterval(tick); return; }
      if (p.test.running && found) self.setPicker({ ...p, test: { ...p.test, ...found, secs: Math.round((Date.now() - t0) / 1000) } });
    }, 1000);
    testForm(pk, { autoPick: false, signal: stop.signal, onStep: (f) => { found = f; } }).finally(() => clearInterval(tick)).then((res) => {
      const p = self.S.current.picker;
      if (p?.kind !== 'remote' || p.test?.id !== id) return;
      const done = withTest(p, res, id);
      if (res.needModel && res.models?.length > 1) { self.setPicker(openModelPick(done, res.models)); return; }
      if (!res.ok) { self.setPicker(done); return; }
      if (busyNow()) { self.setPicker({ ...done, error: 'It works, but Agentic Coder got busy meanwhile. Nothing was saved: connect again when it is done.' }); return; }
      const before = self.settings.remote;
      const plan = keepForm(done, { connect: true });
      if (!plan) return;
      self.setPicker(null);
      const r = self.settings.remote;
      if (!self.remoteRef.current.on || !self.remoteRef.current.conn || connectionChanged(before, r, plan.keys.some((k) => k.op === 'save' && k.id === done.source))) { useRemote(r); return; }
      self.push({ type: 'note', text: `${sourceWord(done.source)} saved and still in use (${remoteLabel(r)}).`, tone: 'dim' });
    });
  };
  // Save only: kept for next time; this window stays where it is.
  // Save only: kept, not connected. The note says where the window stays (this Mac by its name when
  // another Mac shows it), then, when the service has what Connect needs, the app asks whether to
  // connect now (the owner's pick, 3 Oct 2026: "Another service saved" read as something else using it).
  const remoteWord = (src) => (src === 'machine' ? 'computer' : src === 'openai' ? 'service' : 'claude');
  const saveOnlyForm = (pk) => {
    const plan = keepForm(pk, { connect: false });
    if (!plan) return;
    self.setPicker(null);
    const r = plan.remotes[pk.source];
    const inUse = self.remoteRef.current.on && sourceOf(self.settings.remote) === pk.source;
    const label = r?.address ? remoteLabel(r) : '';
    const stays = inUse ? 'The changes are used from the next Connect or start.'
      : self.remoteRef.current.on ? `This window is still on ${sourceWord(sourceOf(self.settings.remote))} (${remoteLabel(self.settings.remote)}).`
        : `This window is still on ${self.sharedRef.current ?? 'this Mac'}’s own model, which is ${self.modelOff ? 'off' : 'on'}.`;
    self.push({ type: 'note', text: `Saved: ${sourceWord(pk.source)}${label ? ` (${label}${r.key ? ' · with a key' : ''})` : r?.key ? ' (with a key)' : ''}. ${stays}`, tone: 'dim' });
    if (!readyRemote(r) || busyNow()) { self.push({ type: 'note', text: `/remote ${remoteWord(pk.source)} connects it any time.`, tone: 'dim' }); return; }
    self.savedAskRef.current = { source: pk.source, label: label || sourceWord(pk.source), again: inUse, model: r.kind === 'claude' ? null : r.model || null };
    self.openChoice('remote-saved');
  };
  // /jumptomac: the window that typed it goes to that Mac's sessions (door.mjs viewJumping); the keeper
  // sends it. The save question for a Mac reached for the first time is asked there, once its door answers.
  const jumpTo = async (mac) => {
    const r = await askJump(process.env.AGENTIC_IN_HOST, mac);
    self.push({ type: 'note', text: r.ok ? `Jumping to ${mac}. This session keeps running here; ${DETACH_LABEL} there comes back to it.` : `Could not jump: ${r.text}`, tone: r.ok ? 'dim' : 'warn' });
  };
  // /jumptomac alone: the box opens on the saved Macs at once; what Tailscale says of them comes a moment later.
  const openJumpBox = async () => {
    const door = await import('./door.mjs');
    const settingsNow = loadSettings();
    self.setPicker(jumpBox({ saved: door.savedMacs(settingsNow), last: settingsNow.lastMac ?? null, here: self.sharedRef.current ?? hostname().split('.')[0] }));
    const ts = await door.tailscaleMacs().catch(() => null);
    // As an update of the box shown (it may not be drawn yet when the answer comes at once).
    self.setPicker((p) => (p?.kind === 'jump' ? { ...p, ts, here: ts?.self || p.here } : p));
  };
  // A key in the box: jumpKey says what it means; jumping, forgetting and closing happen here.
  const jumpBoxKey = async (pk, ch, key) => {
    const r = jumpKey(pk, ch, key);
    if (r.bad) { self.push({ type: 'note', text: r.bad, tone: 'warn' }); self.setPicker(r.box); return; }
    if (r.close) { self.setPicker(null); self.push({ type: 'note', text: 'Stayed here.', tone: 'dim' }); return; }
    if (r.offline) { self.setPicker(null); self.push({ type: 'note', text: `${r.offline} is offline on Tailscale${r.ago ? ` (it last saw it ${r.ago})` : ''}. Wake it, or check Tailscale there, then /jumptomac again.`, tone: 'warn' }); return; }
    if (r.forget) {
      const { forgetMac } = await import('./door.mjs');
      forgetMac(r.forget);
      self.setPicker(r.box);
      self.push({ type: 'note', text: `Forgot ${r.forget}: /jumptomac no longer lists it as saved. Its key stays in the Keychain, so adding it again asks for none.`, tone: 'dim' });
      return;
    }
    if (r.jump) { self.setPicker(null); await jumpTo(r.jump); return; }
    self.setPicker(r.box);
  };
  // /remote claude, /remote computer, /remote service: straight to that saved
  // service; one not set up yet opens the form on it, typing in its first row.
  const remoteTo = (source) => {
    const r = remotesOf(self.settings)[source];
    if (!readyRemote(r)) { openRemoteForm({ source, ask: source === 'claude' ? 'key' : 'address' }); return; }
    if (self.remoteRef.current.on && self.remoteRef.current.conn && sourceOf(self.settings.remote) === source) { self.push({ type: 'note', text: `Already on ${sourceWord(source)} (${remoteLabel(self.settings.remote)}).`, tone: 'dim' }); return; }
    self.settings.remote = saveSettings({ remote: { ...r, use: true } }).remote;
    useRemote(self.settings.remote);
  };
  // An Ollama service's list (ollama.mjs), read in the background: after a connect, and as /model opens.
  const refreshCatalog = (conn = self.remoteRef.current.conn) => {
    if (!conn?.info?.ollama) return;
    ollamaCatalog({ url: conn.url }).then((c) => { if (c && self.remoteRef.current.conn === conn) self.setCatalog(c); }).catch(() => {});
  };
  // An Ollama model's own context (/effort's Context row; 0: the service's own), kept by model in
  // the service's set-up ("contexts"), so `coding -p` and the next start ask for it too.
  const serviceCtx = (name = self.model.remote?.model) => Number(self.settings.remote?.contexts?.[name]) || 0;
  // On an Ollama service now (connected): its models' context is theirs, not this Mac's.
  const onService = () => Boolean(self.model.remote?.ollama && self.remoteRef.current.conn?.info?.ollama);
  const setServiceCtx = (name, v) => {
    const src = sourceOf(self.settings.remote);
    const put = (p) => { const contexts = { ...(p?.contexts ?? {}) }; if (v) contexts[name] = v; else delete contexts[name]; return { ...p, contexts }; };
    const saved = saveSettings({ remote: put(self.settings.remote), ...(self.settings.remotes?.[src] ? { remotes: { ...self.settings.remotes, [src]: put(self.settings.remotes[src]) } } : {}) });
    self.settings.remote = saved.remote;
    self.settings.remotes = saved.remotes;
  };
  // A message that waited while a model loaded on the service goes now.
  const flushQueued = () => {
    const q = self.queuedRef.current;
    if (q) { self.queuedRef.current = null; self.setQueued(null); setTimeout(() => self.remoteFnRef.current.send?.(q), 50); }
    else setTimeout(() => self.jobWakeRef.current?.(), 50); // a background job that ended while it loaded
  };
  // A model not loaded on the service (or loaded at another context than it is to run at) is loaded
  // now, with an empty prompt, so a switch is not first felt on the next reply: the footer says so,
  // and a message sent meanwhile waits for it. Then the context it really runs at is read and used
  // (until then no more than 32k is planned for: Ollama cuts a longer prompt without a word).
  // One that does not fit in the service's GPU memory is tried again at half the context, down to
  // 32k, and the size it fitted at is kept for that model; one that never loads gives way to `back`,
  // the model in use before, and says why (the user's pick, 1 Oct 2026). Answers whether it loads.
  // After the model is loaded (or was): this window notes what it uses on the service, the model
  // left behind is let go (only you use the service: the user's pick, 2 Oct 2026; never one another
  // window uses), and a model never tried gets its try-out.
  const afterLoad = (conn, { back = null } = {}) => {
    const name = conn?.info?.model;
    if (!name || !conn.info.ollama) return;
    noteModels(conn);
    if (back && back !== name && !modelsInUseOn(conn.url).has(back)) {
      unloadOllama({ url: conn.url, model: back }).then((ok) => { if (ok) { self.push({ type: 'note', text: `${back} let go on the service, so ${name} has its room.`, tone: 'dim' }); refreshCatalog(conn); } });
    }
    maybeTryOut(conn);
  };
  // What this window has on the service: the main model and the helpers that are on, less any that
  // another window there uses too.
  const usedHere = (conn) => {
    const others = modelsInUseOn(conn.url);
    const helpers = Object.values(self.agent.helperJobs ?? {}).filter((j) => j.on && j.model && j.model !== MAIN).map((j) => j.model);
    return [...new Set([conn.info.model, ...helpers])].filter((n) => n && !others.has(n));
  };
  // The window leaves a service while it stays open (back to this Mac, or on to another service):
  // what it had there is let go first, as at quit (only: just these), then the tunnel closes.
  // Before, it stayed loaded there for ever (keep_alive -1; 3 Oct 2026).
  const leaveService = async (conn, { only = null } = {}) => {
    if (!conn) return;
    noteModels(null);
    if (conn.info?.ollama && process.env.AGENTIC_UNLOAD !== 'off') {
      const names = usedHere(conn).filter((n) => !only || only.includes(n));
      // A renewal already on its way would load the model again after it was let go: it lands first.
      await self.renewRef.current;
      await Promise.all(names.map((m) => unloadOllama({ url: conn.url, model: m, timeoutMs: 3000 })));
    }
    conn.stop();
  };
  // What this window uses on the service (copies.mjs): the main model and the helpers that are loaded.
  const noteModels = (conn = self.remoteRef.current.conn) => {
    if (!conn?.info?.ollama) { updateWindow({ service: null, models: [] }); return; }
    const helpers = Object.values(self.agent.helperJobs ?? {}).filter((j) => j.on && j.model && j.model !== MAIN).map((j) => j.model);
    updateWindow({ service: conn.url, models: [...new Set([conn.info.model, ...helpers])] });
    // Kept for the window's close: the endpoint (and its key) is gone by then.
    self.remoteRef.current.headers = authHeaders(conn.url);
  };
  // The try-out (agent/tryout.mjs): the first time a model on a service is picked, three short real
  // steps, in the background; the result is kept (tryouts.mjs) and shows in /model and /remote.
  const maybeTryOut = (conn) => {
    const name = conn?.info?.model;
    const where = self.settings.remote?.address;
    if (!name || !where || process.env.AGENTIC_TRYOUT === 'off') return;
    const entry = self.catalog?.models.find((m) => m.id === name) ?? conn.info.ollama ?? {};
    if (entry.tools === false || readTryouts(where)[name] || self.remoteRef.current.trying === name) return;
    self.remoteRef.current.trying = name;
    self.push({ type: 'note', text: `Trying ${name} once: it reads a file, fixes one line and runs a command (nothing is changed for real).`, tone: 'dim' });
    tryOut({ url: conn.url, model: name, entry, numCtx: conn.numCtx ?? undefined, keepAlive: OPEN_KEEP }).then((r) => {
      saveTryout(where, name, { ok: r.ok, tokS: r.tokS ?? null, why: r.why, steps: r.steps, secs: r.secs });
      self.push({ type: 'note', text: `${r.ok ? '✔' : '✗'} ${name}: ${r.steps.map((x) => `${x.ok ? '✔' : '✗'} ${x.text}`).join(' · ')}${r.tokS ? ` · ${Math.round(r.tokS)} tok/s` : ''}. ${r.ok ? 'It works with the agent; kept for next time.' : `It did not pass (${r.why}): /model shows ✗ beside it; it can still be used.`}`, tone: r.ok ? 'dim' : 'warn' });
      refreshCatalog(conn);
    }).catch(() => {}).finally(() => { if (self.remoteRef.current.trying === name) self.remoteRef.current.trying = null; });
  };
  const preloadRemote = (conn, { back = null, skip = new Set() } = {}) => {
    const o = conn?.info?.ollama;
    if (!o || (o.loaded && (!conn.numCtx || o.loadedCtx === conn.numCtx))) { afterLoad(conn, { back }); return false; }
    const my = (self.remoteRef.current.loads = (self.remoteRef.current.loads ?? 0) + 1);
    const mine = () => self.remoteRef.current.loads === my && self.remoteRef.current.conn === conn;
    const name = conn.info.model;
    const asked = conn.numCtx ?? null;
    const t0 = Date.now();
    self.setRemoteState('loading');
    (async () => {
      let numCtx = asked;
      // The service's own is at most the model's longest (256k here for most).
      let at = numCtx || Math.min(o.ctx || 262_144, 262_144);
      let err = null;
      for (;;) {
        try {
          await preloadOllama({ url: conn.url, model: name, numCtx, keepAlive: OPEN_KEEP });
          // The service's own size is less than the agent works in (Ollama's own is 4k): loaded again at
          // the floor, and kept for it below.
          const own = numCtx ? null : (await ollamaModel({ url: conn.url, model: name }).catch(() => null))?.loadedCtx;
          if (own && own < floorCtx(o) && mine()) { numCtx = at = floorCtx(o); conn.numCtx = numCtx; setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx }); continue; }
          err = null; break;
        } catch (e) { err = e; }
        if (!mine() || !isOutOfMemory(err.message) || at / 2 < 32_768) break;
        self.push({ type: 'note', text: `${name} did not fit on the service at ${ctxWord(at)} context: trying ${ctxWord(at / 2)}…`, tone: 'warn' });
        at /= 2;
        numCtx = at;
        conn.numCtx = numCtx;
        setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx });
      }
      if (!mine()) return;
      if (!err) {
        const now = await ollamaModel({ url: conn.url, model: name }).catch(() => null);
        if (!mine()) return;
        const real = now?.loadedCtx || numCtx;
        if (real && real !== self.agent.ctx) { conn.ctx = real; self.agent.ctx = real; self.setCtx(real); self.agent.syncRules(); }
        // Loaded at the service's own: that size is named from now on (the model is not loaded again for a request).
        if (!numCtx && real) { conn.numCtx = real; setEndpoint(conn.url, { ...endpointOf(conn.url), numCtx: real }); }
        // It fitted only smaller: that size is kept for it, so the next switch loads it at once.
        if (numCtx !== asked) setServiceCtx(name, numCtx);
        self.setRemoteState('on');
        self.push({ type: 'note', text: `${name} is loaded on the service (${Math.max(1, Math.round((Date.now() - t0) / 1000))} s)${real ? ` · ${ctxWord(self.agent.ctx)} context` : ''}.${numCtx !== asked ? ' Kept at that size for it; /effort’s Context row changes it.' : ''}`, tone: 'dim' });
        refreshCatalog(conn);
        afterLoad(conn, { back });
        flushQueued();
        return;
      }
      const gb = self.catalog?.models.find((m) => m.id === name)?.bytes;
      const why = isOutOfMemory(err.message)
        ? `the service has no room for it${gb ? ` (its weights alone are ${(gb / 1e9).toFixed(1)} GB)` : ''}, even at ${ctxWord(at)} context, next to the models it keeps loaded`
        : err.message;
      if (back && back !== name) {
        self.push({ type: 'note', text: `${name} did not load on the service: ${why}. Back on ${back}.`, tone: 'warn' });
        try {
          const c2 = await useServiceModel(back);
          self.setRemoteState('on');
          refreshCatalog(c2);
          if (!preloadRemote(c2)) flushQueued();
        } catch (e) {
          self.setRemoteState('down');
          self.push({ type: 'note', text: `${back} did not answer either: ${e.message}. /model or /remote to pick another.`, tone: 'error' });
        }
        return;
      }
      // No model to go back to: a backup, the best one that passed its try-out (or else the suggestion).
      // (At most two spares in a row: a service with no room for any gets a note, not a loop.)
      const gone = new Set([...skip, name]);
      const spare = self.catalog && gone.size <= 2 ? suggestModel(self.catalog.models.filter((m) => !gone.has(m.id)), readTryouts(self.settings.remote?.address)) : null;
      if (spare) {
        self.push({ type: 'note', text: `${name} did not load on the service: ${why}. Using ${spare} instead (/model picks another).`, tone: 'warn' });
        try {
          const c2 = await useServiceModel(spare);
          self.setRemoteState('on');
          refreshCatalog(c2);
          if (!preloadRemote(c2, { skip: gone })) flushQueued();
          return;
        } catch (e) { self.push({ type: 'note', text: `${spare} did not answer either: ${e.message}.`, tone: 'error' }); }
      }
      self.setRemoteState('on');
      self.push({ type: 'note', text: `${name} did not load on the service: ${why}. /model picks another.`, tone: 'warn' });
      flushQueued();
    })();
    return true;
  };
  // Points this window at another model on the same service: it is checked (it answers, what it can
  // do), the pick is kept for next time, and the agent goes on with it. Throws when it does not answer.
  const useServiceModel = async (id) => {
    const before = self.remoteRef.current.conn;
    const r = { ...self.settings.remote, model: id };
    const conn = await connectRemote(r, { serviceSize: true });
    // The same address (http): its endpoint now names the new model. A tunnel of its own (ssh): the old one closes.
    if (before && before.url !== conn.url) before.stop();
    self.remoteRef.current.conn = conn;
    self.remoteRef.current.why = null;
    self.lendConn(r, conn);
    self.agent.remoteConf = remoteConfOf(r);
    const src = sourceOf(r);
    const saved = saveSettings({ remote: r, ...(self.settings.remotes?.[src] ? { remotes: { ...self.settings.remotes, [src]: { ...self.settings.remotes[src], model: id } } } : {}) });
    self.settings.remote = saved.remote;
    self.settings.remotes = saved.remotes;
    const m = conn.model;
    self.setModel(m);
    self.agent.url = conn.url;
    self.agent.canSee = Boolean(conn.vision);
    self.relimit(m);
    self.agent.model = modelWithLimits(m, self.limitsRef.current);
    self.applyKeep();
    self.agent.ctx = conn.ctx; self.setCtx(conn.ctx);
    self.agent.syncRules();
    return conn;
  };
  // /model on an Ollama service: another of its models, in place. The chat stays (one longer than
  // the new model's context is summed up before the next reply, as when a chat fills). One that does
  // not answer changes nothing; one that does not load goes back to this one (preloadRemote).
  const switchService = async (entry) => {
    if (busyNow()) { self.push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return; }
    const back = self.model.remote?.model ?? null;
    self.setRemoteState('connecting');
    let conn;
    try { conn = await useServiceModel(entry.id); } catch (e) {
      self.setRemoteState(self.remoteRef.current.conn ? 'on' : 'down');
      self.push({ type: 'note', text: `Could not switch to ${entry.id}: ${e.message}. Still on ${back ?? self.model.name}.`, tone: 'error' });
      return;
    }
    self.setRemoteState('on');
    // What it runs at: the size kept for it, else (loaded) the one it has; a cold model's own is
    // said by the note once it has loaded (until then no more than 32k is planned for).
    const room = conn.numCtx || entry.loadedCtx || entry.ctx || conn.ctx;
    const used = self.agent.ctxUsed ?? 0;
    self.push({ type: 'note', text: `Now on ${entry.id} on ${remoteLabel(self.settings.remote)}${conn.numCtx || entry.loaded ? ` · ${ctxWord(room)} context` : ''}. The chat stays${used > room * 0.85 ? `; at about ${ctxWord(used)} it is more than fits, so the oldest part is summed up before the next reply` : ''}.${entry.tools ? '' : ' It cannot use tools: it answers in words only.'}`, tone: 'dim' });
    preloadRemote(conn, { back });
    refreshCatalog(conn);
  };
  // /model: the model list and the thinking level in one picker. Each model's edited copy, when
  // one is saved, is one more row after the models, and each service set up in /remote one more
  // (Claude API, the other computer, another service). On an Ollama service it is the service's
  // own list instead (remote-models.mjs), read again as it opens; this Mac's models and the other
  // services follow it, and enter on one of its models opens that model's own settings first
  // (openOwnSettings). Elsewhere its Effort starts from the one you chose, whatever the model in use allows.
  // A model whose file is not on this Mac is left out of both lists (3 Oct 2026, the owner's pick: the
  // models were removed to free the disk); its settings stay in its model.mjs, and once
  // coding setup --model <id> brings the file back it is listed again. The one in use always is.
  const onThisMac = (m) => existsSync(modelPath(m));
  const openModelPicker = () => {
    const conn = self.remoteRef.current.conn;
    if (self.model.remote && conn?.info?.ollama) {
      refreshCatalog(conn);
      const last = self.localModelRef.current ?? modelById(self.settings.model);
      const sv = { title: sourceWord(self.model.remote.source), where: self.model.remote.label, ms: conn.info.ms ?? null, mac: [...Object.values(MODELS).filter(onThisMac), ...editedModels()], services: remoteChoices(self.settings).filter((x) => x.source !== self.model.remote.source), lastLocal: last?.name ?? null };
      self.setPicker({ ...openService({ inUse: self.model.remote.model }), sv });
      return;
    }
    const lvNow = thinkingLevel(self.model, self.agent.thinking, self.agent.effort);
    const models = [...Object.values(MODELS).filter((m) => m.id === self.model.id || onThisMac(m)), ...editedModels(), ...remoteChoices(self.settings)];
    self.setPicker({ kind: 'model', models, index: Math.max(0, models.findIndex((m) => (self.model.remote ? m.source === self.model.remote.source : m.id === self.model.id))), levelId: lvNow.id, on: Boolean(lvNow.effort) });
  };
  return { useRemote, useLocal, reconnect, openRemoteForm, busyNow, loopsBadgeOf, loopsOf, tickLoops, connectForm, remoteWord, saveOnlyForm, jumpTo, openJumpBox, jumpBoxKey, remoteTo, refreshCatalog, serviceCtx, onService, setServiceCtx, usedHere, noteModels, preloadRemote, switchService, openModelPicker };
}
