// The slash commands of how it works: /effort, /mode, /memory, /rules, /helpers, /hooks, /init (app-slash.mjs sends each its own).
// Moved word for word out of runSlashFn's switch: the same cases, in the same order.
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { helpersEnv, helperRows, changeHelpers } from './helpers.mjs';
import { changeHooks, leanEnv } from '../agent/way.mjs';
import { modeOf } from '../agent/permissions.mjs';
import { thinkingLevel, embedderReady, Embedder } from '../../../models/index.mjs';
import { MODE_OPTIONS } from './help.mjs';
import { memoryDirs, healthLine, health, undoSave, readFacts, readLog } from '../agent/facts.mjs';
import { rulesList, ALWAYS_MAX, changeRules, looksLikeEvent } from './rules.mjs';
import { notesCount, notesDir } from '../agent/claude-notes.mjs';
import { packState } from '../agent/claude-pack.mjs';
import { saveSettings } from './store.mjs';
import { INIT_PROMPT, short } from './app-common.mjs';

export const SETUP_COMMANDS = ['effort', 'think', 'mode', 'memory', 'rules', 'helpers', 'hooks', 'init'];

export function slashSetup(self) {
  return async (cmd, arg, busy, line) => {
    switch (cmd) {
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
    }
  };
}
