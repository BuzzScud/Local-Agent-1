// The window's slash commands (App.jsx): runSlash, every /command typed or picked from the / menu.
// The functions are the App's own, moved here word for word: the App's names (and App.jsx's) are read through
// self, which App makes at each render, so a function sees the values of the render that made it.
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { recentOf } from './start.jsx';
import { helpersEnv, helperRows, changeHelpers } from './helpers.mjs';
import { changeHooks, leanEnv } from '../agent/way.mjs';
import { modeOf } from '../agent/permissions.mjs';
import { screenAccess, terminalApp, askScreenAccess } from '../tools/screen.mjs';
import { remoteLabel, thinkingLevel, embedderReady, Embedder, DEFAULT_REMOTE, sourceOf, findRunTest, RUN_TESTS, MODELS, readRecord, modelPath, DEFAULT_MODEL } from '../../../models/index.mjs';
import { othersIn, projectOf } from './copies.mjs';
import { kindWord, readyRemote, remotesOf } from './remote-form.mjs';
import { capLines } from '../tools/jobs.mjs';
import { listDocs } from './weights.mjs';
import { MODE_OPTIONS } from './help.mjs';
import { memoryDirs, healthLine, health, undoSave, readFacts, readLog } from '../agent/facts.mjs';
import { rulesList, ALWAYS_MAX, changeRules, looksLikeEvent } from './rules.mjs';
import { notesCount, notesDir } from '../agent/claude-notes.mjs';
import { packState } from '../agent/claude-pack.mjs';
import { mathTopics } from '../agent/expertise.mjs';
import { designSettings, styleWords, designSummary, STYLES as DESIGN_STYLES, readCards, designDir } from '../agent/design.mjs';
import { studioSummary } from '../agent/studio.mjs';
import { newSessionId, listSessions, saveSettings } from './store.mjs';
import { MAC_NAME } from './jump-box.mjs';
import { isLoopCommand, unclearOf, parseLoop, describe as describeLoop, LOOP_HELP } from './loops.mjs';
import { promptCommand, promptText } from '../agent/mcp.mjs';
import { modeWord, changePermissions } from './perms.mjs';
import { runMorning, summary as morningSummary } from '../morning/index.mjs';
import { complete } from '../flows/llm.mjs';
import { showLimit } from './limits.mjs';
import { STAGES as AGENT_STAGES } from '../agent/agents-run.mjs';
import { savedRun } from '../agent/agents-driver.mjs';
import { IDLE, INIT_PROMPT, short } from './app-common.mjs';

