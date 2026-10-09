// The window's panels, /effort and its limits, /model's own menu, thinking (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { availableBytes, freeWithHandBack, scanServers, searchBytes, thinkingLevel, remoteModel, setEndpoint, endpointOf } from '../../../models/index.mjs';
import { ctxWord } from './remote-models.mjs';
import { suggestedFor } from './remote-suggested.mjs';
import { saveSettings, loadSettings } from './store.mjs';
import { searchModels, ownOf, readLimits, OWN_ROWS, effortNote, limitChanges, applyLimits, applySearch, limitsToSave, modelWithLimits, showLimit } from './limits.mjs';
import { IDLE } from './app-common.mjs';

export function panelsEffort(self, own) {
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
  return { memoryForRestart, openEffortLimits, openOwnSettings, fillSuggested, sharedValues, saveOwnSettings, keepOwnSettings, sayEffort, saveEffortLimits, setThinkingFn };
}
