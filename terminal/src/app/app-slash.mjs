// The window's slash commands (App.jsx): runSlash, every /command typed or picked from the / menu.
// The functions are the App's own, moved word for word into one file a group of commands (slash-*.mjs): the
// App's names (and App.jsx's) are read through self, which App makes at each render, so a function sees the
// values of the render that made it.
import { promptCommand, promptText } from '../agent/mcp.mjs';
import { SESSION_COMMANDS, slashSession } from './slash-session.mjs';
import { SETUP_COMMANDS, slashSetup } from './slash-setup.mjs';
import { DESIGN_COMMANDS, slashDesign } from './slash-design.mjs';
import { PANELS_COMMANDS, slashPanels } from './slash-panels.mjs';
import { MODEL_COMMANDS, slashModel } from './slash-model.mjs';
import { TOOLS_COMMANDS, slashTools } from './slash-tools.mjs';
import { WINDOW_COMMANDS, slashWindow } from './slash-window.mjs';

const PARTS = [
  { commands: SESSION_COMMANDS, run: slashSession },
  { commands: SETUP_COMMANDS, run: slashSetup },
  { commands: DESIGN_COMMANDS, run: slashDesign },
  { commands: PANELS_COMMANDS, run: slashPanels },
  { commands: MODEL_COMMANDS, run: slashModel },
  { commands: TOOLS_COMMANDS, run: slashTools },
  { commands: WINDOW_COMMANDS, run: slashWindow },
];

export function slashPart(self) {
  const parts = PARTS.map((p) => ({ commands: p.commands, run: p.run(self) }));
  const runSlashFn = async (line) => {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const busy = self.agent.busy;
    // Each group of commands has its own file (slash-*.mjs); a command none has is a server's prompt, or unknown.
    const part = parts.find((p) => p.commands.includes(cmd));
    if (part) return part.run(cmd, arg, busy, line);
    switch (cmd) {
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
