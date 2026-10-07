// The window's model (App.jsx): /model's picker and its choices, the hub, switching models, a copy of a
// project's files and putting it back, the limits a model runs with and its own Effort.
// The functions are the App's own, moved here word for word: the App's names (and App.jsx's) are read through
// self, which App makes at each render, so a function sees the values of the render that made it.
import { homedir } from 'node:os';
import { primeRows } from './screen.jsx';
import { saveTime, loadTimes } from './start-times.mjs';
import { isHomeFolder, SESSION_MARK } from '../agent/prompt.mjs';
import { thinkingLevel, battleHold, otherCopies, freeAfterQuit, serverProcesses, availableBytes, modelById, MODELS, DEFAULT_MODEL, remoteLabel, modelPath, liveUsers, stopIdleServers, chooseContext, ModelServer, LINGER_SECS, warmUp, contextCheck, hasDraft, setEndpoint, endpointOf, OPEN_KEEP, sourceOf } from '../../../models/index.mjs';
import { copyAt, registerWindow, projectOf, othersIn, keptCopies, unregisterWindow, copyChanges, removeCopy, makeCopy, changeLines, putBack } from './copies.mjs';
import { startWeightsServer } from './weights.mjs';
import { MODE_OPTIONS } from './help.mjs';
import { loadSettings, saveSettings } from './store.mjs';
import { startModeFor } from './perm-store.mjs';
import { modeWord } from './perms.mjs';
import { modelWithLimits, readLimits, OWN_ROWS, ownOf, limitChanges, applyLimits } from './limits.mjs';
import { tildeOf, IDLE, exited, BIG_WORDS } from './app-common.mjs';

