// The slash commands of the window: /meters, /home, /steps, /bot, /mouse, /update, /quit (app-slash.mjs sends each its own).
// Moved word for word out of runSlashFn's switch: the same cases, in the same order.
import { HOME_LOOKS, lookOf, nextLook } from './home-nav.mjs';
import { botAllowed, STEPS } from './screen-switches.mjs';
import { saveSettings } from './store.mjs';

export const WINDOW_COMMANDS = ['meters', 'home', 'steps', 'bot', 'mouse', 'update', 'exit', 'quit'];

export function slashWindow(self) {
  return async (cmd, arg, busy, line) => {
    switch (cmd) {
      case 'meters': {
        if (!arg.trim()) { self.openChoice('meters'); break; }
        self.applyChoice('meters', /^(on|show|yes)$/i.test(arg) ? 'on' : 'off');
        break;
      }
      case 'home': {
        // The start page, the Menu or the Launcher (home-looks.jsx): typed alone the other one, else the one
        // named; kept in settings.json. The page is live until your first message, so it changes in front of you.
        const asked = arg.trim().toLowerCase();
        if (asked && !HOME_LOOKS.some((l, i) => asked === l.id || asked === l.name.toLowerCase() || asked === String(i + 1))) { self.flash(`No look called ${arg.trim()}: ${HOME_LOOKS.map((l) => l.id).join(' or ')}`); break; }
        const look = asked ? lookOf(asked) : nextLook(self.S.current.homeLook); // S: this render's, not the one runSlash was made in
        self.setHomeLook(look);
        self.setHomeFocus(null);
        try { saveSettings({ homeLook: look }); } catch {}
        const { name, note } = HOME_LOOKS.find((l) => l.id === look);
        self.flash(self.holdRef.current ? `${name}: ${note} · /home again for the other` : `${name} it is: /clear shows it now, and every new window starts with it`, 6000);
        break;
      }
      case 'steps': {
        // How a reply's steps show (rail.jsx groupWork): typed alone the next one, else the one named; kept in
        // settings.json. The conversation is printed again in the new way (App.jsx viewKey).
        const w = arg.trim().toLowerCase();
        if (w && !STEPS.includes(w)) { self.flash('/steps grouped, open or words (alone: the next one)'); break; }
        const next = w || STEPS[(STEPS.indexOf(self.S.current.steps) + 1) % STEPS.length];
        self.setSteps(next);
        try { saveSettings({ steps: next }); } catch {}
        self.flash({ grouped: 'Grouped: each stretch of work is one box · a click or ctrl+o opens it', open: 'Open: every step, as before', words: 'Words: only what the model says, your messages and the end lines' }[next], 5000);
        break;
      }
      case 'bot': {
        // The bot over the prompt box (bot-layer.jsx): typed alone the other state, else the one named; kept in
        // settings.json for every window. Hidden, it waves and dives into the box; shown, it pops back out.
        const w = arg.trim().toLowerCase();
        if (w && !/^(hide|show|off|on)$/.test(w)) { self.flash('/bot hide or /bot show (alone: the other one)'); break; }
        const on = w ? w === 'show' || w === 'on' : !self.S.current.botOn; // S: this render's, not the one runSlash was made in
        self.setBotOn(on);
        try { saveSettings({ bot: on }); } catch {}
        self.flash(!botAllowed() ? 'The bot is left out of this window (AGENTIC_BOT=off); /bot is kept for the next' : on ? 'The bot is back · /bot hides it' : 'The bot is hidden · /bot brings it back', 4000);
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
    }
  };
}
