// The window's panels, /permissions (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { homedir } from 'node:os';
import { screenAccess } from '../tools/screen.mjs';
import { summary as permSummary } from './perms.mjs';

export function panelsPermissions(self, own) {
  // /permissions alone: its five rows, each with what it holds now; enter opens
  // one (a list, or the start-up mode picker) by running its typed form.
  const openPermissions = () => {
    const at = self.agent.cwd;
    const v = permSummary(at, { session: self.agent.allowedPrefixes });
    const rows = [
      { name: 'permissions mode', label: 'Start-up mode', value: v.mode, note: 'what it starts in; /mode changes one conversation' },
      { name: 'permissions allow', label: 'Runs without asking', value: v.allow, note: 'on top of commands that only read' },
      { name: 'permissions never', label: 'Never runs', value: v.never, note: 'every mode; a commit always asks' },
      { name: 'permissions protect', label: 'Protected files', value: v.protect, note: 'always ask before a change, even in Accept edits and Auto' },
      { name: 'permissions folders', label: 'Trusted folders', value: v.folders, note: 'folders you said yes to in the safety check' },
      // The Screen tool (tools/screen.mjs): /screen, typed in full, is the same.
      { name: 'screen', label: 'Screen', value: process.platform !== 'darwin' ? 'Mac only' : `${screenAccess() ? 'allowed' : 'not allowed yet'} · ${self.agent.canSee || self.agent.mayLook?.() ? 'model sees' : 'model is blind'}`, note: 'the model may look at an app or the whole screen; each app asks once' },
    ];
    self.setPicker({ kind: 'settings', title: 'Permissions', blurb: `Saved for ${at.replace(homedir(), '~')}. Each row opens; /permissions test <command> tries one.`, groups: [{ group: 'What Agentic Coder may do here', rows }], rows, index: 0 });
  };
  return { openPermissions };
}
