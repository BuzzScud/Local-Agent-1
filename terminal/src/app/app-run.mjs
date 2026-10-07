// The window's work (App.jsx): sending a message, loading and stopping the model, resuming, quitting,
// updating, a side question, a shell line, the doctor, /agents and /loops.
// The functions are the App's own, moved here word for word: the App's names (and App.jsx's) are read through
// self, which App makes at each render, so a function sees the values of the render that made it.
import { existsSync, statfsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SESSION_MARK } from '../agent/prompt.mjs';
import { terminalApp } from '../tools/screen.mjs';
import { battleHold, runningServer, ModelServer, freeWithHandBack, stopServer, chooseContext, availableBytes, scanServers, contextCheck, hasDraft, searchBytes, LINGER_SECS, warmUp, stopIdleServers, remoteLabel, thinkingLevel, serverBinOf, modelPath, onDiskBytes, engineOf, visionPath, needBytes, DEFAULT_REMOTE, keyStore, remoteRisk } from '../../../models/index.mjs';
import { windowSpend } from '../agent/spend.mjs';
import { updateWindow } from './copies.mjs';
import { kindWord } from './remote-form.mjs';
import { runCommand } from '../tools/run.mjs';
import { listSessions } from './store.mjs';
import { newUi as newLoopsUi, openSetup as openLoopsSetup, showReply as loopsReply, handleKey as loopsHandleKey } from './loops-board.mjs';
import { saveTrust } from './trust.mjs';
import { reloadMcp } from './mcp-start.mjs';
import { mcpLogFile } from './mcp-store.mjs';
import { pictureFor } from '../tools/mcp.mjs';
import { resourceMentions, resourceParts } from '../agent/mcp.mjs';
import { countTries } from './live.mjs';
import { canRestart, bringIn } from './update.mjs';
import { askAside } from '../agent/btw.mjs';
import { modelWithLimits, searchModels } from './limits.mjs';
import { AgentsRun } from '../agent/agents-run.mjs';
import { agentDriver } from '../agent/agents-driver.mjs';
import { demoDriver } from '../agent/agents-demo.mjs';
import { canResize, growTo, resizeSeq } from './agents-window.mjs';
import { expandMentions, pick, PLACEHOLDERS, VERBS, IDLE, END_WORDS, exited, letGo, short, home } from './app-common.mjs';