export function slashPart(self) {
  const runSlashFn = async (line) => {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const busy = self.agent.busy;
    switch (cmd) {
      case 'help': {
        // The whole Help page (commands, keys, modes, effort, where things
        // live) opens in the hub's Help tab; here, a box in the middle says so.
        const hub = self.openHub('help');
        if (hub) self.setPopup({ title: 'Agentic Coder help', text: 'Opened a help page in your browser, with every command, key and setting.', url: hub.url });
        break;
      }
      case 'clear':
        if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        {
          // Your hooks: SessionEnd for the conversation that goes, SessionStart for the new one.
          self.agent.endSession('clear').then(() => self.agent.startSession('clear')).catch(() => {});
          // Back in the folder Agentic Coder was started in, if a "Work in <project>?" moved it.
          const back = self.agent.startOver(self.copyRef.current?.work ?? self.opts.cwd); // a window in its own copy stays there
          self.sessionRef.current = { id: newSessionId(), title: null, items: [] };
          // Like Claude Code's /clear: nothing of the old conversation is left on
          // the screen, in the scrollback, behind ctrl+o or in the status line;
          // only the start page, drawn again. The old one stays in /resume.
          self.pendingContext.current = [];
          self.folds.current = { list: [], back: 0 };
          self.setStats({});
          self.closeBtw();
          // The start page again, listing the conversation just cleared (a new key: its rows are measured afresh).
          try { self.recentRef.current = listSessions(self.copyRef.current?.work ?? self.opts.cwd); } catch {}
          self.itemsRef.current = [{ key: `welcome${++self.seq}`, type: 'welcome' }];
          self.holdRef.current = !self.opts.url && !self.remoteRef.current?.on; // live again until the next message
          self.setItems(self.itemsRef.current);
          self.win?.clear();
          self.rewindRef.current?.setSession(self.sessionRef.current.id);
          if (back) self.push({ type: 'note', text: `Back in ${short(self.opts.cwd)}, the folder Agentic Coder was started in.`, tone: 'dim' });
        }
        break;
      case 'btw': {
        // A quick side question, like Claude Code's: it runs while Agentic Coder works.
        if (!arg) { self.push({ type: 'note', text: 'Ask the question after it: /btw what are you doing right now?', tone: 'dim' }); break; }
        if (self.S.current.starting) { self.push({ type: 'note', text: 'The model is still starting; ask again in a moment.', tone: 'dim' }); break; }
        // Only on a remote (3 Oct 2026, the owner's pick): there another model, or the main one
        // on a request of its own, takes the question. This Mac's own model has one memory for both.
        const rm = self.remoteRef.current.on ? self.model.remote : null;
        if (!rm && !self.opts.url) { self.push({ type: 'note', text: '/btw works on a remote model: /remote connects one (the lowest model there answers the side question when it is ready). On this Mac’s own model it is off.', tone: 'warn' }); break; }
        if (self.modelOffNow()) { self.push({ type: 'note', text: 'The model is off: /start loads it, then ask again.', tone: 'dim' }); break; }
        // A llama server (your other computer, or one given with --url): without a side lane the
        // question would take the conversation's lane and throw away its reading.
        if ((!rm || rm.kind === 'llama') && self.agent.slots?.side === undefined) { self.push({ type: 'note', text: '/btw needs the model server\'s side lane, and this one has a single lane (with --url, add --slots 2).', tone: 'warn' }); break; }
        self.askBtw(arg);
        break;
      }
      case 'agents': {
        // /agents <request>: spec, plan, test-first build, verify, review and ship, on the agent tree.
        const run = self.agentsRef.current;
        const sub = arg.toLowerCase();
        if (sub === 'stop') { if (run?.running) { run.stop(); self.push({ type: 'note', text: 'Stopping /agents after this step. Nothing was committed.', tone: 'dim' }); } else self.push({ type: 'note', text: 'No /agents run is going.', tone: 'dim' }); break; }
        if (!arg || sub === 'open') {
          if (run) { self.openAgentsTree(); break; }
          const saved = savedRun(self.agent.cwd);
          self.push({ type: 'note', text: saved ? `An unfinished /agents run here: "${saved.request}". /agents resume goes on from ${AGENT_STAGES[saved.stage]?.name ?? 'where it stopped'}.` : 'Give it a request: /agents build a Kepler solver (/agents demo shows the tree on a pretend run).', tone: 'dim' });
          break;
        }
        if (run?.running) { self.push({ type: 'note', text: 'A /agents run is going: /agents opens it, /agents stop ends it.', tone: 'dim' }); break; }
        if (sub === 'demo') { self.startAgents('build a Kepler solver: where an orbit is at time t', { demo: true }); break; }
        if (busy || self.S.current.starting) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        if (self.modelOffNow()) { self.push({ type: 'note', text: 'The model is off: /start loads it, then /agents again.', tone: 'dim' }); break; }
        // Plan mode turns every edit away: said up front, not at each step (the run says it too).
        if (self.agent.mode === 'plan') { self.push({ type: 'note', text: '/agents writes its files and the code, and Plan mode only reads: leave Plan mode (shift+tab), then /agents again.', tone: 'warn' }); break; }
        if (sub === 'resume') {
          const saved = savedRun(self.agent.cwd);
          if (!saved) { self.push({ type: 'note', text: 'No unfinished /agents run in this folder.', tone: 'dim' }); break; }
          self.startAgents(saved.request, { saved });
          break;
        }
        self.startAgents(arg);
        break;
      }
      // /jumptomac [mac]: this window goes to your other Mac's sessions (the menu coding attach
      // <mac> shows) and this session keeps running; ctrl+b there comes back. The window does it
      // (door.mjs viewJumping): the app only asks its host to send the window that typed this.
      case 'jobs': {
        // /jobs [stop <id|all>]: the commands the model runs in the background (tools/jobs.mjs).
        const jobs = self.agent.jobs;
        const sub = /^stop\s+(\S+)$/i.exec(arg);
        if (sub) {
          const which = sub[1].toLowerCase() === 'all' ? jobs.running() : [jobs.get(sub[1])].filter(Boolean);
          const did = which.filter((j) => jobs.stop(j, 'you'));
          self.push({ type: 'note', text: did.length ? `Stopping ${did.map((j) => `${j.id} (${j.command})`).join(', ')}.` : `${sub[1].toLowerCase() === 'all' ? 'No background job is running.' : `No running job "${sub[1]}".`} /jobs lists them.`, tone: did.length ? 'dim' : 'warn' });
          break;
        }
        if (arg) { self.push({ type: 'note', text: '/jobs lists the background commands; /jobs stop job1 (or all) stops them.', tone: 'warn' }); break; }
        if (!jobs.all.length) { self.push({ type: 'note', text: 'No background commands. The model starts one with Bash and background: true (a dev server, a long test run); they end when this window closes.', tone: 'dim' }); break; }
        const rows = jobs.all.map((j) => { const last = capLines(j.out, 6).slice(-3).filter((l) => l.trim()); return [`  ${jobs.line(j)}`, ...last.map((l) => `      ${l.slice(0, 160)}`)].join('\n'); });
        self.push({ type: 'note', text: [`Background commands (${jobs.running().length} running; they end when this window closes) · /jobs stop <id|all>:`, ...rows].join('\n'), tone: 'dim' });
        break;
      }
      case 'loop':
      case 'loops': {
        // /loop [debug|test|web] [10m] [message]: a message sent again by itself (loops.mjs). /loops: its
        // board, as this window's screen; with no loop yet, the setup that makes one a step at a time.
        const m = self.loopsOf();
        const a = arg.trim();
        if (cmd === 'loops' || /^(board|open)$/i.test(a) || (!a && !m.loops.length)) { self.openLoops(); break; }
        if (!a || /^list$/i.test(a)) {
          self.push({ type: 'note', text: m.loops.length ? ['Loops of this window (they end when it closes) · /loops opens the board:', ...m.loops.map((l) => `  ${l.id}. ${l.name} · ${describeLoop(l)}`), `Change one: ${LOOP_HELP}`].join('\n') : '/loop 10m <message> sends a message again every 10 minutes. /loop test 5m runs the tests, /loop debug fixes failing tests until they pass, /loop web 30m <what to read> reads pages. /loops opens the board, where ^N makes a loop a step at a time; /loop stop ends them.', tone: 'dim' });
          break;
        }
        const sub = /^(stop|pause|run)\s*(all|\d+)?$/i.exec(a);
        if (sub) {
          const what = sub[1].toLowerCase();
          const which = !sub[2] || sub[2].toLowerCase() === 'all' ? m.open : [m.loop(Number(sub[2]))].filter(Boolean);
          const did = which.filter((l) => (what === 'stop' ? m.stop(l.id) : what === 'pause' ? m.pause(l.id) : m.runNow(l.id)));
          self.setLoopsBadge(self.loopsBadgeOf(m));
          self.push({ type: 'note', text: did.length ? `${{ stop: 'Stopped', pause: 'Paused, or going again', run: 'Running now' }[what]}: ${did.map((l) => l.name).join(', ')}.` : 'No such loop here. /loop lists them.', tone: did.length ? 'dim' : 'warn' });
          break;
        }
        // /loop <n> <rule>: one loop's rules, or one thing done to it (loops.mjs loopCommand). Undo takes a moment.
        if (isLoopCommand(a)) {
          const said = (r) => { self.setLoopsBadge(self.loopsBadgeOf(m)); self.push({ type: 'note', text: r.error ?? r.text, tone: r.error ? 'warn' : 'dim' }); };
          const r = m.command(a);
          if (r?.then) r.then(said); else said(r);
          break;
        }
        // A task the rules cannot read well ("test5m", a single word) is asked about first, in the board's setup.
        const unclear = unclearOf(a);
        if (unclear) { self.openLoops({ setup: { text: a, unclear } }); break; }
        const p = parseLoop(a);
        if (p.error) { self.push({ type: 'note', text: p.error, tone: 'warn' }); break; }
        const l = m.add(p, { folder: self.agent.cwd, mode: self.agent.mode });
        self.setLoopsBadge(self.loopsBadgeOf(m));
        self.push({ type: 'note', text: `↻ Loop ${l.id} started: ${l.name} · ${describeLoop(l)}${p.note}. Its runs work in this folder, in ${modeWord(self.agent.mode)}, and it ends when this window closes. /loops shows it.`, tone: 'dim' });
        break;
      }
      case 'jumptomac': {
        // Alone: "Jump to a Mac", the box of your saved Macs (jump-box.mjs); with a name: straight there.
        const here = process.env.AGENTIC_IN_HOST;
        const mac = arg.trim();
        if (!here) { self.push({ type: 'note', text: 'This window cannot jump: it runs the app itself, not a background session (an older Bun, or sessions switched off). Quit, then type: coding attach <mac>', tone: 'warn' }); break; }
        if (!mac) { self.openJumpBox(); break; }
        if (!MAC_NAME.test(mac)) { self.push({ type: 'note', text: `"${mac}" is not a Mac’s name: letters, digits, dots and hyphens (its Tailscale name, like server-1).`, tone: 'warn' }); break; }
        await self.jumpTo(mac);
        break;
      }
      case 'morning': {
        // The morning brief: the repos read, the words written by the model on
        // its side slot and checked against the facts, and the page (with every
        // earlier morning in its calendar) opened in the browser.
        if (busy || self.S.current.live.phase === 'working') { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        const day = arg.toLowerCase() || 'auto';
        if (!/^(auto|today|yesterday|\d{4}-\d{2}-\d{2})$/.test(day)) { self.push({ type: 'note', text: 'Use /morning, or /morning today, yesterday or a date (2026-09-26).', tone: 'warn' }); break; }
        const ac = new AbortController();
        self.abortRef.current = ac;
        self.setLive({ phase: 'working', turnStart: Date.now(), verb: 'Reading the repos', tokens: 0 });
        try {
          const r = await runMorning({
            day, complete: self.agent.url ? complete : undefined, url: self.agent.url, model: self.agent.model, slot: self.agent.slots?.side, signal: ac.signal,
            onToken: (n) => self.setLive((l) => ({ ...l, tokens: n, lastTokenAt: Date.now() })),
            onStep: (kind, text) => {
              if (kind === 'gather' && text.startsWith('Read ')) self.push({ type: 'note', text, tone: 'dim' });
              if (kind === 'words') self.setLive((l) => ({ ...l, verb: 'Writing the brief' }));
            },
          });
          self.push({ type: 'note', text: `${morningSummary(r)}${self.agent.url ? '' : ' · the model was still starting, so the words are plain'}`, tone: r.error ? 'warn' : 'dim' });
        } catch (e) {
          self.push({ type: 'note', text: ac.signal.aborted ? 'Morning brief stopped.' : `Morning brief: ${e.message}`, tone: ac.signal.aborted ? 'dim' : 'error' });
        } finally {
          self.setLive(IDLE);
        }
        break;
      }
      case 'compact':
        if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        if (self.modelOffNow()) { self.push({ type: 'note', text: 'The model is off: /start loads it, then /compact can summarize.', tone: 'dim' }); break; }
        // agent.compact leaves a conversation this short as it is; said, so ctrl+p is not silent.
        if ((self.agent.said?.() ?? self.agent.messages?.length ?? 0) <= 3) { self.flash('Nothing to summarize yet: the conversation is still short', 2500); break; }
        self.setLive({ phase: 'working', turnStart: Date.now(), verb: 'Compacting', tokens: 0 });
        try { await self.agent.compact(undefined, { instructions: arg || undefined }); } catch (e) { self.push({ type: 'note', text: e.message, tone: 'error' }); }
        self.setLive(IDLE);
        break;
      case 'effort':
      case 'think': { // /think is the old name, still accepted
        // Alone: the Effort and limits panel. With a word:
        // /effort low|medium|high, or on|off ("off" and "xhigh" are the old
        // names for low and high).
        const levels = self.model.thinkingLevels ?? [];
        if (!arg.trim() && levels.length) { self.openEffortLimits(); break; }
        const a = arg.toLowerCase().replace(/^off$/, 'low').replace(/^xhigh$/, 'high');
        const picked = levels.find((l) => l.id === a);
        if (a && !picked && !/^(on|yes|true|1|no|false|0)$/i.test(a)) {
          self.push({ type: 'note', text: `${self.model.name} has no ${a} effort: it has ${levels.map((l) => l.label).join(' and ')}. Effort stays ${thinkingLevel(self.model, self.agent.thinking, self.agent.effort).label.toLowerCase()}.`, tone: 'warn' });
          break;
        }
        const on = picked ? !!picked.effort : a ? /^(on|yes|true|1)$/i.test(a) : !self.agent.thinking;
        const eff = on && picked?.effort ? picked.id : undefined;
        self.setThinking(on, eff);
        self.sayEffort(thinkingLevel(self.model, on, eff ?? self.agent.effort), self.limitsRef.current.thinking);
        break;
      }
      case 'mode': {
        if (!arg.trim()) { self.openChoice('mode'); break; }
        const m = modeOf(arg) ?? (/^[1-5]$/.test(arg.trim()) ? MODE_OPTIONS[Number(arg) - 1].id : null);
        if (!m) { self.push({ type: 'note', text: `There is no mode "${arg.trim()}": auto, manual, edits, plan or bypass (or 1–5, as /mode lists them).`, tone: 'warn' }); break; }
        self.applyChoice('mode', m);
        break;
      }
      case 'memory': {
        // What Agentic Coder remembers: your own memory and this project's.
        if (!self.agent.memory) { self.push({ type: 'note', text: 'The memory is off here ("memory": false in settings.json).', tone: 'dim' }); break; }
        const dirs = memoryDirs(self.cwd);
        const tilde = (p) => (p?.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
        if (/^open\b/i.test(arg.trim())) {
          // The hub on its Memory tab: every fact, with its trust, to edit, pin, take out or bring back.
          const hub = self.openHub('memory'); if (!hub) break;
          self.push({ type: 'note', text: `Memory opened in the browser at ${hub.url}`, tone: 'dim' });
          break;
        }
        if (/^undo\b/i.test(arg.trim())) {
          const u = undoSave(dirs);
          if (!u) { self.push({ type: 'note', text: 'Nothing to take back: no save in the log.', tone: 'dim' }); break; }
          self.push({ type: 'panel', title: 'Memory · the last save taken back', pad: 14, rows: [...u.did.map((d) => [d.what, d.fact.text.replace(/\s+/g, ' ').slice(0, 110)]), ['/memory undo again takes back the save before it']] });
          break;
        }
        // Folders said short: under the project as ./…, under home as ~/…
        const short = (p) => {
          const s = p?.startsWith(self.cwd) ? `.${p.slice(self.cwd.length)}` : tilde(p);
          if (s.length <= 34) return s;
          const two = s.split('/').slice(-2).join('/');
          return `…/${two.length <= 32 ? two : s.split('/').pop()}`; // whole folder names, never cut mid-word
        };
        const sections = [];
        for (const [title, dir] of [['About you', dirs.you], ['This project', dirs.project]]) {
          const facts = dir ? readFacts(dir).sort((x, y) => Number(y.always) - Number(x.always) || y.trust - x.trust || y.used - x.used) : [];
          if (!facts.length) continue;
          sections.push({ title, where: short(dir), facts: facts.slice(0, 8).map((f) => ({ id: f.id, kind: f.kind, always: f.always, pinned: f.pinned, trust: f.trust, used: f.used, text: f.text.replace(/\s+/g, ' ') })), more: Math.max(0, facts.length - 8) });
        }
        // Claude's notes are not Agentic Coder's to change: only how many there are, and where.
        let claude = null;
        if (self.agent.memory.claude) {
          const c = notesCount(self.agent.memory.claude === true ? notesDir() : notesDir({ setting: self.agent.memory.claude }));
          // From the pack (claude-pack.mjs): when it was built, and how many of Claude's notes changed since.
          if (c.dir) claude = { used: c.used, where: tilde(c.dir), leftOut: c.leftOut.length, pack: packState(dirname(c.dir)) };
        }
        if (!sections.length && !claude) { self.push({ type: 'note', text: 'Nothing saved yet. After a task Agentic Coder shows what it would remember and asks; "/update memory" or "remember that …" saves at once.', tone: 'dim' }); break; }
        const last = [dirs.you, dirs.project].filter(Boolean).flatMap((d) => readLog(d)).filter((l) => l.what !== 'trust').sort((x, y) => String(y.at).localeCompare(String(x.at)))[0];
        const at = last ? new Date(last.at) : null;
        const when = at ? `${at.getDate()} ${at.toLocaleString('en-US', { month: 'short' })}, ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : null;
        // How it is doing: is it learning, and do the facts come with requests?
        self.push({ type: 'memory', how: self.agent.memory.embedder ? 'meaning' : 'words', sections, claude, health: healthLine(health(dirs)), last: when });
        break;
      }
      case 'rules': {
        // What the model reads at every start, numbered; short commands change it.
        if (!self.agent.memory) { self.push({ type: 'note', text: 'The memory is off here ("memory": false in settings.json), so there are no rules to show.', tone: 'dim' }); break; }
        const dirs = memoryDirs(self.cwd);
        const [what = '', ...rest] = arg.trim().split(/\s+/);
        if (/^open$/i.test(what)) {
          const hub = self.openHub('memory'); if (!hub) break;
          self.push({ type: 'note', text: `Memory opened in the browser at ${hub.url}`, tone: 'dim' });
          break;
        }
        if (what) {
          if (busy) { self.flash('Wait for Agentic Coder to finish first'); break; }
          const r = changeRules(dirs, what.toLowerCase(), rest.join(' '));
          if (r.changed) self.agent.refreshNotes();
          self.push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
          break;
        }
        const list = rulesList(dirs);
        const plain = (f) => ({ n: f.n, text: f.text.replace(/\s+/g, ' '), event: looksLikeEvent(f.text) });
        const tilde = (p) => (p?.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
        self.push({ type: 'rules', always: list.always.map(plain), other: list.other.map(plain), off: list.off.map(plain), tokens: list.tokens, max: ALWAYS_MAX, where: tilde(dirs.you) });
        break;
      }
      case 'helpers': {
        // The context helpers, numbered, on or off; "/helpers off 3" switches one.
        const [what = '', ...rest] = arg.trim().split(/\s+/);
        if (what) {
          if (busy) { self.flash('Wait for Agentic Coder to finish first'); break; }
          const r = changeHelpers(self.agent.helpers, what.toLowerCase(), rest.join(' '));
          if (r.changed) {
            self.agent.helpers = r.on;
            saveSettings({ helpers: [...r.on] });
            // The code search needs the small model, which the memory may not have started.
            if (r.on.has('rag') && !self.agent.embedder && embedderReady() && self.limitsRef.current.embedder !== 'off') self.agent.embedder = new Embedder();
          }
          self.push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
          break;
        }
        const set = helpersEnv();
        self.push({ type: 'panel', title: `Helpers · ${self.agent.helpers.size} of 4 on · what comes along with a request before the first step${set !== undefined ? ` · AGENTIC_HELPERS=${set} decides` : ''}`, pad: 35, rows: helperRows(self.agent.helpers, self.agent.lastHelpers ?? [], { ragPaused: self.limitsRef.current.embedder === 'off' }) });
        break;
      }
      case 'hooks': {
        // The app's checks as hooks, for when the model decides (agent/way.mjs): numbered, on or
        // off; "/hooks on 1" switches one. On App they all run, as they always have.
        const [what = '', ...rest] = arg.trim().split(/\s+/);
        if (what) {
          if (busy) { self.flash('Wait for Agentic Coder to finish first'); break; }
          // /hooks lean · /hooks full: the lean harness (way.mjs), like Claude Code's: no app checks at all.
          if (/^(lean|full)$/i.test(what)) {
            if (leanEnv() !== undefined) { self.push({ type: 'note', text: `AGENTIC_LEAN=${leanEnv()} is set where Agentic Coder started, so it decides. Start it without that (unset AGENTIC_LEAN) to switch here.`, tone: 'warn' }); break; }
            const on = what.toLowerCase() === 'lean';
            self.agent.leanAuto = false; // your choice from now on, for every model (way.mjs LEAN_AUTO)
            const changed = self.agent.setLean(on);
            if (!on) self.agent.setWay(self.limitsRef.current.way);
            self.settings.lean = saveSettings({ lean: on }).lean;
            self.push({ type: 'note', text: !changed ? `The ${on ? 'lean' : 'full'} harness is already on.` : on
              ? "Lean harness on, like Claude Code's: the model decides every step and checks its own work. Off with it: the app's checks, Look first, the reminders of your request and its plan, and putting changes back after a failed test run. Permissions, your own hooks and the memory stay. /hooks full brings it all back. Kept for next time (settings.json)."
              : "Full harness on: the app's checks, reminders and put-back run again from the next message. Kept for next time (settings.json).", tone: 'dim' });
            break;
          }
          const r = changeHooks(self.agent.hooks, what.toLowerCase(), rest.join(' '));
          if (r.changed) { self.agent.hooks = r.on; saveSettings({ hooks: [...r.on] }); }
          self.push({ type: 'note', text: `${r.text}${r.changed && self.agent.way === 'app' ? ' (Who decides is App in /effort, so every check runs now anyway.)' : ''}`, tone: r.tone ?? 'dim' });
          break;
        }
        // Alone: the picker, your own hooks (user-hooks.mjs) above the app's checks (hooks-form.mjs).
        self.setPicker(self.hooksList());
        break;
      }
      case 'init':
        if (busy) { self.flash('Wait for Agentic Coder to finish first'); break; }
        self.sendPrompt(INIT_PROMPT, '/init');
        break;
      case 'math': {
        // Alone: the topics of ~/Desktop/MATH. With a question: ask it with
        // the notes attached even when no topic word matches.
        const topics = mathTopics();
        if (!topics.length) { self.push({ type: 'note', text: 'No math notes found (~/Desktop/MATH is missing or has no .md files).', tone: 'warn' }); break; }
        if (!arg) { self.push({ type: 'panel', title: 'Math topics (~/Desktop/MATH)', pad: 28, rows: topics }); break; }
        if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        self.agent.mathForce = true;
        self.sendPrompt(arg, `/math ${arg}`);
        break;
      }
      case 'design': {
        // Alone: the folder, set by set, and what is on. on|off: the cards with
        // page requests; check on|off: the browser check; ask on|off: a saved
        // page asks you before it is checked (or not); sets all|a,b: which
        // sets; style auto|opus|fable|mix: which set's cards win; studio
        // [on|off]: the design studio's pieces. Anything else is a request
        // sent with the cards.
        const saved = { ...(self.settings.design ?? {}) };
        const keep = (patch) => {
          const next = { ...saved, ...patch };
          self.settings.design = next;
          if (self.agent) self.agent.designSaved = next;
          saveSettings({ design: next });
          const now = designSettings(next);
          self.push({ type: 'note', text: `Design examples ${now.auto ? 'on' : 'off'} with page requests · layout check ${now.check ? 'on' : 'off'} · ${now.ask ? 'asks you first' : 'checks by itself'} · studio ${now.studio ? 'on' : 'off'} · sets: ${now.sets === 'all' ? 'all' : now.sets.join(', ')} · style: ${styleWords(now.style)}${process.env.AGENTIC_DESIGN || process.env.AGENTIC_LAYOUT || process.env.AGENTIC_LAYOUT_ASK || process.env.AGENTIC_DESIGN_SETS || process.env.AGENTIC_DESIGN_STYLE ? ' (an AGENTIC_DESIGN… setting in the environment decides over this)' : ''}.`, tone: 'dim' });
        };
        const a = arg.trim();
        if (!a) {
          const now = designSettings(saved);
          const sum = designSummary(now);
          if (!sum.dir) { self.push({ type: 'note', text: 'No design examples folder (make "design examples" in docs/private/, one subfolder per set of .md cards).', tone: 'warn' }); break; }
          self.push({ type: 'panel', title: `Design examples · ${now.auto ? 'on' : 'off'} with page requests · layout check ${now.check ? 'on' : 'off'} · ${now.ask ? 'asks you first' : 'checks by itself'} (/design ask) · studio ${now.studio ? 'on' : 'off'} (/design studio) · style: ${styleWords(now.style)} · ${sum.dir.replace(homedir(), '~')}`, pad: 18, rows: sum.rows });
          break;
        }
        if (/^(on|off)$/i.test(a)) { keep({ auto: /^on$/i.test(a) }); break; }
        const chk = /^check\s+(on|off)$/i.exec(a);
        if (chk) { keep({ check: /^on$/i.test(chk[1]) }); break; }
        // ask on: a saved page stops the turn and asks you before any check; off: it checks by itself.
        const ask = /^ask\s+(on|off)$/i.exec(a);
        if (ask) { keep({ ask: /^on$/i.test(ask[1]) }); break; }
        const sty = /^style(?:\s+(\S+))?$/i.exec(a);
        if (sty) {
          const want = sty[1]?.toLowerCase();
          if (!want || !DESIGN_STYLES.includes(want)) { self.push({ type: 'note', text: `The styles: ${DESIGN_STYLES.map((x) => `${x} (${styleWords(x)})`).join(' · ')}. Now: ${styleWords(designSettings(saved).style)}.`, tone: want ? 'warn' : 'dim' }); break; }
          keep({ style: want });
          break;
        }
        // studio: the design studio's pieces (agent/studio.mjs), alone its list; on|off: switch.
        const stu = /^studio(?:\s+(on|off))?$/i.exec(a);
        if (stu) {
          if (stu[1]) {
            const on = /^on$/i.test(stu[1]);
            const next = { ...saved, studio: on };
            self.settings.design = next;
            if (self.agent) self.agent.designSaved = next;
            saveSettings({ design: next });
            const now = designSettings(next);
            self.push({ type: 'note', text: `Design studio ${now.studio ? 'on' : 'off'}: ${now.studio ? 'a page request gets the pieces that fit it, and the page its built styles' : 'page requests get the design cards only'}${now.auto ? '' : ' (the design examples are off: /design on)'}${process.env.AGENTIC_STUDIO ? ' (AGENTIC_STUDIO in the environment decides over this)' : ''}.`, tone: 'dim' });
            break;
          }
          const sum = studioSummary();
          if (!sum.dir) { self.push({ type: 'note', text: 'No design studio folder (make "design studio" in docs/private/: styles/theme.css and components/<kind>/<piece>.html).', tone: 'warn' }); break; }
          const now = designSettings(saved);
          self.push({ type: 'panel', title: `Design studio · ${now.studio && now.auto ? 'on' : 'off'} with page requests · ${sum.dir.replace(homedir(), '~')}`, pad: 12, rows: sum.rows.length ? sum.rows : [['(none)', 'no pieces in components/ yet']] });
          break;
        }
        const sets = /^sets?\s+(.+)$/i.exec(a);
        if (sets) {
          const known = readCards(designDir()).sets.map((x) => x.name);
          const want = /^all$/i.test(sets[1].trim()) ? 'all' : sets[1].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
          const unknown = want === 'all' ? [] : want.filter((x) => !known.includes(x));
          if (unknown.length) { self.push({ type: 'note', text: `No set named ${unknown.join(', ')}. The sets: ${known.join(', ') || 'none yet'}.`, tone: 'warn' }); break; }
          keep({ sets: want });
          break;
        }
        if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        self.agent.designForce = true;
        self.sendPrompt(a, `/design ${a}`);
        break;
      }
      case 'settings':
        self.openSettings();
        break;
      case 'permissions': {
        // The raw text after the command: a new line in a command to try stays a new line.
        const r = changePermissions(self.agent.cwd, line.replace(/^\/permissions\b/i, ''), { mode: self.agent.mode, session: self.agent.allowedPrefixes });
        if (r.open === 'panel') { self.openPermissions(); break; }
        if (r.open === 'mode') { self.openChoice('startmode'); break; }
        if (r.mode) self.setMode(r.mode);
        if (r.panel) self.push({ type: 'panel', ...r.panel });
        if (r.text) self.push({ type: 'note', text: r.text, tone: r.tone ?? 'dim' });
        break;
      }
      // Not in the / menu (it holds what fits 80 × 24): the question a copy asks after a request,
      // again; outside a copy, the copy question for this folder.
      case 'copy': {
        if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
        if (self.copyRef.current) { if (!self.askCopyBack({ force: true })) self.push({ type: 'note', text: 'Nothing in your copy waits to be put back.', tone: 'dim' }); break; }
        self.othersRef.current = (() => { try { return othersIn(projectOf(self.agent.cwd).root); } catch { return []; } })();
        self.openChoice('same-folder');
        break;
      }
      case 'rewind':
        self.openRewind();
        break;
      case 'resume': {
        const list = listSessions(self.cwd);
        if (!list.length) { self.push({ type: 'note', text: 'No earlier conversations in this folder.', tone: 'dim' }); break; }
        // /resume <n>: the conversation the start page numbers n (start.jsx, the same repeats left out).
        if (/^\d+$/.test(arg.trim())) {
          const numbered = recentOf(list, 99);
          const pick = numbered[Number(arg.trim()) - 1];
          if (!pick) { self.push({ type: 'note', text: `No conversation ${arg.trim()} here: the start page numbers ${numbered.length}. /resume lists them.`, tone: 'dim' }); break; }
          self.holdRef.current = false;
          self.resumeSession(pick.id);
          break;
        }
        self.setPicker({ title: 'Resume a conversation', index: 0, items: list.map((s) => ({ key: s.id, label: s.title, desc: `${new Date(s.updated).toLocaleString()} · ${s.turns} prompt${s.turns === 1 ? '' : 's'}` })) });
        break;
      }
      case 'web': self.openWebPicker(); break;
      case 'mcp': self.openMcpPicker(); break;
      case 'screen': {
        // /screen: whether the model can look (macOS's Screen Recording, a model that sees
        // pictures) and the apps it may; /screen setup asks macOS, then opens its Settings page.
        if (process.platform !== 'darwin') { self.push({ type: 'note', text: 'Looking at the screen works on a Mac only.', tone: 'dim' }); break; }
        const sees = self.agent.canSee || self.agent.mayLook?.();
        if (arg.trim().toLowerCase() === 'setup') {
          if (screenAccess()) { self.push({ type: 'note', text: `${terminalApp()} may already take pictures of the screen: nothing to set up.`, tone: 'dim' }); break; }
          const ok = askScreenAccess();
          self.push({ type: 'note', text: ok ? `${terminalApp()} may take pictures of the screen now.` : `macOS keeps Screen Recording for itself to switch on: in System Settings (open now) → Privacy & Security → Screen & System Audio Recording, turn on ${terminalApp()}, then quit ${terminalApp()} and open it again (macOS asks that once). /screen says when it is allowed.`, tone: ok ? 'dim' : 'warn' });
          break;
        }
        const saved = self.agent.savedRules?.()?.allow?.filter((r) => /^Screen\(/i.test(r)) ?? [];
        const now = [...(self.agent.allowedPrefixes ?? [])].filter((r) => /^Screen\(/i.test(r));
        self.push({ type: 'note', text: [
          `Screen: ${screenAccess() ? `${terminalApp()} may take pictures of the screen` : `${terminalApp()} may not take pictures of the screen yet: /screen setup`}.`,
          `${self.model.name} ${sees ? 'can look at pictures, so it has the Screen tool: it asks before it looks at an app the first time (this time, for this session, or always).' : 'cannot look at pictures, so it has no Screen tool. A model that sees: on this Mac Qwen3.5 9B or Gemma, on Ollama one marked "vision" in /model.'}`,
          `It only looks: nothing is clicked or typed.${saved.length || now.length ? ` Allowed: ${[...saved.map((r) => `${r} (saved)`), ...now.map((r) => `${r} (this session)`)].join(', ')}.` : ''}`,
        ].join('\n'), tone: 'dim' });
        break;
      }
      case 'remote': {
        // /remote alone: the form. claude / computer / service: straight to that
        // service (the form, asking for its first row, when it is not set up);
        // here or off: back to this Mac; on: the last remote used.
        const w = arg.toLowerCase();
        const r = self.settings.remote ?? DEFAULT_REMOTE;
        const to = { claude: 'claude', computer: 'machine', machine: 'machine', service: 'openai', openai: 'openai' }[w];
        if (to) { self.remoteFnRef.current.to(to); break; }
        if (w === 'off' || w === 'here') {
          if (self.settings.remote) self.settings.remote = saveSettings({ remote: { ...r, use: false } }).remote;
          if (self.remoteRef.current.on) self.remoteFnRef.current.useLocal();
          else self.push({ type: 'note', text: 'Already on the model on this Mac. The remote stays off for next time too.', tone: 'dim' });
          break;
        }
        if (w === 'on') {
          if (!readyRemote(self.settings.remote ? remotesOf(self.settings)[sourceOf(r)] : null)) { self.push({ type: 'note', text: 'No remote is set up yet: pick Run on, fill in its rows, then Connect.', tone: 'dim' }); self.remoteFnRef.current.openForm(); break; }
          self.settings.remote = saveSettings({ remote: { ...r, use: true } }).remote;
          if (!self.remoteRef.current.conn) self.remoteFnRef.current.useRemote(self.settings.remote);
          else self.push({ type: 'note', text: `Already on the remote (${remoteLabel(r)}).`, tone: 'dim' });
          break;
        }
        if (w) { self.push({ type: 'note', text: '/remote alone opens the form; /remote claude, computer or service switches to one, /remote here (or off) comes back to this Mac.', tone: 'dim' }); break; }
        self.remoteFnRef.current.openForm();
        break;
      }
      case 'start':
        self.startFnRef.current();
        break;
      case 'stop':
        await self.stopFnRef.current();
        break;
      case 'autostart': {
        if (!arg.trim()) { self.openChoice('autostart'); break; }
        self.applyChoice('autostart', /^(on|yes|true)$/i.test(arg.trim()) ? 'on' : 'off');
        break;
      }
      case 'model': {
        self.openModelPicker();
        break;
      }
      case 'subagents': {
        self.openSubagentsPanel();
        break;
      }
      case 'stats':
        self.push({ type: 'panel', title: 'Stats', pad: 20, rows: [
          ['model', `${self.model.name}${self.model.edited ? ` · ${self.model.edited.edits.length} edit${self.model.edited.edits.length === 1 ? '' : 's'} · saved ${new Date(self.model.edited.saved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`],
          ['context used', `${(self.stats.ctxUsed ?? self.agent.ctxUsed).toLocaleString()} of ${self.agent.ctx.toLocaleString()} tokens`],
          ['writing speed', self.stats.tps ? `${self.stats.tps.toFixed(1)} tokens/s (last reply)` : '—'],
          ['reading speed', self.stats.pps ? `${Math.round(self.stats.pps)} tokens/s (last long read)` : '—'],
          ['written so far', `${(self.stats.outTokens ?? 0).toLocaleString()} tokens in ${self.stats.requests ?? 0} replies`],
          ['memory', `${self.ramGb ? `${self.ramGb.toFixed(1)} GB` : '—'}${self.memoryNote.current ? ` · ${self.memoryNote.current}` : ''}`],
          ['pictures', self.agent.canSee ? 'on: it can look at pictures' : self.model.vision ? 'off: turns on when you attach one (ctrl+v, a dragged file, @file.png)' : 'this model cannot look at pictures'],
          ['search', `embedder ${showLimit('embedder', self.limitsRef.current.embedder)} · retriever ${showLimit('retriever', self.limitsRef.current.retriever).toLowerCase()} · reranker ${showLimit('reranker', self.limitsRef.current.reranker)}${self.agent.reranker?.last ? ` (last ${(self.agent.reranker.last.ms / 1000).toFixed(1)} s for ${self.agent.reranker.last.pieces})` : ''} · /effort moves them`],
          ['limits', `context ${showLimit('context', self.limitsRef.current.context)} · thinking cap ${showLimit('thinking', self.limitsRef.current.thinking)} · ${self.limitsRef.current.tries} tries · ${self.limitsRef.current.steps} steps · /effort moves them`],
          ['loaded', self.modelOffNow() ? 'no: the model is off · /start loads it' : self.model.remote || self.opts.url ? 'not by Agentic Coder' : `yes · until /stop or you quit${self.settings.modelAtStart ? ' · loads as a window opens (/autostart)' : ''}`],
          ['server', self.model.remote ? `remote ${remoteLabel(self.settings.remote)} · ${kindWord(self.settings.remote?.kind)}${self.remoteRef.current.conn ? '' : ' · not connected'}` : self.serverRef.current?.port ? `port ${self.serverRef.current.port} · restarts ${self.serverRef.current.restarts}` : self.opts.url ?? (self.modelOffNow() ? 'off' : '—')],
        ] });
        break;
      case 'doctor':
        self.doctor();
        break;
      case 'arena':
      case 'battle': { // /battle: its name before 30 Sep 2026, still typed
        // The hub on its Arena tab: a test on one model, or a battle of two. The Arena runs on its own
        // (the hub starts it), so what runs there keeps going when this window closes.
        const hub = self.openHub('arena'); if (!hub) break;
        self.push({ type: 'note', text: `The Arena opened in the browser at ${hub.url} · run a test on one model, or battle two with it, one model at a time, each run stopped at 10 min · while something runs there, ${self.model.name} here is unloaded and comes back by itself when it ends`, tone: 'dim' });
        break;
      }
      case 'test': {
        // The Arena with this window's model as who runs it: pick a test (or name one: /test practice 28,
        // /test work28, /test 12 for practice test 12, /test 18b for your copy of it, /test sorting) and press
        // Run there. The run is the Arena runner's: this window lets go of its model while it runs, and it keeps
        // going when this window closes.
        const num = /^(?:task\s*)?(\d{1,2}[b-z]?)$/i.exec(arg);
        const t = arg ? (findRunTest(arg) ?? (num ? RUN_TESTS.find((x) => x.id === 'task') : null)) : null;
        if (arg && !t) { self.push({ type: 'note', text: `No test called "${arg}". Try one of: ${RUN_TESTS.map((x) => x.name.toLowerCase()).join(', ')}, or a practice task's number (/test 12). /test alone opens the list.`, tone: 'warn' }); break; }
        const mine = self.model.edited ? self.model.edited.base : self.model.id;
        const hub = self.openHub('arena', { run: '1', model: t && !t.model ? 'none' : MODELS[mine] ? mine : '', test: t?.id, n: num && t?.id === 'task' ? num[1] : '' });
        if (!hub) break;
        self.push({ type: 'note', text: `The Arena opened in the browser at ${hub.url} · ${t ? `${t.name}${num && t.id === 'task' ? ` ${num[1]}` : ''} is picked` : 'pick a test'}${t && !t.model ? '' : ` on ${self.model.name}`}, then press Run · while it runs, ${self.model.name} here is unloaded and comes back by itself when it ends`, tone: 'dim' });
        break;
      }
      case 'tests': {
        // The Arena with the test record over it: every test run and its result.
        const hub = self.openHub('arena', { record: '1' }); if (!hub) break;
        const runs = readRecord();
        self.push({ type: 'note', text: runs.length ? `The test record opened in the browser at ${hub.url} · ${runs.length} run${runs.length === 1 ? '' : 's'} recorded, the latest: ${runs[0].name} (${runs[0].total != null ? `${runs[0].passed} of ${runs[0].total}` : runs[0].result}) · it stays up while this window is open` : `The test record opened in the browser at ${hub.url} · no test has been recorded yet`, tone: 'dim' });
        break;
      }
      case 'instructions': {
        const hub = self.openHub('instructions'); if (!hub) break;
        self.push({ type: 'note', text: `Instructions opened at ${hub.url} · saved changes apply to the next task`, tone: 'dim' });
        break;
      }
      case 'weights':
      case 'docs': {
        // The hub in the browser: the same server as `coding weights` / `coding docs`,
        // inside this window. /weights opens it on the models' weights (every model in
        // /model, one alone or side by side), /docs on the harness diagram with
        // structure and every page one tab away.
        const here = Object.values(MODELS).filter((m) => m.format !== 'mlx' && existsSync(modelPath(m)));
        if (cmd === 'weights' && !here.length) { self.push({ type: 'note', text: `No model file is here yet (${modelPath(MODELS[DEFAULT_MODEL])}). Run coding setup first.`, tone: 'warn' }); break; }
        const hub = self.openHub(cmd === 'docs' ? 'harness' : 'weights'); if (!hub) break;
        const w = hub.server; const url = hub.url;
        if (cmd === 'docs') {
          const d = listDocs(w.docsDir);
          self.push({ type: 'note', text: d.missing ? `Docs opened at ${url}, but the DOCS folder was not found (docs/ in the repo; set AGENTIC_DOCS to point elsewhere)` : `Docs opened in the browser at ${url} · ${d.pages.length} pages from ${d.dir.replace(process.env.HOME, '~')}${d.pinned.harness ? ` · harness: ${d.pinned.harness.title}` : ''}${d.pinned.structure ? ` · structure: ${d.pinned.structure.title}` : ''} · it stays up while this window is open`, tone: d.missing ? 'warn' : 'dim' });
        } else self.push({ type: 'note', text: `Weights of ${here.map((m) => m.name).join(' and ')} opened in the browser at ${url} · it stays up while this window is open`, tone: 'dim' });
        break;
      }
      case 'meters': {
        if (!arg.trim()) { self.openChoice('meters'); break; }
        self.applyChoice('meters', /^(on|show|yes)$/i.test(arg) ? 'on' : 'off');
        break;
      }
      case 'mouse': {
        if (!arg.trim()) { self.openChoice('mouse'); break; }
        self.applyChoice('mouse', /^(on|yes)$/i.test(arg.trim()) ? 'on' : 'off');
        break;
      }
      case 'update':
        // /update memory [what]: save to memory now, like saying "update memory".
        if (/^memory\b/i.test(arg.trim())) { const what = arg.trim().replace(/^memory\b[\s:]*/i, ''); self.sendPrompt(what ? `update memory: ${what}` : 'update memory'); break; }
        await self.updateNow();
        break;
      case 'exit':
      case 'quit':
        await self.quit();
        break;
      default: {
        // /server:prompt: a prompt of one of your MCP servers, sent as your message.
        const pc = self.mcpHub && /:/.test(cmd) ? promptCommand(line, Object.fromEntries(await Promise.all(self.mcpHub.offers().prompts.map(async (s) => [s, await self.mcpHub.prompts(s).catch(() => [])])))) : null;
        if (pc?.missing) { self.push({ type: 'note', text: `${pc.server} has no prompt called ${pc.prompt}. Type /${pc.server}: to see its prompts.`, tone: 'warn' }); break; }
        if (pc?.need?.length) { self.push({ type: 'note', text: `/${pc.server}:${pc.prompt} needs ${pc.need.join(' and ')}: /${pc.server}:${pc.prompt} ${pc.need.map((n) => `${n}=…`).join(' ')}`, tone: 'warn' }); break; }
        if (pc) {
          if (busy) { self.flash('Wait for Agentic Coder to finish, or press esc first'); break; }
          let got;
          try { got = promptText(await self.mcpHub.prompt(pc.server, pc.prompt, pc.args)); } catch (e) { self.push({ type: 'note', text: `${pc.server}'s prompt ${pc.prompt} could not be had: ${e.message}.`, tone: 'warn' }); break; }
          if (!got) { self.push({ type: 'note', text: `${pc.server}'s prompt ${pc.prompt} came back empty.`, tone: 'warn' }); break; }
          self.push({ type: 'note', text: `${pc.server}'s prompt “${pc.prompt}”${Object.keys(pc.args).length ? ` with ${Object.entries(pc.args).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''} · sent as your message`, tone: 'dim' });
          self.sendPrompt(got, line, { fromServer: pc.server });
          break;
        }
        self.push({ type: 'note', text: `Unknown command /${cmd}. /settings has the ones not in the / menu, and /help lists them all.`, tone: 'warn' });
      }
    }
  };
  return { runSlashFn };
}
