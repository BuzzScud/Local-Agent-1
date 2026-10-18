// The window as the model drives it (agent/tools.mjs appTool; the owner's pick, 8 Oct 2026): when
// Agentic Coder works on itself (Bypass permissions on the Claude API, permissions.mjs isSelf), the
// App tool runs a slash command as the user would type it, reads or changes a setting, and restarts
// the app on GitHub's main (main, always, 18 Oct 2026: a change of its own code is in it once pushed).
// App.jsx hands appBridge(self) to the Agent as agent.app.
import { readFileSync } from 'node:fs';
import { thinkingLevel } from '../../../models/index.mjs';
import { saveSettings, SETTINGS_FILE } from './store.mjs';
import { canRestart, folderArgs, notOnMain } from './update.mjs';
import { RESTARTED_PROMPT } from '../agent/self.mjs';
// Keys the model does not set here: the mode has /mode (and the permission checks around it).
const NOT_SET = new Set(['mode', 'lastMode']);

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const set = (obj, path, value) => { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; } o[ks.at(-1)] = value; };

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
      let file;
      try { file = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')); } catch { file = {}; }
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
      // The tool's answer lands in the conversation first (agent-step), then the window leaves.
      setTimeout(async () => {
        self.abortRef.current?.abort();
        if (!s.title) s.title = reason || 'Agentic Coder working on itself';
        self.saveNow();
        self.onRestart?.(args);
        self.setLeaving(true);
        const srv = self.serverRef.current;
        self.serverRef.current = null;
        await srv?.stop({ keep: true });
        self.exit();
      }, 400);
      return { ok: true };
    },
  };
}

