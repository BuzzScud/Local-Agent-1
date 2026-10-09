// The slash commands of the panels: /settings, /permissions, /copy, /rewind, /resume, /web, /mcp, /screen, /remote (app-slash.mjs sends each its own).
// Moved word for word out of runSlashFn's switch: the same cases, in the same order.
import { recentOf } from './home-nav.mjs';
import { screenAccess, terminalApp, askScreenAccess } from '../tools/screen.mjs';
import { remoteLabel, DEFAULT_REMOTE, sourceOf } from '../../../models/index.mjs';
import { othersIn, projectOf } from './copies.mjs';
import { readyRemote, remotesOf } from './remote-form.mjs';
import { listSessions, saveSettings } from './store.mjs';
import { changePermissions } from './perms.mjs';

export const PANELS_COMMANDS = ['settings', 'permissions', 'copy', 'rewind', 'resume', 'web', 'mcp', 'screen', 'remote'];

export function slashPanels(self) {
  return async (cmd, arg, busy, line) => {
    switch (cmd) {
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
    }
  };
}
