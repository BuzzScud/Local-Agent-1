// The window as the model drives it (agent/tools.mjs appTool; the owner's pick, 8 Oct 2026): when
// Agentic Coder works on itself (Bypass permissions on the Claude API, permissions.mjs isSelf), the
// App tool runs a slash command as the user would type it, reads or changes a setting, and restarts
// the app on GitHub's main (main, always, 18 Oct 2026: a change of its own code is in it once pushed).
// App.jsx hands appBridge(self) to the Agent as agent.app.
import { thinkingLevel } from '../../../models/index.mjs';
import { saveSettings, readSettingsFile } from './store.mjs';
import { canRestart, folderArgs, notOnMain } from './update.mjs';
import { RESTARTED_PROMPT } from '../agent/self.mjs';
// Keys the model does not set here: the mode has /mode (and the permission checks around it).
const NOT_SET = new Set(['mode', 'lastMode']);

// A key path's parts: own keys only. __proto__, constructor and prototype would reach the objects every object is built
// from (a setting('__proto__.x', …) changed Object.prototype, and __proto__.mode got past NOT_SET); null for those.
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const partsOf = (path) => { const ks = String(path).split('.'); return ks.some((k) => UNSAFE.has(k)) ? null : ks; };
const get = (obj, path) => partsOf(path).reduce((o, k) => (o == null || !Object.hasOwn(o, k) ? undefined : o[k]), obj);
const set = (obj, path, value) => { const ks = partsOf(path); let o = obj; for (const k of ks.slice(0, -1)) { if (!Object.hasOwn(o, k) || o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; } o[ks.at(-1)] = value; };

export function appBridge(self) {
  return {
    // The notes the screen showed while the command ran (pushFn tells tapRef), in order.
    async command(line) {
      const notes = [];
      self.tapRef.current = notes;
      try { await self.runSlash(line); await new Promise((r) => setTimeout(r, 50)); } finally { self.tapRef.current = null; }
      return { notes };
    },
    // settings.json as it is on disk (the file, not this window's copy): one key, or all of it.
    async setting(key, value) {
      if (key && !partsOf(key)) return { error: `${key} is not a setting: __proto__, constructor and prototype are not keys of settings.json.` };
      // A file that cannot be read is never written over (store.mjs saveSettings): said, not read as empty.
      const { data: file, broken } = readSettingsFile();
      if (broken) return { error: `settings.json cannot be read (${broken}): it is left as it is, and nothing is saved to it until it is fixed.` };
      if (value === undefined) return { value: key ? get(file, key) : file };
      if (!key) return { error: 'Say which key to set (key), or leave value out to read them all.' };
      if (NOT_SET.has(key.split('.')[0])) return { error: `${key} is not set here: use /mode (action command) to change the mode.` };
      const was = get(file, key);
      let v = value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* a plain string stays as it is */ } }
      set(file, key, v);
      try { saveSettings(file); } catch (e) { return { error: `settings.json could not be saved: ${e.message}` }; }
      return { was, value: v, note: 'Saved to settings.json; a window reads most keys when it starts, so a restart (action restart) or a new window picks it up.' };
    },
    // Start again on GitHub's main now (the launcher builds it), with this conversation and a first
    // message that says it restarted (RESTARTED_PROMPT). The app is built from main only, so a change of
    // the app's code that is still only in the folder (`files`: those of this turn; else any) would not be
    // in it: then it does not restart, and says to push first.
    async restart(reason, { files } = {}) {
      const w = self.updateRef.current;
      if (!w?.repo) return { error: 'This window does not run from the Agentic Coder repo (the coding command), so it cannot restart on new code.' };
      if (!canRestart()) return { error: 'This window was not started by the coding command, so it cannot restart itself; tell the user to quit and start it again.' };
      if (process.env.AGENTIC_BUILD) {
        const mine = await notOnMain(w.repo, files).catch(() => []);
        if (mine.length) return { error: `${mine.length === 1 ? mine[0] : `${mine.length} files of the app (${mine.slice(0, 3).join(', ')}${mine.length > 3 ? ' …' : ''})`} ${mine.length === 1 ? 'is' : 'are'} not on GitHub's main yet, and the coding command runs main only: commit and push to main, then restart (/update). To try it before that: bun run start in the repo.` };
      }
      self.push({ type: 'note', text: `↻ Restarting on the new code${reason ? `: ${reason}` : ''}…`, tone: 'dim' });
      const s = self.sessionRef.current;
      const level = thinkingLevel(self.model, self.thinking, self.effort).id;
      const args = [
        '--resume', s.id,
        ...folderArgs(self.cwd, self.opts.cwd),
        ...(self.opts.url ? ['--url', self.opts.url] : []),
        ...(self.opts.flows === false ? ['--no-flows'] : []),
        ...(self.opts.way ? ['--way', self.opts.way] : []),
        ...(self.opts.ctx ? ['--ctx', String(self.opts.ctx)] : []),
        ...(['low', 'medium', 'high'].includes(level) ? ['--effort', level] : []),
        ...(!self.opts.url && !self.remoteRef.current.on && self.serverRef.current?.port ? ['--start'] : []),
        RESTARTED_PROMPT,
      ];
      // The tool's answer lands in the conversation first (agent-step), then the window leaves: once (a quit or another
      // restart meanwhile wins), and whatever fails on the way the window still goes (a rejection here was unhandled,
      // and an unhandled rejection ends a Bun program before its server is let go).
      setTimeout(async () => {
        if (self.quittingRef?.current) return;
        if (self.quittingRef) self.quittingRef.current = true;
        try {
          self.abortRef.current?.abort();
          if (!s.title) s.title = reason || 'Agentic Coder working on itself';
          try { self.saveNow(); } catch {}
          self.onRestart?.(args);
          self.setLeaving(true);
          const srv = self.serverRef.current;
          self.serverRef.current = null;
          await srv?.stop({ keep: true }).catch(() => {});
        } finally { self.exit(); }
      }, 400);
      return { ok: true };
    },
  };
}