export function runPart(self) {
  // fromServer: the message is a prompt of one of your MCP servers (/server:prompt), its own words.
  const sendPromptFn = (value, shown = value, { visionAsked = false, mcpRead = null, fromServer = null } = {}) => {
    // The model is off: the message waits (the Queued line) and goes once /start has loaded it.
    if (self.modelOffNow()) {
      const had = self.queuedRef.current;
      self.queuedRef.current = value; self.setQueued(value);
      if (!had) self.push({ type: 'note', text: 'The model is off. /start or ctrl+t loads it (your message waits and goes out after).', tone: 'dim' });
      return;
    }
    // @server:uri: a resource of one of your MCP servers, read first (you named it, so it is not
    // asked about), then attached like a file, marked as data.
    const mentions = self.mcpHub && !mcpRead ? resourceMentions(value, self.mcpHub.offers().resources) : [];
    if (mentions.length) {
      Promise.all(mentions.map((m) => self.mcpHub.readResource(m.server, m.uri).then((r) => ({ ...m, ...resourceParts(m.server, m.uri, r, { max: self.agent.maxResultChars }) }), (e) => ({ ...m, error: e.message }))))
        .then((parts) => self.sendPrompt(value, shown, { visionAsked, mcpRead: parts, fromServer }));
      return;
    }
    const expanded = expandMentions(value, self.cwd, self.agent.maxResultChars, self.pastedRef.current.files);
    const { attached, images } = expanded;
    let { text } = expanded;
    for (const p of mcpRead ?? []) {
      if (p.error) { attached.push({ path: p.token, label: `not read: ${p.error}` }); continue; }
      attached.push({ path: p.token, label: p.label });
      text += `\n\n${p.text}`;
      p.pictures.forEach((pic, i) => { const img = pictureFor(pic, `${p.token}${p.pictures.length > 1 ? ` (${i + 1})` : ''}`); if (img) images.push(img); });
    }
    // A picture, and a model not looking at pictures yet: its vision is turned on first (the
    // message waits for it), or, where it cannot be, the message goes with a line saying so.
    if (images.length && !self.agent.canSee && !visionAsked && self.remoteFnRef.current.needVision?.(value, shown)) return;
    // Not seen, unless a Pictures helper describes it (agent.work, /subagents).
    const blind = images.length && !self.agent.canSee && !self.agent.helperUse?.('pictures');
    self.holdRef.current = false; // your first message prints the start page above it
    self.push({ type: 'user', text: shown, attached });
    let content = blind ? `${text}\n\n(The user attached ${images.length === 1 ? 'a picture' : `${images.length} pictures`} (${images.map((i) => i.path).join(', ')}), but this model is not looking at pictures now.)` : text;
    if (self.pendingContext.current.length) { content = `${self.pendingContext.current.join('\n\n')}\n\n${content}`; self.pendingContext.current = []; }
    if (self.agent.mode === 'plan') content += '\n\n[Plan mode is on: only read and search. Do not change files or run commands that change anything. Reply with a short numbered plan, then stop.]';
    if (!self.sessionRef.current.title) self.sessionRef.current.title = shown.slice(0, 80);
    const ac = new AbortController();
    self.abortRef.current = ac;
    self.setPlaceholder(pick(PLACEHOLDERS));
    self.autoRef.current.cancel(); // a save in the background steps aside
    self.agent.send(content, { signal: ac.signal, shown, images: blind ? undefined : images, fromServer });
  };

  // Agent events → screen.
  const agentEvents = () => {
    const on = (name, fn) => { self.agent.on(name, fn); return () => self.agent.off(name, fn); };
    // add: the tokens this event brought (one a streamed piece; a tool call's whole size when it comes in
    // one piece, as an Ollama service sends it: 4 Oct 2026, "↓ 4.1k tokens this session" for 52.7k written).
    const stream = (l, patch, add = 1) => {
      const t = Date.now();
      const first = l.firstTokenAt ?? t;
      const n = (l.streamTokens ?? 0) + add;
      const secs = (t - first) / 1000;
      return { ...l, ...patch, waiting: false, tokens: (l.tokens ?? 0) + add, lastTokenAt: t, firstTokenAt: first, streamTokens: n, liveTps: secs > 0.7 ? n / secs : l.liveTps };
    };
    const addPre = (patch) => { self.pre.current = { ...(self.pre.current ?? {}), ...patch }; self.setLive((l) => ({ ...l, pre: self.pre.current })); };
    const offs = [
      // A busy service (busy.mjs): the spinner counts down to the next try.
      on('busy', ({ until }) => self.setLive((l) => (l.phase ? { ...l, busyUntil: until } : l))),
      on('turn-start', () => { try { const u = [...self.agent.messages].reverse().find((x) => x.role === 'user'); updateWindow({ task: String(typeof u?.content === 'string' ? u.content : u?.content?.find?.((c) => c.type === 'text')?.text ?? '').replace(/\s+/g, ' ').slice(0, 80), at: new Date().toISOString() }); } catch {} self.turnSpend.current = windowSpend().usd; self.railOn.current = true; self.pre.current = null; self.lastCheck.current = null; const [verb, past] = pick(VERBS); self.setLive({ phase: 'working', turnStart: Date.now(), verb, past, tokens: 0, waiting: true, rail: true }); }),
      // A new reply: its step clock starts, and its room and thinking cap feed the meters.
      on('waiting', ({ room, thinkCap, whole } = {}) => self.setLive((l) => ({ ...l, waiting: true, thinking: null, text: null, writing: null, firstTokenAt: null, streamTokens: 0, liveTps: null, stepStart: Date.now(), room, thinkCap, whole, task: null }))),
      // A reply that will not run as it was (cut off, repeating itself): its live lines go.
      on('reply-dropped', () => self.setLive((l) => ({ ...l, thinking: null, text: null, writing: null }))),
      // The app working between replies (notes, a summary): the working line says so.
      on('busy', ({ task }) => self.setLive((l) => ({ ...l, thinking: null, text: null, writing: null, waiting: false, liveTps: null, stepStart: Date.now(), task }))),
      on('reasoning', ({ all }) => self.setLive((l) => stream(l, { thinking: { text: all, startedAt: l.thinking?.startedAt ?? Date.now(), tokens: (l.thinking?.tokens ?? 0) + 1 } }))),
      on('text', ({ all }) => self.setLive((l) => stream(l, { text: all }))),
      on('tool-writing', ({ name, args, tokens }) => self.setLive((l) => stream(l, { writing: { name, args, tokens } }, Math.max(1, (tokens ?? 0) - (l.writing?.name === name ? l.writing.tokens ?? 0 : 0))))),
      on('assistant', ({ text, reasoning, thinkSecs }) => {
        const add = [];
        if (reasoning?.trim()) {
          add.push({ type: 'thinking', text: reasoning.trim(), secs: thinkSecs || 0.1, tokens: Math.ceil(reasoning.length / 3.6) });
          self.fold({ title: `Thinking (${Math.round(thinkSecs)}s)`, text: reasoning.trim() });
        }
        if (text?.trim()) add.push({ type: 'text', text: text.trim() });
        if (add.length) self.push(...add);
        self.setLive((l) => ({ ...l, thinking: null, text: null, writing: null }));
      }),
      on('tool-running', ({ label, arg }) => self.setLive((l) => ({ ...l, running: { label, arg }, writing: null }))),
      on('tool', (ev) => {
        self.push({ type: 'tool', label: ev.label, arg: ev.arg, view: ev.view, error: ev.error });
        const v = ev.view ?? {};
        if (v.kind === 'bash' || v.kind === 'job') self.fold({ title: `${v.kind === 'job' && ev.label === 'Jobs' ? 'Jobs' : 'Bash'}(${ev.arg})`, text: v.lines.join('\n') });
        else if (v.content) self.fold({ title: `${ev.label}(${ev.arg})`, text: v.content });
        self.setLive((l) => ({ ...l, running: null, writing: null }));
      }),
      // During a turn the design cards join the line of what came along; a layout check is a step.
      on('note', ({ text, tone, design, check, fold: small }) => {
        if (design && self.railOn.current) { addPre({ design }); return; }
        // Only the layout check's result counts for the end line's "layout problems left".
        if (check && !check.title) self.lastCheck.current = check;
        self.push({ type: 'note', text, tone, ...(check ? { check } : {}), ...(small ? { fold: true } : {}) });
      }),
      // What came along with the request (memory, Claude's notes): one line; ctrl+o lists it.
      on('context', (c) => { self.fold({ context: c }); if (self.railOn.current) addPre({ contexts: [...(self.pre.current?.contexts ?? []), c] }); else self.push({ type: 'context', ...c }); }),
      // Which path the request took, under the request.
      on('sorted', ({ text }) => { if (self.railOn.current) addPre({ sorted: text }); else self.push({ type: 'sorted', text }); }),
      // Saying yes to "Work in <project>?" counts as trusting that folder.
      on('cwd', ({ cwd: dir }) => {
        self.setCwd(dir);
        try { saveTrust(dir); } catch {}
        // Its MCP servers are that folder's from now on (yours stay; a project's own wait for your yes).
        if (self.mcpHub) { try { const r = reloadMcp(self.mcpHub, dir); self.agent.mcpStale = true; if (r.project?.servers.length && r.project.answer === null) self.push({ type: 'note', text: `This project brings its own MCP server${r.project.servers.length === 1 ? '' : 's'} (${r.project.servers.map((s) => s.name).join(', ')}): not started. /mcp to look at ${r.project.servers.length === 1 ? 'it' : 'them'}.`, tone: 'dim' }); } catch { /* the servers stay as they were */ } }
      }),
      // Focused paths: the live try counter, its finished line, the current step.
      on('tries', (t) => self.setLive((l) => countTries(l, t))),
      on('tries-done', (t) => { self.push({ type: 'tries', ...t }); self.setLive((l) => ({ ...l, tries: null })); }),
      on('flow-step', (st) => self.setLive((l) => ({ ...l, flowStep: st }))),
      on('stats', (st) => self.setStats(st)),
      on('mode', (m) => self.setModeState(m)),
      on('screen-setup', () => self.push({ type: 'note', text: `The model tried to look at the screen, but macOS has not let ${terminalApp()} take pictures of it yet: type /screen setup (once).`, tone: 'warn' })),
      on('settled', () => self.autoRef.current.schedule()),
      on('compacted', ({ summary, inPlace, n }) => { self.push({ type: 'note', text: inPlace ? `Picked up from its notes${n ? ` (${n})` : ''}` : `Summarized${n ? ` (${n})` : ''}, carrying on`, tone: 'dim' }); self.fold({ title: 'Summary', text: summary }); }),
      // A background job ended with nothing running: told to the model once a queued message had its turn.
      on('jobs-waiting', () => setTimeout(() => self.jobWakeRef.current?.(), 150)),
      on('turn-end', ({ reason, secs, steps, reads, thinkTokens, tokens, made }) => {
        // What it made or changed, under the answer (rail.jsx MadeNode).
        if (made?.length && reason !== 'interrupted') self.push({ type: 'made', files: made });
        const past = self.S.current.live?.past ?? 'Worked';
        // The service's count when it gave one, else what streamed (a greeting's turn has none).
        self.sessionTokens.current += tokens || self.S.current.live?.tokens || 0;
        const session = self.sessionTokens.current;
        self.setLive(IDLE);
        self.setPerm(null);
        self.answerRef.current = null;
        self.setAnswerWait(false);
        // The turn's end line closes the rail: how it ended, its time and counts ("╰─ ⠿ Worked for
        // 41s · 5 steps · done 12:58 PM"), and the layout problems its last check left.
        const left = self.lastCheck.current?.problems?.length ?? 0;
        const at = Date.now();
        // What this request cost on a paid service (spend.mjs), for its end line.
        const spent = windowSpend().usd - (self.turnSpend.current ?? 0);
        const usd = spent > 0 ? spent : undefined;
        if (reason === 'interrupted') { self.push({ type: 'done', reason, text: 'Interrupted · What should Agentic Coder do instead?', secs, at, usd, session }); self.setPlaceholder('Tell Agentic Coder what to do instead'); }
        else if (reason === 'done') self.push({ type: 'done', reason, past, secs, at, steps, reads, thinkTokens, left, usd, session });
        else self.push({ type: 'done', reason, text: END_WORDS[reason] ?? `Stopped (${reason})`, secs, at, left, usd, session });
        self.railOn.current = false;
        self.pre.current = null;
        // In its own copy: changed files are offered back to the real folder (copies.mjs).
        if (self.copyRef.current && !self.queuedRef.current) setTimeout(() => self.askCopyBack(), 60);
        if (reason === 'declined') self.setPlaceholder('Tell Agentic Coder what to do instead');
        self.saveNow();
        const q = self.queuedRef.current;
        if (q) { self.queuedRef.current = null; self.setQueued(null); }
        // A model that took one message with a picture hands back to yours first.
        if (self.switchBackRef.current) setTimeout(async () => { await self.remoteFnRef.current.switchBack?.(); if (q) self.sendPrompt(q); }, 50);
        else if (q) setTimeout(() => self.sendPrompt(q), 50);
      }),
    ];
    return () => offs.forEach((f) => f());
  };
  const arenaTick = () => {
    if (self.opts.url) return undefined;
    const tick = setInterval(async () => {
      // On a remote, nothing here holds the memory an Arena run needs.
      if (self.remoteRef.current.on) return;
      const b = self.battleRef.current;
      const h = battleHold();
      if (b.released) {
        if (h) { self.setBattle(h); return; }
        if (b.reloading) return;
        b.reloading = true;
        self.setBattle(null);
        await b.switchModel(b.model, () => `The ${b.what ?? 'battle'} is over: ${b.model.name} is loaded again.`);
        b.released = false; b.reloading = false;
        // The model is back (switchModel has finished): a message typed meanwhile goes now.
        const q = self.queuedRef.current;
        if (q && self.serverRef.current?.port) { self.queuedRef.current = null; self.setQueued(null); setTimeout(() => b.sendPrompt(q), 50); }
        return;
      }
      if (!h || self.S.current.starting || self.S.current.live !== IDLE || !self.serverRef.current?.port) return;
      b.released = true;
      b.what = /^a test/.test(h) ? 'test run' : 'battle';
      self.setBattle(h);
      self.setStarting(true); self.setStartPhase('waiting');
      await self.serverRef.current.stop({ keep: false }).catch(() => {});
      self.push({ type: 'note', text: `${b.model.name} is unloaded for now: ${h}. It loads again by itself when the ${b.what} is over; a message you send meanwhile waits for it.`, tone: 'dim' });
    }, 3000);
    return () => clearInterval(tick);
  };
  const loadModel = async () => {
    const my = ++self.loadRef.current;
    const stillOn = () => self.aliveRef.current && self.loadRef.current === my;
    self.wantRef.current = true;
    self.setModelOff(false);
    self.setStarting(true); self.setStartPhase('loading'); self.setStartedAt(Date.now());
    self.timing.current = null;
    await self.waitForBattle(stillOn);
    if (!stillOn()) return;
    // --ctx wins; then the context /effort saved; then what fits (chooseContext).
    let size = self.opts.ctx ?? (self.limitsRef.current.context || undefined);
    const picked = !self.opts.ctx && self.limitsRef.current.context;
    // A model still loaded from an earlier start (or another window) is used
    // as it is; otherwise the memory size is chosen from what is free now.
    let running = runningServer(self.model);
    // Kept loaded at another size than the one you picked, with no other
    // window on it: it restarts at yours (before, it kept the old size until coding stop).
    let freeBefore = 0; // what is free with that copy's memory back (freeWithHandBack)
    if (picked && running?.linger && running.ctx !== picked && !(running.users ?? []).some((p) => p !== process.pid)) {
      freeBefore = freeWithHandBack(self.model, running.ctx, { draft: Boolean(running.draft) });
      stopServer(running);
      await exited(running.pid);
      running = null;
    }
    if (!size && running) size = running.ctx;
    // Another copy loaded outside the app windows: wait for it (esc starts anyway).
    // What the copies it waited for give back counts as free, as a restart's does.
    if (!running) freeBefore = Math.max(freeBefore, await self.waitForOthers(self.model, stillOn));
    if (!stillOn()) return;
    let helper;
    if (!size) {
      const c = chooseContext(self.model, { effort: self.agent.thinking ? self.agent.effort : undefined, available: Math.max(freeBefore, availableBytes()) });
      size = c.ctx;
      helper = c.helper; // false: High keeps its memory, the speed helper stays off
      self.memoryNote.current = c.reason ?? null; // shown by /stats, not on the start screen
    }
    // A context you picked is used as asked, checked against what is free now
    // (before loading) with the search models still to load: said when it
    // does not fit, and shown by /stats.
    if (picked && !running) {
      const loaded = new Set(scanServers().map((e) => e.model));
      const chk = contextCheck(self.model, size, { draft: hasDraft(self.model), available: Math.max(freeBefore, availableBytes()), search: searchBytes(searchModels(self.agent, self.limitsRef.current), (m) => loaded.has(m.file)) });
      self.memoryNote.current = chk.note;
      if (!chk.fits) self.push({ type: 'note', text: chk.note, tone: 'warn' });
    }
    self.agent.ctx = size;
    self.setCtx(size);
    self.agent.syncRules(); // rules that follow the Context, settled before the model reads them
    self.timeLoad(self.model, !running);
    const srv = new ModelServer(modelWithLimits(self.model, self.limitsRef.current));
    self.serverRef.current = srv;
    srv.on('crash', ({ code, signal }) => {
      if (srv.restarts >= 3) { self.push({ type: 'note', text: `The model server keeps stopping (code ${code ?? signal}). See ~/.agentic-coder/logs/server.log, then restart Agentic Coder.`, tone: 'error' }); return; }
      self.push({ type: 'note', text: `The model server stopped (code ${code ?? signal}); restarting it.`, tone: 'warn' });
      self.restartRef.current = srv.restart().then(() => { self.push({ type: 'note', text: 'The model server is back.', tone: 'dim' }); }).catch((e) => self.push({ type: 'note', text: e.message, tone: 'error' })).finally(() => { self.restartRef.current = null; });
    });
    let st;
    try {
      st = await srv.start({ ctx: size, lingerSecs: LINGER_SECS, helper });
      if (!stillOn()) return;
      self.timeLoaded(st);
      const want = !self.opts.ctx && self.limitsRef.current.context;
      if (want && st.shared && st.ctx !== want) self.push({ type: 'note', text: `${self.model.name} was already loaded at ${Math.round(st.ctx / 1024)}k, so it runs at that. Your /effort context (${Math.round(want / 1024)}k) applies after /stop and /start, or save it again in /effort.`, tone: 'warn' });
      if (st.shared) {
        self.agent.ctx = st.ctx;
        self.setCtx(st.ctx);
        self.agent.syncRules();
        if (!st.idle) self.push({ type: 'note', text: `Sharing the model with another Agentic Coder window (port ${st.port}); replies wait their turn.`, tone: 'dim' });
      }
    } catch (e) {
      if (stillOn()) {
        // Nothing loaded: the window is as it was before /start.
        self.serverRef.current = null; self.wantRef.current = false;
        self.setStarting(false); self.setModelOff(true);
        self.push({ type: 'note', text: `Could not start the model: ${e.message}. /start tries again.`, tone: 'error' });
      }
      return;
    }
    self.agent.url = srv.url;
    self.agent.canSee = Boolean(srv.vision);
    if (st.slots > 1) self.agent.slots = { main: 0, side: 1 };
    // Read the instructions and tools before the first message (restored from
    // disk after the first time), so the first reply starts fast. A server
    // shared with another window is already warm.
    self.setStartPhase('reading');
    // A model kept loaded from an earlier start is ours now: warm it for
    // this folder too (instant when nothing changed). Another window's is left alone.
    if (!st.shared || st.idle) try {
      self.agent.warmed = true; // this window's own reading of the instructions: a restart from notes restores it
      // The MCP tools go into what the model reads ahead, when every server has settled (agent.mjs mcpTake).
      await self.agent.mcpTake({ settled: true }).catch(() => {});
      self.timeWarmed(await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model: self.model, system: self.agent.messages[0].content, tools: self.agent.tools(), thinking: self.agent.thinking, effort: self.agent.effort, slot: self.agent.slots?.main, helper: srv.draft, onPhase: (p) => { if (stillOn()) self.setStartPhase(p); } }));
    } catch {}
    if (!stillOn()) return;
    self.timeDone();
    self.setStarting(false);
    const first = !self.loadedOnce.current;
    self.loadedOnce.current = true;
    // A save that waited for the model (the window closed while it was off) runs on it now.
    self.autoRef.current.runWaiting();
    const q = self.queuedRef.current;
    if (q) { self.queuedRef.current = null; self.setQueued(null); self.sendPrompt(q); }
    // The first load here: what the last window's second look would save is asked about (at
    // the window's start already, when the model was off then); then (first use here) what is
    // already written is read, in the background.
    else if (first) setTimeout(() => { (self.askedAtOpen.current ? self.autoRef.current.seed() : self.autoRef.current.atStart()).catch(() => {}); }, 3000).unref?.();
    if (!q) setTimeout(() => self.jobWakeRef.current?.(), 50); // a background job that ended while the model was off
  };

  // The window opens: the model loads now only when it should (wantRef); otherwise it is off until /start.
  const windowOpens = () => {
    self.aliveRef.current = true;
    (async () => {
      if (self.opts.url) {
        self.setStarting(false);
        // A llama.cpp server given by hand says whether it has its vision add-on.
        try { const p = await (await fetch(`${self.opts.url.replace(/\/+$/, '')}/props`, { signal: AbortSignal.timeout(3000) })).json(); self.agent.canSee = Boolean(p?.modalities?.vision); } catch { self.agent.canSee = false; }
        // A server given by hand: what the last window's second look would
        // save is still asked about (no model needed); the first-use reading waits for a start of its own.
        setTimeout(() => { if (self.aliveRef.current) self.autoRef.current.askPending().catch(() => {}); }, 3000).unref?.();
        return;
      }
      // /remote on: the model on another machine; nothing loads here.
      if (self.remoteAtStart) { await self.remoteFnRef.current.useRemote(self.settings.remote, { atStart: true }); return; }
      if (self.wantRef.current) { await self.loadFnRef.current(); return; }
      // The model is off: what the last window's second look would save is still asked about (no model needed).
      self.askedAtOpen.current = true;
      setTimeout(() => { if (self.aliveRef.current) self.autoRef.current.askPending().catch(() => {}); }, 3000).unref?.();
    })();
    // The window is gone (quit, a closed Terminal window): its model goes too, unless another window still uses it.
    return () => { self.aliveRef.current = false; letGo(self.serverRef.current); self.serverRef.current = null; self.weightsRef.current?.stop(); self.weightsRef.current = null; };
  };

  // /stop: the model is unloaded and its memory given back. A reply under way stops first; a load
  // under way is called off. Another window on the same copy keeps it: this window only lets go.
  const stopModel = async () => {
    if (self.opts.url) { self.push({ type: 'note', text: `This window uses the model server at ${self.opts.url} (--url). Agentic Coder did not start it, so /stop leaves it running.`, tone: 'dim' }); return; }
    if (self.remoteRef.current.on) { self.push({ type: 'note', text: 'On the remote model: nothing is loaded on this Mac. /remote off goes back to the model on this Mac.', tone: 'dim' }); return; }
    const srv = self.serverRef.current;
    const b = self.battleRef.current;
    const wasOn = self.wantRef.current || Boolean(srv?.port);
    if (!wasOn) {
      // Nothing loaded here; a copy an earlier window left loaded is freed (as `coding stop` does).
      const r = stopIdleServers();
      self.push({ type: 'note', text: r.stopped.length ? `The model was off here; freed the copy an earlier window had left loaded (port ${r.stopped.map((e) => e.port).join(', ')}).` : 'The model is already off. /start loads it.', tone: 'dim' });
      return;
    }
    // A reply under way stops first (as esc does), and the memory's save in the background too.
    if (self.S.current.live !== IDLE || self.agent.busy) {
      self.interrupt();
      for (const t0 = Date.now(); (self.S.current.live !== IDLE || self.agent.busy) && Date.now() - t0 < 10_000;) await new Promise((r) => setTimeout(r, 100));
    }
    self.autoRef.current.cancel();
    self.loadRef.current++; // a load still under way ends quietly
    self.wantRef.current = false;
    b.released = false; b.reloading = false;
    self.serverRef.current = null;
    self.agent.url = 'http://127.0.0.1:0';
    self.agent.slots = null;
    self.agent.warmed = false;
    self.setBattle(null); self.setWaiting(null); self.waitRef.current = null;
    self.setStarting(false); self.setStartPhase('loading');
    self.setModelOff(true);
    self.setRamGb(null);
    const before = availableBytes();
    const { others, done } = letGo(srv);
    // The small search models (the memory's and the code search's) go too; they load again at their next use.
    for (const x of [self.agent.embedder, self.agent.reranker]) {
      if (!x?.server) continue;
      letGo(x.server).done.catch(() => {});
      x.server = null;
    }
    await done.catch(() => {});
    const freed = Math.max(0, availableBytes() - before);
    self.push({ type: 'note', text: others
      ? `This window let go of ${self.model.name}. Another Agentic Coder window still uses it, so it stays loaded until that one quits or types /stop.`
      : `${self.model.name} is unloaded${freed > 5e8 ? `: ${(freed / 1e9).toFixed(1)} GB back to the Mac` : ''}. /start loads it again.`, tone: 'dim' });
  };
  // /start: the model on this Mac loads (the window opens with it off, unless /autostart is on).
  const startModel = () => {
    if (self.opts.url) { self.push({ type: 'note', text: `This window uses the model server at ${self.opts.url} (--url); there is nothing to load.`, tone: 'dim' }); return; }
    if (self.remoteRef.current.on) { self.push({ type: 'note', text: `On the remote model (${remoteLabel(self.settings.remote)}): nothing loads on this Mac. /remote off goes back to this Mac.`, tone: 'dim' }); return; }
    if (self.S.current.starting) { self.push({ type: 'note', text: `${self.model.name} is already loading.`, tone: 'dim' }); return; }
    if (self.serverRef.current?.port) { self.push({ type: 'note', text: `${self.model.name} is already loaded (port ${self.serverRef.current.port}). /stop unloads it.`, tone: 'dim' }); return; }
    self.loadFnRef.current();
  };
  const toggleModel = (how = 'ctrl+t') => {
    if (self.opts.url) { self.flash('This window uses a model server given with --url: nothing here to start or stop', 3000); return; }
    // On a remote nothing loads on this Mac: ctrl+t, like a click, opens the model list.
    if (self.remoteRef.current.on) { self.openModelPicker(); return; }
    if (!self.wantRef.current) { self.startFnRef.current(); return; }
    if ((self.S.current.live !== IDLE || self.agent.busy) && Date.now() - self.toggleArmed.current > 2000) {
      self.toggleArmed.current = Date.now();
      self.flash(`${how === 'click' ? 'Click it' : 'Press ctrl+t'} again to stop the reply and unload ${self.model.name}`, 2000);
      return;
    }
    self.toggleArmed.current = 0;
    self.stopFnRef.current();
  };

  // Continue or resume a saved session given on the command line.
  const resumeAtStart = () => {
    const id = self.opts.resumeId ?? (self.opts.continueLast ? listSessions(self.cwd)[0]?.id : null);
    if (id) self.resumeSession(id);
    else if (self.opts.continueLast) self.push({ type: 'note', text: 'No earlier conversation in this folder yet.', tone: 'dim' });
    // Your SessionStart hooks (a resume runs them in resumeSession); a project's own hooks wait for your yes.
    const started = id ? Promise.resolve() : self.agent.startSession('startup').catch(() => {});
    const theirs = self.agent.userHooks?.project;
    if (theirs?.list.length && theirs.answer === null) self.push({ type: 'note', text: `This project brings its own hooks (.agentic/hooks.json, ${theirs.list.length}): they do not run until you say yes in /hooks.`, tone: 'warn' });
    if (self.agent.userHooks?.error) self.push({ type: 'note', text: `Your hooks: ${self.agent.userHooks.error}. /hooks shows them.`, tone: 'warn' });
    const go = () => { if (self.starting) { self.queuedRef.current = self.opts.prompt; self.setQueued(self.opts.prompt); } else self.sendPrompt(self.opts.prompt); };
    if (self.opts.prompt) { if (!id && self.agent.userHooks?.has('SessionStart')) started.then(go); else go(); }
  };

  const quitFn = async () => {
    self.setLeaving(true);
    self.loopsRef.current?.close();
    self.agent.jobs?.stopAll(); // the background commands end with the window
    await self.agent.endSession('quit').catch(() => {}); // your SessionEnd hooks, 5 s at most
    self.abortRef.current?.abort();
    self.btwRef.current?.ac.abort();
    self.saveNow();
    // What the memory has not saved yet is handed to a process of its own,
    // which needs the model a little longer and stops it when it is done.
    // With the model off, the save waits for the next /start here instead: nothing loads after you quit.
    const off = !self.opts.url && !self.remoteRef.current.on && !self.serverRef.current?.port;
    const handed = self.autoRef.current.leave({ stopAfter: true, modelOff: off, given: Boolean(self.opts.url) });
    // Otherwise the model goes now (the user's pick, 30 Sep 2026: not kept loaded after you
    // quit), unless another window still uses it; the small search models go with it.
    const srv = self.serverRef.current;
    self.serverRef.current = null;
    if (handed) {
      await self.agent.embedder?.stop({ keep: true }).catch(() => {});
      await self.agent.reranker?.stop({ keep: true }).catch(() => {});
      await srv?.stop({ keep: true });
    } else {
      const small = [self.agent.embedder?.server, self.agent.reranker?.server].map((x) => letGo(x).done.catch(() => {}));
      await Promise.all([letGo(srv).done.catch(() => {}), ...small]);
    }
    self.remoteRef.current.conn?.stop();
    // Your MCP servers stop with the session (a program is ended, a connection closed).
    await Promise.race([self.mcpHub?.stopAll().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    self.exit();
  };

  // /update: Agentic Coder starts again on the new code (the launcher builds it) and
  // picks this conversation back up; the model stays loaded in between. An
  // update only on GitHub is brought into the repo's main first, if git can
  // do that without touching anything uncommitted.
  const updateNowFn = async () => {
    const w = self.updateRef.current;
    if (!w?.repo) { self.push({ type: 'note', text: 'Updates are looked for when Agentic Coder runs from its repo (the coding command); AGENTIC_NO_UPDATE=1 turns them off.', tone: 'dim' }); return; }
    if (self.S.current.live.phase === 'working' || self.S.current.perm) { self.push({ type: 'note', text: 'Agentic Coder is busy. Let it finish (or press esc), then /update.', tone: 'warn' }); return; }
    const u = await w.check();
    if (!u) { self.push({ type: 'note', text: 'Agentic Coder is up to date: no new code on main since this window started.', tone: 'dim' }); return; }
    if (u.kind === 'pull') {
      const r = await bringIn(w.repo);
      if (!r.ok) { self.push({ type: 'note', text: `Could not bring the update in: ${r.why}. Pull it into the repo yourself, then /update.`, tone: 'warn' }); return; }
    }
    if (!canRestart()) { self.push({ type: 'note', text: `The update is ${u.kind === 'pull' ? 'in the repo now' : 'on main'}. This window was not started by the coding command, so quit and start it again to use it.`, tone: 'warn' }); return; }
    self.push({ type: 'note', text: '↻ Restarting on the update…', tone: 'dim' });
    self.abortRef.current?.abort();
    self.saveNow();
    const s = self.sessionRef.current;
    const level = thinkingLevel(self.model, self.thinking, self.effort).id;
    self.onRestart?.([
      ...(s.title ? ['--resume', s.id] : []),
      ...(self.opts.url ? ['--url', self.opts.url] : []),
      ...(self.opts.flows === false ? ['--no-flows'] : []),
      ...(self.opts.way ? ['--way', self.opts.way] : []),
      ...(self.opts.ctx ? ['--ctx', String(self.opts.ctx)] : []),
      ...(['low', 'medium', 'high'].includes(level) ? ['--effort', level] : []),
      // The model loaded now stays loaded across the restart, so the new version joins it at once.
      ...(!self.opts.url && !self.remoteRef.current.on && self.serverRef.current?.port ? ['--start'] : []),
    ]);
    self.setLeaving(true);
    // Kept loaded for the new version, which joins it at its start (--start above).
    const srv = self.serverRef.current;
    self.serverRef.current = null;
    await srv?.stop({ keep: true });
    self.exit();
  };

  const interruptFn = () => {
    self.abortRef.current?.abort();
    const p = self.S.current.perm;
    if (p) { p.resolve({ choice: 'no' }); self.setPerm(null); }
    if (self.answerRef.current) { self.answerRef.current({ choice: 'no' }); self.answerRef.current = null; self.setAnswerWait(false); }
  };

  // /btw: asked on the side lane with a copy of the conversation, while the
  // main job goes on; its own stop, so closing it never touches the main job.
  const closeBtwFn = () => {
    self.btwRef.current?.ac.abort();
    self.btwRef.current = null;
    self.setBtw(null);
    // A memory save that stepped aside for the question may run now.
    if (!self.agent.busy) self.autoRef.current?.schedule();
  };
  const askBtwFn = async (question) => {
    self.btwRef.current?.ac.abort();
    const id = ++self.seq;
    const ac = new AbortController();
    self.btwRef.current = { id, ac };
    const mine = (fn) => self.setBtw((b) => (b && b.id === id ? fn(b) : b));
    self.setBtw({ id, question, text: '', phase: 'answering', startedAt: Date.now(), scroll: null });
    self.autoRef.current.cancel(); // the side lane is the memory save's too
    try {
      // On a remote: who answers is chosen there (the lowest model that is ready, else the main one).
      const rm = self.remoteRef.current.on ? self.S.current.model?.remote : null;
      const remote = rm && rm.kind !== 'llama' ? {
        kind: rm.kind, ollama: Boolean(rm.ollama), main: rm.model,
        models: self.S.current.catalog?.models ?? [], picked: self.agent.helperJobs?.side?.on ? self.agent.helperJobs.side.model : null,
        memo: (self.sideMemo.current[self.agent.url] ??= {}),
      } : null;
      const r = await askAside({ agent: self.agent, question, live: self.S.current.live, signal: ac.signal, remote, tryMs: Number(process.env.AGENTIC_BTW_TRY_MS) || undefined, onText: (all) => mine((b) => ({ ...b, text: all, phase: 'writing' })), onNote: (wait) => mine((b) => (b.phase === 'answering' ? { ...b, wait } : b)) });
      if (ac.signal.aborted) return;
      if (r.noRoom) mine((b) => ({ ...b, phase: 'noroom', text: "No room for a side question right now: the conversation fills the model's memory. Ask again after this step, or /compact when it is done." }));
      else mine((b) => ({ ...b, phase: r.text ? 'done' : 'error', text: r.text || 'No answer came back. Try asking again.', who: r.text ? r.who ?? null : null }));
    } catch (e) {
      if (!ac.signal.aborted) mine((b) => ({ ...b, phase: 'error', text: `Could not answer: ${e.message}` }));
    }
  };

  const runShellFn = async (command) => {
    if (!command) return;
    self.setLive({ phase: 'working', turnStart: Date.now(), verb: 'Running', tokens: 0, running: { label: 'Bash', arg: command } });
    const r = await runCommand(command, { cwd: self.cwd, maxLines: 200, sandbox: false }); // you typed it: no fence
    self.setLive(IDLE);
    self.push({ type: 'bash', command, lines: r.lines, code: r.code });
    self.fold({ title: `! ${command}`, text: r.lines.join('\n') });
    self.pendingContext.current.push(`[The user ran \`${command}\` in the terminal (exit ${r.code}). Output:\n${r.lines.slice(-60).join('\n')}]`);
  };

  const doctorFn = () => {
    const ok = (b) => (b ? '✓' : '✗');
    // Your MCP servers (/mcp), one row each: connected with its tools, off, or why it is not running and where its log is.
    const mcpRows = (self.mcpHub?.status() ?? []).map((s) => [`${s.state === 'connected' ? '✓' : s.state === 'off' || s.state === 'starting' ? '·' : '✗'} mcp ${s.name}`.slice(0, 21), s.state === 'connected' ? `${s.tools} tool${s.tools === 1 ? '' : 's'} · ${s.version ?? s.era ?? ''} · ${s.where}` : s.state === 'off' ? 'off · /mcp switches it on' : s.state === 'starting' ? 'starting…' : `${s.error ?? s.state} · its log: ${short(mcpLogFile(s.name))}`]);
    // On a remote: where it is, how it connects, how it answered; this Mac's model files do not matter.
    if (self.model.remote) {
      const c = self.remoteRef.current.conn;
      const r = self.settings.remote ?? DEFAULT_REMOTE;
      self.push({ type: 'panel', title: 'Doctor · on a remote model', pad: 22, rows: [
        [`${ok(Boolean(c))} remote`, c ? `${remoteLabel(r)} · ${kindWord(r.kind)} · ${r.connect === 'ssh' ? `SSH tunnel on port ${c.tunnel?.port}` : r.connect} · answered in ${c.info.ms ?? '?'} ms` : `not connected: ${self.remoteRef.current.why ?? 'not started'}`],
        [`${ok(!r.key || Boolean(c))} API key`, r.key ? `${keyStore() === 'keychain' ? 'in the Keychain' : 'in the key file'} (••••${r.keyEnd ?? ''})` : 'none'],
        [`${ok(Boolean(c))} model`, c ? `${c.info.model ?? self.model.name} · context ${Math.round(self.agent.ctx / 1024)}k${c.slots > 1 ? ` · ${c.slots} slots` : ''}` : '—'],
        [`${ok(!remoteRisk(r))} privacy`, remoteRisk(r) ?? (r.connect === 'ssh' ? 'through ssh' : r.connect === 'https' ? 'https' : 'http on a private network')],
        [`${ok(true)} terminal`, `${process.env.TERM_PROGRAM ?? 'unknown'} · ${process.env.COLORTERM === 'truecolor' ? 'true colour' : '256 colours'} · ${self.columns}×${self.rows}`],
        ...mcpRows,
      ] });
      return;
    }
    const bin = serverBinOf(self.model);
    const ver = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    const file = modelPath(self.model);
    const size = onDiskBytes(self.model);
    const avail = availableBytes();
    let disk = null;
    try { const f = statfsSync(home); disk = (f.bavail * f.bsize) / 1e9; } catch {}
    self.push({
      type: 'panel', title: 'Doctor', pad: 22, rows: [
        [`${ok(ver.status === 0)} model server`, ver.status === 0 ? `${engineOf(self.model).id} ${(ver.stderr + ver.stdout).match(/build \d+/)?.[0] ?? 'ok'} · ${short(bin)}` : `missing at ${short(bin)}`],
        [`${ok(size === self.model.bytes)} model file`, size ? `${(size / 1e9).toFixed(2)} GB · ${short(file)}` : `missing: download ${self.model.url}`],
        // Off is fine (it waits for /start), so it is not marked as a fault.
        self.modelOffNow() ? ['· server running', 'no: the model is off · /start loads it'] : [`${ok(!!self.agent.url && !self.starting)} server running`, self.serverRef.current?.port ? `port ${self.serverRef.current.port}, context ${Math.round(self.agent.ctx / 1024)}k` : self.opts.url ? self.opts.url : 'not running'],
        [`${ok(true)} vision`, !self.model.vision ? `${self.model.name} cannot look at pictures` : self.agent.canSee ? 'on: it can look at pictures in this window' : existsSync(visionPath(self.model)) ? 'off: turns on when you attach a picture' : `not downloaded: attaching a picture offers it (${(self.model.vision.bytes / 1e9).toFixed(2)} GB), or coding setup`],
        [`${ok(avail > needBytes(self.model, 16384))} free memory`, `${(avail / 1e9).toFixed(1)} GB (32k needs ${(needBytes(self.model, 32768) / 1e9).toFixed(1)} GB, 16k ${(needBytes(self.model, 16384) / 1e9).toFixed(1)} GB)`],
        [`${ok(disk === null || disk > 2)} disk space`, disk === null ? 'unknown' : `${disk.toFixed(1)} GB free`],
        [`${ok(true)} terminal`, `${process.env.TERM_PROGRAM ?? 'unknown'} · ${process.env.COLORTERM === 'truecolor' ? 'true colour' : '256 colours'} · ${self.columns}×${self.rows}`],
        ...mcpRows,
      ],
    });
  };

  // /agents: the window grows while its tree is open and goes back after (agents-window.mjs).
  const agentsGrow = () => {
    if (!canResize() || self.agentsSize.current) return;
    const cur = { columns: process.stdout.columns, rows: process.stdout.rows };
    const to = growTo(cur);
    if (!to) return;
    self.agentsSize.current = cur;
    try { process.stdout.write(resizeSeq(to[0], to[1])); } catch { /* the window stays as it is */ }
  };
  const agentsGiveBack = () => {
    const was = self.agentsSize.current;
    self.agentsSize.current = null;
    if (!was || !canResize()) return;
    try { process.stdout.write(resizeSeq(was.columns, was.rows)); } catch { /* it stays big */ }
  };
  const openAgentsTree = () => { self.setAgentsView('tree'); agentsGrow(); };
  // /loops: the board takes this window, grown to fit three cards where the terminal follows that
  // (as /agents does), and esc gives the window back. setup: an unclear /loop line to ask about.
  const openLoops = ({ setup = null } = {}) => {
    const m = self.loopsOf();
    if (!self.loopsUi.current) self.loopsUi.current = newLoopsUi({ inApp: true });
    const ui = self.loopsUi.current;
    if (setup || (!m.loops.length && ui.view !== 'setup' && ui.view !== 'form')) openLoopsSetup(ui, { mode: self.agent.mode, ...(setup ?? {}) });
    if (canResize() && !self.loopsSize.current) {
      const cur = { columns: process.stdout.columns, rows: process.stdout.rows };
      const to = growTo(cur, [120, 36]);
      if (to) { self.loopsSize.current = cur; try { process.stdout.write(resizeSeq(to[0], to[1])); } catch { /* the window stays as it is */ } }
    }
    self.setLoopsOn(true);
  };
  const closeLoops = () => {
    self.setLoopsOn(false);
    const was = self.loopsSize.current;
    self.loopsSize.current = null;
    if (was && canResize()) { try { process.stdout.write(resizeSeq(was.columns, was.rows)); } catch { /* it stays big */ } }
  };
  // A key while /loops has the window, as the board's own key names (loops-board.mjs keysOf).
  const loopsKey = (ch, key) => {
    const m = self.loopsRef.current, ui = self.loopsUi.current;
    if (!m || !ui) { closeLoops(); return; }
    const keys = key.return ? ['enter'] : key.escape ? ['esc'] : key.backspace || key.delete ? ['backspace'] : key.upArrow ? ['up'] : key.downArrow ? ['down'] : key.leftArrow ? ['left'] : key.rightArrow ? ['right']
      : key.tab ? [key.shift ? 'shiftTab' : 'tab'] : key.ctrl && /^[a-z]$/i.test(ch) ? [`^${ch.toUpperCase()}`] : key.meta ? [] : [...String(ch ?? '')].filter((c) => c >= ' ');
    const b = {
      state: m.snapshot(), ui, quit: closeLoops,
      // What the board sends goes straight to the loops here (the board in another terminal sends a file).
      send: (cmd) => {
        const r = m.apply(cmd);
        if (r?.then) r.then((u) => { loopsReply(ui, m.loops, u); self.setLoopsTick((x) => x + 1); });
        else loopsReply(ui, m.loops, r);
        self.setLoopsBadge(self.loopsBadgeOf(m));
      },
    };
    for (const k of keys) { loopsHandleKey(b, k); b.state = m.snapshot(); }
    self.setLoopsTick((x) => x + 1);
  };
  const closeAgents = () => { self.setAgentsView(null); agentsGiveBack(); };
  const startAgents = (request, { demo = false, saved = null } = {}) => {
    const driver = demo ? demoDriver() : agentDriver(self.agent);
    const run = new AgentsRun({ request, driver, saved });
    self.agentsRef.current = run;
    // Accept edits for the run: the stop list asks about what matters; your mode comes back after.
    const before = self.agent.mode;
    if (!demo && before === 'ask') self.setMode('edits');
    run.on('state', (st) => self.setAgentsState({ ...st }));
    run.on('end', (st) => {
      if (!demo && before === 'ask') self.setMode('ask');
      self.setAgentsState({ ...st });
      const v = st.verdict ?? {};
      const files = demo ? 'a pretend run: nothing was written' : st.place ? `its files in ${st.place}/ (yours are as they were)` : 'SPEC.md, CONSTRAINTS.md, tasks/plan.md, tasks/todo.md, tasks/review.md and tasks/ship.md';
      self.push({ type: 'note', text: `/agents ${v.kind === 'go' ? 'GO' : v.kind === 'nogo' ? 'NO-GO' : v.kind === 'failed' ? 'stopped by an error' : 'stopped'}${v.why ? `: ${v.why}` : ''} · ${st.items[2]?.filter((t) => t.state === 'done').length ?? 0} tasks done · ${files} · nothing committed (read git diff, then commit). /agents opens the tree again.`, tone: v.kind === 'go' ? 'dim' : 'warn' });
      // A few seconds on the result, then the window is yours again.
      setTimeout(() => { if (self.agentsRef.current === run && !run.running) closeAgents(); }, 4000);
    });
    self.setAgentsState({ ...run.state });
    self.push({ type: 'note', text: `/agents${demo ? ' demo (a pretend run, nothing is written)' : ''}: ${request}`, tone: 'dim' });
    openAgentsTree();
    run.start(saved?.stage ?? 0);
  };
  // The answer to the question the run waits on; "type it" takes your next line in the chat.
  const agentsAnswer = (n) => {
    const run = self.agentsRef.current, g = run?.state.gate;
    if (!g || n < 0 || n >= g.opts.length) return;
    if (g.typeAt === n) {
      self.setAgentsView('chat');
      self.answerRef.current = ({ text }) => { run.answer(n, text); self.setAgentsView('tree'); };
      self.setAnswerWait(true);
      self.setPlaceholder('Type your answer for /agents, then enter');
      return;
    }
    run.answer(n);
  };
  const agentsKey = (ch, key) => {
    const run = self.agentsRef.current, st = run?.state;
    if (!run) return false;
    if (key.ctrl && ch === 'c') return false;
    if (key.escape) { if (run.running) self.setAgentsView('chat'); else closeAgents(); return true; }
    const g = st.gate;
    if (g) {
      if (/^[1-9]$/.test(ch) && Number(ch) <= g.opts.length) { agentsAnswer(Number(ch) - 1); return true; }
      if (key.upArrow || key.downArrow) { g.sel = (g.sel + (key.upArrow ? g.opts.length - 1 : 1)) % g.opts.length; self.setAgentsState({ ...st }); return true; }
      if (key.return) { agentsAnswer(g.sel); return true; }
    }
    if (ch === 'p' && !key.ctrl && !key.meta) { if (st.paused) run.resume(); else run.pause(); return true; }
    // Typing anything else goes to the chat, where it is a note for the next step.
    if (ch && !key.ctrl && !key.meta && !key.return && !key.tab) { self.setAgentsView('chat'); return false; }
    return true;
  };
  return { sendPromptFn, agentEvents, arenaTick, loadModel, windowOpens, stopModel, startModel, toggleModel, resumeAtStart, quitFn, updateNowFn, interruptFn, closeBtwFn, askBtwFn, runShellFn, doctorFn, openAgentsTree, openLoops, loopsKey, startAgents, agentsKey };
}
