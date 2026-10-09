// The slash commands of the conversation: /help, /clear, /btw, /agents, /jobs, /loop, /jumptomac, /morning, /compact (app-slash.mjs sends each its own).
// Moved word for word out of runSlashFn's switch: the same cases, in the same order.
import { capLines } from '../tools/jobs.mjs';
import { newSessionId, listSessions } from './store.mjs';
import { MAC_NAME } from './jump-box.mjs';
import { isLoopCommand } from './loops.mjs';
import { runMorning, summary as morningSummary } from '../morning/index.mjs';
import { complete } from '../flows/llm.mjs';
import { STAGES as AGENT_STAGES } from '../agent/agents-run.mjs';
import { savedRun } from '../agent/agents-driver.mjs';
import { IDLE, short } from './app-common.mjs';

export const SESSION_COMMANDS = ['help', 'clear', 'btw', 'agents', 'jobs', 'loop', 'loops', 'jumptomac', 'morning', 'compact'];

export function slashSession(self) {
  return async (cmd, arg, busy, line) => {
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
          self.setOpenGroups(new Set());
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
        // One command for loops (9 Oct 2026, the owner: "can we make 1 command for it all?"): /loop alone opens
        // the board as this window's screen (the cards, or the Library with no loop yet); /loop <a sentence>
        // ("run the tests every 10 min until 6pm") opens the wizard's last step filled in from it, and /loop <a kept
        // loop's name> loads that loop there, to look at and start (loops-board.mjs openFromChat). /loops typed
        // does the same. What follows is done here without opening anything.
        const m = self.loopsOf();
        const a = arg.trim();
        const sub = /^(stop|pause|run)\s*(all|\d+)?$/i.exec(a);
        if (sub) {
          const what = sub[1].toLowerCase();
          const which = !sub[2] || sub[2].toLowerCase() === 'all' ? m.open : [m.loop(Number(sub[2]))].filter(Boolean);
          const did = which.filter((l) => (what === 'stop' ? m.stop(l.id) : what === 'pause' ? m.pause(l.id) : m.runNow(l.id)));
          self.setLoopsBadge(self.loopsBadgeOf(m));
          self.push({ type: 'note', text: did.length ? `${{ stop: 'Stopped', pause: 'Paused, or going again', run: 'Running now' }[what]}: ${did.map((l) => l.name).join(', ')}.` : 'No such loop here. /loop shows them.', tone: did.length ? 'dim' : 'warn' });
          break;
        }
        // /loop <n> <rule>: one loop's rules, or one thing done to it (loops.mjs loopCommand). Undo takes a moment.
        if (isLoopCommand(a)) {
          const said = (r) => { self.setLoopsBadge(self.loopsBadgeOf(m)); self.push({ type: 'note', text: r.error ?? r.text, tone: r.error ? 'warn' : 'dim' }); };
          const r = m.command(a);
          if (r?.then) r.then(said); else said(r);
          break;
        }
        self.openLoops({ arg: a });
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
    }
  };
}
