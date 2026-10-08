// The window as the model drives it (agent/tools.mjs appTool; the owner's pick, 8 Oct 2026): when
// Agentic Coder works on itself (Bypass permissions on the Claude API, permissions.mjs isSelf), the
// App tool runs a slash command as the user would type it, reads or changes a setting, and restarts
// the app on the code in its repo. App.jsx hands appBridge(self) to the Agent as agent.app.
import { readFileSync } from 'node:fs';
import { thinkingLevel } from '../../../models/index.mjs';
import { saveSettings, SETTINGS_FILE } from './store.mjs';
import { canRestart } from './update.mjs';

// What a resumed conversation is told after the restart (its first message, from the app).
export const RESTARTED_PROMPT = '(Agentic Coder restarted on the code you changed, and this conversation picked up where it was. Say in one or two lines what you changed and that it works; if the start showed a problem, fix it.)';
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
    // Start again on the code in the repo now (the launcher builds it), with this conversation and a
    // first message that says it restarted (RESTARTED_PROMPT). Unlike /update, no new commit is needed.
    async restart(reason) {
      const w = self.updateRef.current;
      if (!w?.repo) return { error: 'This window does not run from the Agentic Coder repo (the coding command), so it cannot restart on new code.' };
      if (!canRestart()) return { error: 'This window was not started by the coding command, so it cannot restart itself; tell the user to quit and start it again.' };
      self.push({ type: 'note', text: `↻ Restarting on the new code${reason ? `: ${reason}` : ''}…`, tone: 'dim' });
      const s = self.sessionRef.current;
      const level = thinkingLevel(self.model, self.thinking, self.effort).id;
      const args = [
        '--resume', s.id,
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