export function modelPart(self) {
  // /model's Effort row is the highlighted model's own levels (1 Oct 2026: K2 Horizon and Bonsai have Medium, Gemma
  // and Qwen do not). The level you chose is kept by name (levelId, on), so moving the cursor never changes it; a model
  // without it shows its nearest (thinkingLevel: Medium is High there). A remote's row has no levels: the model in use's.
  const pickModelOf = (pk) => { const m = pk.models[pk.index]; return m?.thinkingLevels ? m : self.model; };
  const pickLevels = (pk) => pickModelOf(pk).thinkingLevels ?? [];
  const pickLevel = (pk) => thinkingLevel(pickModelOf(pk), pk.on, pk.levelId);
  const waitForBattle = async (stillOn = () => true) => {
    let h = battleHold();
    if (!h) return;
    self.setBattle(h); self.setStartPhase('waiting');
    await new Promise((resolve) => {
      const tick = setInterval(() => {
        if (!stillOn()) { clearInterval(tick); resolve(); return; }
        h = battleHold();
        if (h) self.setBattle(h); else { clearInterval(tick); resolve(); }
      }, 3000);
    });
    self.setBattle(null); self.setStartPhase('loading');
  };
  // Waits while another copy of the model is loaded outside the app windows. Returns what is free
  // once the servers that quit meanwhile give their memory back (freeAfterQuit, from the last look
  // while they ran), 0 when it did not wait or none quit.
  const waitForOthers = async (m, stillOn = () => true) => {
    let others = otherCopies(m);
    if (!others.length) return 0;
    const look = () => ({ free: availableBytes(), servers: serverProcesses() });
    let last = look();
    const who = (list) => list.map((o) => `${o.who} (port ${o.port ?? '?'}, ${(o.bytes / 1e9).toFixed(1)} GB)`).join(' and ');
    self.setWaiting(who(others));
    self.setStartPhase('waiting');
    await new Promise((resolve) => {
      const done = () => { clearInterval(tick); self.waitRef.current = null; resolve(); };
      const tick = setInterval(() => {
        if (!stillOn()) return done();
        others = otherCopies(m);
        if (others.length) { self.setWaiting(who(others)); last = look(); } else done();
      }, 3000);
      self.waitRef.current = { go: () => { self.push({ type: 'note', text: `Starting anyway: ${who(others)} still has ${m.name} loaded, so both may be slow.`, tone: 'warn' }); done(); } };
    });
    self.setWaiting(null);
    self.setStartPhase('loading');
    return freeAfterQuit(last, serverProcesses());
  };
  const modelKey = (m) => m.id ?? m.file ?? m.name;
  const timeLoad = (m, cold) => { self.timing.current = { id: modelKey(m), loadAt: Date.now(), warmAt: null, cold }; };
  const timeLoaded = (st) => {
    const t = self.timing.current;
    if (!t) return;
    t.cold = !st?.shared;
    if (t.cold) saveTime(t.id, 'load', (Date.now() - t.loadAt) / 1000);
    t.warmAt = Date.now();
  };
  const timeWarmed = (res) => {
    const t = self.timing.current;
    if (t?.warmAt && res && !res.skipped && !res.remote && !res.fallback) saveTime(t.id, res.restored ? 'restore' : 'read', (Date.now() - t.warmAt) / 1000);
  };
  const timeDone = () => {
    const t = self.timing.current;
    if (!t) return;
    self.setStartTook((Date.now() - t.loadAt) / 1000);
    self.timesRef.current = loadTimes();
    self.timing.current = null;
  };
  const listOtherWindows = () => {
    if (process.env.AGENTIC_WINDOWS === 'off') return undefined;
    // A moment after the window opens (git is asked which project this is): nothing typed meanwhile waits on it.
    const t = setTimeout(() => {
      let kept = [];
      try {
        const m = copyAt(self.opts.cwd);
        if (m) { self.copyRef.current = m; self.setInCopy(true); registerWindow(self.opts.cwd, { copyOf: m.original }); }
        else {
          const p = projectOf(self.opts.cwd);
          registerWindow(self.opts.cwd);
          self.othersRef.current = othersIn(p.root);
          kept = keptCopies(p.root);
        }
      } catch {}
      if (self.othersRef.current.length && !isHomeFolder(self.opts.cwd)) {
        // Already answering a message typed at once: said in a line instead of asked.
        if (self.agent.busy) self.push({ type: 'note', text: 'Another window is also working in this folder. /copy gives this window its own copy.', tone: 'warn' });
        else openChoice('same-folder');
      }
      else if (kept.length) self.push({ type: 'note', text: `A window that closed earlier left changes in its own copy, not yet put back: open a window in ${tildeOf(kept[0].work)} and type /copy.`, tone: 'warn' });
    }, 300);
    // The window closes: its file goes, and so does its copy when nothing is left to put back.
    let tidied = false;
    const tidy = () => {
      if (tidied) return;
      tidied = true;
      self.remoteFnRef.current.unloadOnQuit?.();
      unregisterWindow();
      const m = self.copyRef.current;
      if (!m) return;
      try { if (!copyChanges(m).changes.length) removeCopy(m); } catch {}
    };
    process.once('exit', tidy);
    // The app closes (quit) before the process ends: tidy then.
    return () => { clearTimeout(t); process.off('exit', tidy); tidy(); };
  };
  const pushFn = (...its) => {
    const fold = its.filter((it) => it.type === 'note' && it.fold);
    let list = its.filter((it) => !(it.type === 'note' && it.fold));
    if (fold.length) self.heldNotes.current.push(...fold.map((it) => it.text));
    if (!list.length) return;
    if (self.heldNotes.current.length) { list = [{ type: 'note', tone: 'dim', text: self.heldNotes.current.join(' · ') }, ...list]; self.heldNotes.current = []; }
    if (self.railOn.current && self.pre.current && list.some((it) => it.type !== 'machine')) {
      list = [{ type: 'machine', ...self.pre.current }, ...list];
      self.pre.current = null;
      self.setLive((l) => ({ ...l, pre: null }));
    }
    const made = list.map((it) => ({ key: `i${++self.seq}`, ...(self.railOn.current && it.rail === undefined ? { rail: true } : {}), ...it }));
    queueMicrotask(() => {
      try { primeRows(made, self.measure.current); } catch {}
      self.setItems((xs) => [...xs, ...made]);
    });
  };
  const fold = (f) => { const s = self.folds.current; s.list.push(f); if (s.list.length > 50) s.list.shift(); s.back = 0; };

  const flashFn = (text, ms = 2000) => { self.setNotice(text); setTimeout(() => self.setNotice((n) => (n === text ? null : n)), ms); };

  const setModeFn = (m) => { self.agent.mode = m; self.setModeState(m); };

  // The menus that /mode, /meters and /mouse open when typed alone: a title, a line
  // on what it sets, the options with what each does, the one in use.
  // applyChoice is also what the typed forms use, so both say the same.
  // (/effort opens the Effort and limits panel instead: openEffortLimits.)
  const choiceMenu = (id) => {
    if (id === 'memory-save') {
      // Asked at a start about what the last window's second look found, or after a task.
      const again = self.pendingSaveRef.current?.again;
      return { title: 'Remember for next time?', blurb: again ? 'What the last window found when it read the conversation again is listed above. /memory undo takes a save back.' : 'What Agentic Coder learned in that task is listed above. /memory undo takes a save back.', what: 'memory', current: 'save', options: [{ id: 'save', label: 'Save', note: 'read at every start from now on' }, { id: 'skip', label: 'Skip', note: 'not saved, and not offered again; /update memory still saves it if you ask' }] };
    }
    if (id === 'startmode') {
      const st = startModeFor(self.agent.cwd);
      const now = st && !st.here ? ` Now it starts in ${modeWord(st.mode)}, saved ${st.where === 'everywhere' ? 'for every folder' : `for ${st.key.replace(homedir(), '~')}`}.` : '';
      return { title: 'Start-up mode', blurb: `What Agentic Coder starts in for ${self.agent.cwd.replace(homedir(), '~')}, saved for this folder; /mode and shift+tab change this conversation, and with nothing saved a window starts in the mode the last one was left in.${now}`, what: 'startmode', current: st?.here ? st.mode : 'reset', options: [...MODE_OPTIONS, { id: 'reset', label: 'Not saved', note: 'use the one saved above it or for every folder, else the last window\'s mode' }] };
    }
    if (id === 'mode') return { title: 'Mode', blurb: 'How Agentic Coder asks before it changes things. For this conversation; shift+tab switches too.', what: 'mode', current: self.agent.mode, options: MODE_OPTIONS };
    if (id === 'vision-get') {
      const gb = ((self.model.vision?.bytes ?? 0) / 1e9).toFixed(2);
      return { title: `Look at the picture? ${self.model.name} needs its vision add-on`, blurb: `A one-time download of ${gb} GB (then kept with the model). It loads only in windows where you attach a picture.`, what: 'the picture', current: null, options: [
        { id: 'get', label: `Download it (${gb} GB) and look`, note: 'then the model reloads once with it (about 20 s)' },
        { id: 'skip', label: 'Send without the picture', note: 'the message goes now, with a line saying a picture was attached' },
      ] };
    }
    if (id === 'vision-switch') {
      return { title: `${self.model.name} cannot look at pictures`, blurb: `Hand this message to a model that can? Only one model fits in memory, so it loads in ${self.model.name}'s place (about 20–40 s), answers, and ${self.model.name} comes back after (the conversation stays).`, what: 'the picture', current: null, options: [
        ...self.seeingModels().map((m) => ({ id: `use:${m.id}`, label: `${m.name} for this message`, note: `it looks at the picture, then ${self.model.name} again` })),
        { id: 'skip', label: 'Send without the picture', note: `${self.model.name} answers, with a line saying a picture was attached` },
      ] };
    }
    // Two windows in one project (copies.mjs): asked as a window opens there, and when its copy changed files.
    if (id === 'same-folder') {
      const o = self.othersRef.current[0];
      const when = o?.at ?? o?.started;
      const mins = when ? Math.max(1, Math.round((Date.now() - Date.parse(when)) / 60_000)) : null;
      return { title: self.othersRef.current.length > 1 ? `${self.othersRef.current.length} other windows are already working in this folder` : 'Another window is already working in this folder',
        blurb: o?.task ? `It is working on "${o.task}"${mins ? ` (${mins} min ago)` : ''}.` : 'It has not been given a task yet.', what: 'this folder', current: null, options: [
          { id: 'copy', label: 'Work in my own copy', note: 'both windows can change files safely; I ask before putting my changes back' },
          { id: 'share', label: 'Share this folder', note: 'both change the same files, so one window can overwrite the other\'s work' },
        ] };
    }
    if (id === 'copy-back') {
      const list = self.copyAsk.current.lines ?? [];
      const word = list.length === 1 ? 'file' : 'files';
      return { title: `This window worked in its own copy and changed ${list.length} ${word}`,
        blurb: `${list.slice(0, 6).map((l) => `${l.path} ${l.status === 'D' ? 'removed' : `+${l.add} −${l.del}${l.status === 'A' ? ' new file' : ''}`}`).join(' · ')}${list.length > 6 ? ` · and ${list.length - 6} more` : ''}`, what: 'the changes', current: null, options: [
          { id: 'back', label: 'Put them back into the real folder', note: `into ${tildeOf(self.copyRef.current?.original ?? '')}; a file the other window also changed is merged` },
          { id: 'show', label: 'Show me the changes first', note: 'the lines that changed, then this question again' },
          { id: 'later', label: 'Not now', note: 'the copy stays; /copy brings this question back' },
        ] };
    }
    if (id === 'copy-conflict') {
      const c = self.copyAsk.current.conflicts ?? [];
      return { title: `${c.length === 1 ? '1 file was' : `${c.length} files were`} changed in both windows: ${c.slice(0, 3).join(', ')}${c.length > 3 ? '…' : ''}`,
        blurb: 'The same lines changed here and in the real folder, so these were not put back. The rest went back.', what: 'those files', current: null, options: [
          { id: 'leave', label: 'Leave those as they are', note: 'the real folder keeps its version; /copy asks again later' },
          { id: 'mine', label: 'Use this window\'s version for those', note: 'overwrites the other window\'s change in those files' },
        ] };
    }
    // Save only kept a service that can connect: connect now? (asked as the app's questions are).
    if (id === 'remote-saved') {
      const a = self.savedAskRef.current ?? {};
      return { ask: true, title: a.again ? `Connect to ${a.label} again now, with the changes?` : `Connect to ${a.label} now?`, blurb: '', what: 'the remote', current: null, escWord: 'not now', options: [
        { id: 'connect', label: 'Connect now', recommended: true, note: `checks it answers, then this window uses ${a.model ?? 'it'} there` },
        { id: 'later', label: 'Not now', note: `it stays saved: /remote ${self.remoteWord(a.source)} connects it any time` },
      ] };
    }
    if (id === 'remote-down') {
      const local = self.localModelRef.current ?? modelById(self.settings.model) ?? MODELS[DEFAULT_MODEL];
      const why = self.remoteRef.current.why ?? 'it did not answer';
      return { title: `The remote model is not answering · ${remoteLabel(self.settings.remote)}`, blurb: `${why[0].toUpperCase()}${why.slice(1)}. Nothing loads on this Mac unless you pick it.`, what: 'the remote', current: null, options: [
        { id: 'retry', label: 'Try again', note: 'connect to it again' },
        { id: 'local', label: `Use ${local.name} on this Mac for now`, note: `loads it here (about ${Math.round((local.bytes ?? 7e9) / 1e9)} GB); the remote stays on for next time` },
        { id: 'edit', label: 'Open /remote', note: 'change the address, the key or how it connects' },
      ] };
    }
    // /model on a service: a model that cannot use tools is picked only after a yes (the user's pick, 1 Oct 2026).
    if (id === 'service-chat-only') {
      const m = self.chatOnlyRef.current?.m;
      return { title: `${m?.id ?? 'This model'} cannot use tools`, blurb: 'On it Agentic Coder can only answer in words: no file reads, edits, commands or searches. The chat stays, and /model switches back.', what: 'the model', current: 'stay', options: [
        { id: 'stay', label: `Stay on ${self.model.remote?.model ?? self.model.name}`, note: 'nothing changes' },
        { id: 'switch', label: `Switch to ${m?.id ?? 'it'} anyway`, note: 'it answers in words only; its settings come next' },
      ] };
    }
    if (id === 'autostart') return { title: 'Model at start', blurb: `Whether ${self.model.name} loads as a window opens. Off, it waits for /start, so a window you only look around in takes none of the Mac's memory. Kept for next time.`, what: 'the model at start', current: self.settings.modelAtStart ? 'on' : 'off', options: [{ id: 'off', label: 'Off', note: 'the model loads when you type /start' }, { id: 'on', label: 'On', note: 'the model loads as soon as a window opens' }] };
    if (id === 'mouse') return { title: 'Mouse in the prompt box', blurb: 'Drag over the text you are typing to highlight it: copied at once, delete removes it, typing replaces it. A click on the model’s label in the footer starts or stops it. While it is on the mouse is Agentic Coder’s; hold fn for Terminal’s own highlight. Kept for next time.', what: 'the mouse', current: self.S.current.mouse ? 'on' : 'off', options: [{ id: 'on', label: 'On', note: 'click, drag to highlight, double click for a word, click the model’s label' }, { id: 'off', label: 'Off', note: 'the mouse stays Terminal’s; option+click and ctrl+t still work' }] };
    return { title: 'Status bar', blurb: 'Model, speed, memory and effort on one line under the prompt. Kept for next time.', what: 'the status bar', current: self.S.current.meters ? 'on' : 'off', options: [{ id: 'on', label: 'On', note: 'show it under the prompt' }, { id: 'off', label: 'Off', note: 'hide it; /stats has the numbers' }] };
  };
  // The hub in the browser (/weights, /docs, /help): one small server per
  // window, closed with it. Answers { server, url } or null after a warning.
  // extra: more of the hub's address (/test: run=1, the model and test to pick).
  const openHub = (tab, extra = {}) => {
    // The hub always serves and edits the ORIGINAL model file: each save
    // rebuilds the copy from a fresh clone of it plus the whole edit list.
    const base = MODELS[self.model.edited ? self.model.edited.base : DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL];
    const onEdits = (e) => {
      if (e.kind === 'save') {
        self.setEditedSaved((all) => ({ ...all, [e.saved.base]: e.saved }));
        const n = e.saved.edits.length;
        self.push({ type: 'note', text: `Saved ${MODELS[e.saved.base]?.name ?? self.model.name} · edited — ${n} edit${n === 1 ? '' : 's'}. Pick it in /model to run on it. The original file is untouched.`, tone: 'dim' });
      } else { self.setEditedSaved((all) => { const rest = { ...all }; delete rest[e.base]; return rest; }); self.push({ type: 'note', text: `${MODELS[e.base]?.name ? `${MODELS[e.base].name}’s` : 'The'} edited copy was removed. The original was never touched.`, tone: 'dim' }); }
    };
    // The design style picked on the Instructions page: this window uses it from the next page request, as /design style does.
    const onDesign = (next) => { self.settings.design = next; if (self.agentRef.current) self.agentRef.current.designSaved = next; };
    try { self.weightsRef.current ??= startWeightsServer({ path: modelPath(base), onEdits, onDesign, cwd: self.cwd }); } catch (e) { self.push({ type: 'note', text: `Could not start the hub: ${e.message}`, tone: 'warn' }); return null; }
    const more = Object.entries(extra).filter(([, v]) => v != null && v !== '').map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
    const url = `${self.weightsRef.current.url}?tab=${tab}${more}`;
    if (!process.env.AGENTIC_NO_OPEN) Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    return { server: self.weightsRef.current, url };
  };
  // /model picked a different set of weights: only the model server restarts;
  // the window, the conversation and the history all stay. About 40 s: the
  // new weights never reuse a saved warm-up, so the instructions are re-read.
  // /effort uses it too, to restart on a new context or thinking cap (`done` is its note).
  // midTurn: the model asked for it in the middle of its reply (vision for a picture it read).
  const switchModel = async (next, done, { midTurn = false } = {}) => {
    if (self.S.current.live !== IDLE && !midTurn) { self.push({ type: 'note', text: 'Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch.', tone: 'warn' }); return; }
    // The model is off (not started yet, or /stop): the pick is kept and nothing loads; /start loads it.
    if (self.modelOffNow() && !midTurn) {
      self.setModel(next);
      relimit(next);
      self.agent.model = modelWithLimits(next, self.limitsRef.current);
      self.push({ type: 'note', text: `${done ? 'It applies' : `${next.name} is picked; it loads`} when you type /start. The model is off, so nothing loads now.`, tone: 'dim' });
      return;
    }
    const cur = self.serverRef.current;
    // Only one 27B fits in memory, so nobody else may be on the old server.
    const others = cur?.port ? liveUsers(cur.port).filter((p) => p !== process.pid) : [];
    if (others.length) { self.push({ type: 'note', text: `Another Agentic Coder window is using ${self.model.name}. Close it first, then switch.`, tone: 'warn' }); return; }
    self.setModel(next);
    self.setStarting(true); self.setStartPhase('loading'); self.setStartedAt(Date.now());
    // /stop while it switches calls the switch off (stopModel bumps loadRef): it ends quietly.
    const my = ++self.loadRef.current;
    const stillOn = () => self.loadRef.current === my && !self.modelOffNow();
    try {
      const oldPid = cur?.child?.pid ?? cur?.shared?.pid;
      const mem = self.memoryForRestart(); // before the old server stops: what it gives back counts as free
      await cur?.stop();
      stopIdleServers(); // a server we only attached to (kept loaded earlier) is freed too
      // Wait for the old one to really exit: two 27Bs never fit side by side.
      if (oldPid && !(await exited(oldPid))) throw new Error('the old model server did not stop');
      await waitForBattle(stillOn);
      const back = await waitForOthers(next, stillOn);
      if (!stillOn()) return;
      const fixed = self.limitsRef.current.context;
      const available = Math.max(mem.free, back, availableBytes());
      const c = fixed ? { ctx: fixed, reason: null } : chooseContext(next, { effort: self.agent.thinking ? self.agent.effort : undefined, available });
      // A context you picked is checked on a restart too: used as asked, said when it does not fit.
      if (fixed) {
        const chk = contextCheck(next, fixed, { draft: hasDraft(next), available, search: mem.search(self.limitsRef.current) });
        c.reason = chk.note;
        if (!chk.fits) self.push({ type: 'note', text: chk.note, tone: 'warn' });
      }
      self.memoryNote.current = c.reason ?? null;
      timeLoad(next, true);
      const srv = new ModelServer(modelWithLimits(next, self.limitsRef.current));
      self.serverRef.current = srv;
      srv.on('crash', ({ code, signal }) => {
        if (srv.restarts >= 3) { self.push({ type: 'note', text: `The model server keeps stopping (code ${code ?? signal}). See ~/.agentic-coder/logs/server.log, then restart Agentic Coder.`, tone: 'error' }); return; }
        self.push({ type: 'note', text: `The model server stopped (code ${code ?? signal}); restarting it.`, tone: 'warn' });
        self.restartRef.current = srv.restart().then(() => { self.push({ type: 'note', text: 'The model server is back.', tone: 'dim' }); }).catch((e) => self.push({ type: 'note', text: e.message, tone: 'error' })).finally(() => { self.restartRef.current = null; });
      });
      const st = await srv.start({ ctx: c.ctx, lingerSecs: LINGER_SECS, helper: c.helper });
      timeLoaded(st);
      self.agent.url = srv.url;
      self.agent.canSee = Boolean(srv.vision);
      relimit(next);
      self.agent.model = modelWithLimits(next, self.limitsRef.current);
      self.agent.ctx = st.ctx ?? c.ctx; self.setCtx(self.agent.ctx);
      self.agent.syncRules(); // rules that follow the Context are read again before the warm-up below
      if (st.slots > 1) self.agent.slots = { main: 0, side: 1 };
      self.setStartPhase('reading');
      // The MCP tools go into what the model reads ahead, when every server has settled (agent.mjs mcpTake).
      await self.agent.mcpTake({ settled: true }).catch(() => {});
      timeWarmed(await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model: next, system: self.agent.messages[0].content, tools: self.agent.tools(), thinking: self.agent.thinking, effort: self.agent.effort, slot: self.agent.slots?.main, helper: srv.draft, onPhase: self.setStartPhase }));
      timeDone();
      const n = next.edited?.edits.length ?? 0;
      if (done) self.push({ type: 'note', text: done(self.agent.ctx), tone: 'dim' });
      else self.push({ type: 'note', text: next.edited ? `Now on ${next.name} (${n} edit${n === 1 ? '' : 's'}). Pick ${MODELS[next.edited.base].name} in /model to go back.` : `Now on ${next.name}.`, tone: 'dim' });
      if (!stillOn()) return;
    } catch (e) {
      if (!stillOn()) return;
      self.push({ type: 'note', text: done ? `Could not restart ${next.name}: ${e.message}. /effort to try again.` : `Could not switch: ${e.message}. Pick a model in /model to try again.`, tone: 'error' });
    }
    self.setStarting(false);
  };
  const openChoice = (id) => { const c = choiceMenu(id); self.setPicker({ kind: 'choice', id, ...c, index: Math.max(0, c.options.findIndex((o) => o.id === c.current)) }); };

  // ---- Several windows in one project (copies.mjs) ----
  // Makes this window's own copy and moves it there (its tests, its AGENTS.md, its commands).
  const startCopy = () => {
    self.push({ type: 'note', text: 'Making your own copy of this folder…', tone: 'dim' });
    setTimeout(async () => {
      try {
        const m = makeCopy(self.agent.cwd);
        self.agent.moveTo(m.work);
        try { await self.agent.rewind?.whenMoved(); } catch {}
        self.copyRef.current = m;
        self.setInCopy(true);
        registerWindow(m.work, { copyOf: m.original });
        self.push({ type: 'note', text: `Working in your own copy now (${m.kind === 'worktree' ? 'a git worktree' : 'a copy of the folder'} at ${tildeOf(m.work)}). When a request changes files, I ask before putting them back into ${tildeOf(m.original)}.`, tone: 'dim' });
      } catch (e) {
        self.push({ type: 'note', text: `Could not make a copy: ${e.message}. This window shares the folder.`, tone: 'warn' });
      }
    }, 30);
  };
  // After a request (or /copy): the copy's changes not yet put back, asked about once per set.
  // force: ask even about changes already answered with "Not now".
  const askCopyBack = ({ force = false } = {}) => {
    const m = self.copyRef.current;
    if (!m) return false;
    let changes;
    try { changes = copyChanges(m).changes; } catch (e) { self.push({ type: 'note', text: `Could not look at the copy: ${e.message}.`, tone: 'warn' }); return false; }
    if (!changes.length) return false;
    const key = changes.map((c) => `${c.path}:${c.to}`).join('|');
    if (!force && key === self.copyAsk.current.key) return false;
    self.copyAsk.current = { ...self.copyAsk.current, key, changes, lines: changeLines(m, changes) };
    openChoice('copy-back');
    return true;
  };
  const doPutBack = (opts2 = {}) => {
    const m = self.copyRef.current;
    if (!m) return;
    let r;
    try { r = putBack(m, opts2); } catch (e) { self.push({ type: 'note', text: `Could not put the changes back: ${e.message}. They stay in the copy.`, tone: 'error' }); return; }
    const n = r.applied.length;
    if (n) self.push({ type: 'note', text: `Put ${n === 1 ? '1 file' : `${n} files`} back into ${tildeOf(m.original)}${r.merged.length ? ` (${r.merged.length} merged with the other window's changes)` : ''}.`, tone: 'dim' });
    self.copyAsk.current.key = null;
    if (r.conflicts.length) { self.copyAsk.current.conflicts = r.conflicts; setTimeout(() => openChoice('copy-conflict'), 60); }
  };

  // ---- /remote: the model on another machine (remote-form.mjs, models/runtime/remote.mjs) ----
  // To the remote: connect first (the tunnel when it goes by SSH, the key from
  // the Keychain, the check), and only then let the model on this Mac go.
  // One that does not answer changes nothing when this Mac's model is running;
  // at the start (none running) it asks what to do (remote-down).
  // Big-model mode (models/runtime/remote.mjs): /effort's Steps, Tries and Command output start
  // from the model in use, so a switch to or from a big model on a service moves them; what /effort
  // saved still wins. A model on a service with its own settings (/model's menu) has its own rows
  // and its own Effort; the next model has its own, or the shared ones again. Called before
  // agent.model is set; says so when the mode or the settings come or go.
  const relimit = (m) => {
    const was = self.limitsRef.current;
    const fresh = readLimits({ ...loadSettings(self.opts.cwd), remote: self.settings.remote }, m);
    // Who decides moves too: a big model on a service decides for itself (BIG_HARNESS), unless /effort saved one.
    const next = { ...was, ...Object.fromEntries(OWN_ROWS.map((id) => [id, fresh[id]])), way: fresh.way };
    const name = m.remote?.model ?? m.name;
    const own = m.remote ? ownOf(self.settings, m.remote.model) : null;
    ownLevel(m, own);
    const moved = limitChanges(was, next);
    if (!moved.length) return;
    self.limitsRef.current = next;
    applyLimits(self.agent, next);
    const list = moved.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' · ');
    // Big-model mode's note is one of the start's: a line, the new values only (4 Oct 2026, the owner's pick).
    const brief = moved.map((c) => BIG_WORDS[c.id]?.(c.to) ?? `${c.label.toLowerCase()} ${c.to}`).join(', ');
    self.push({ type: 'note', text: m.harness
      ? `Big-model mode for ${name}${own?.limits ? ' (its own settings)' : ''}: ${brief}, ${m.harness.read.whole}-line reads · /effort`
      : own?.limits ? `${name}’s own settings: ${list}. /effort changes them.`
        : self.agent.model?.harness ? `Big-model mode off: ${list}.` : `The shared settings again: ${list}.`, tone: 'dim' });
  };
  // Keep loaded (/effort's Model rows): how long the service keeps the model after each request
  // (open: OPEN_KEEP, asked again while this window is open, so it goes once it closes), carried by
  // every request to it.
  const applyKeep = (values = self.limitsRef.current) => {
    const conn = self.remoteRef.current.conn;
    if (!conn?.info?.ollama) return;
    setEndpoint(conn.url, { ...endpointOf(conn.url), keepAlive: typeof values.keepLoaded === 'number' ? values.keepLoaded : OPEN_KEEP });
  };
  // A model's Effort as it comes into use, from its next reply. A model on /remote: its own (/model's
  // menu, /effort), else its default, thinking on unless it cannot think (remoteModel; the owner's pick,
  // 3 Oct 2026); --think or --no-think at the start win over the default. Back on this Mac: the shared
  // one again. Nothing is saved here: only a level you pick is.
  const ownLevel = (m, own) => {
    const levels = m.thinkingLevels ?? [];
    let lv = own?.level && levels.length > 1 ? levels.find((l) => l.id === own.level) : null;
    if (!lv && m.remote && self.opts.thinking === undefined) lv = thinkingLevel(m, m.thinkingDefault ?? true, m.thinkingEffort);
    if (!lv && !m.remote && self.agent.model?.remote) { const s = loadSettings(self.opts.cwd); lv = thinkingLevel(m, self.opts.thinking ?? s.thinking ?? m.thinkingDefault ?? true, s.effort); }
    // (Its id is not enough: a model that cannot think has one level, the same id with thinking on or off.)
    if (lv && (lv.id !== thinkingLevel(m, self.agent.thinking, self.agent.effort).id || Boolean(lv.effort) !== Boolean(self.agent.thinking))) self.setThinking(Boolean(lv.effort), lv.effort ? lv.id : undefined, { target: null });
  };
  // Your pick of Effort for a model on /remote, kept as its own (with its own rows, if it has them).
  const saveOwnLevel = (m, lv) => {
    const name = m?.remote?.model;
    if (!name || (m.thinkingLevels ?? []).length < 2) return;
    setOwn(name, { ...(ownOf(self.settings, name) ?? {}), level: lv.id });
  };
  // A model's own settings on the service (null: none, it follows the shared ones), kept by model
  // in the service's set-up ("tuned"), as its Context is ("contexts", setServiceCtx).
  const setOwn = (name, own) => {
    const src = sourceOf(self.settings.remote);
    const put = (p) => { const tuned = { ...(p?.tuned ?? {}) }; if (own) tuned[name] = own; else delete tuned[name]; return { ...p, tuned }; };
    const saved = saveSettings({ remote: put(self.settings.remote), ...(self.settings.remotes?.[src] ? { remotes: { ...self.settings.remotes, [src]: put(self.settings.remotes[src]) } } : {}) });
    self.settings.remote = saved.remote;
    self.settings.remotes = saved.remotes;
  };
  return { pickLevels, pickLevel, waitForBattle, waitForOthers, modelKey, timeLoad, timeLoaded, timeWarmed, timeDone, listOtherWindows, pushFn, fold, flashFn, setModeFn, openHub, switchModel, openChoice, startCopy, askCopyBack, doPutBack, relimit, applyKeep, saveOwnLevel, setOwn };
}
