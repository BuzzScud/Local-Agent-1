// What the window keeps an eye on in the background (App.jsx, moved here on 13 Oct 2026 so each file can be read
// whole): your saved services (servicesWatch), the memory the model really uses (ramWatch), text selected in the
// prompt copied as you select it (copySelection), what the memory saved since the last window (savedSinceNote) and a
// permissions file that cannot be read (permissionsNote).
// self is the App's names, read at the moment a function uses them (app-common.mjs liveView); App.jsx runs each in
// a useEffect with the same dependencies as before.
import { savedWatch, repairNow } from './saved-services.mjs';
import { selectedText } from './edit-input.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { rulesFor } from './perm-store.mjs';
import { sinceLastTime } from './autosave.mjs';

export function watchPart(self) {
  // Your services stay saved (saved-services.mjs, 12 Oct 2026): what another window saves in settings.json is this
  // window's too within 2 s, and a service it knows that the file lost is written back; at the start, a service
  // settings.json lost (profiles.json still uses it, or its key is still kept) comes back, and a key's end is set right.
  const servicesWatch = () => {
    const tick = savedWatch(self.settings);
    const say = (lines, tone) => { for (const text of lines) self.push({ type: 'note', text, tone }); };
    const t = setInterval(() => say(tick(), 'warn'), 2000);
    t.unref?.();
    const first = setTimeout(() => {
      say(repairNow(), 'warn');
      if (process.env.AGENTIC_SEEDED === '1') {
        delete process.env.AGENTIC_SEEDED;
        say(['This copy has a home of its own and started with your services; it reads your keys from the Keychain and never writes there.'], 'dim');
      }
    }, 1500);
    first.unref?.();
    return () => { clearInterval(t); clearTimeout(first); };
  };
  // Memory the model really uses (for the Live thinking meter line).
  const ramWatch = () => {
    const model = self.model;
    // A copy shared with another window is measured too (its process is that window's).
    const read = () => { const s = self.serverRef.current; if (s?.port && (s.child || s.shared)) self.setRamGb((s.footprintBytes() + model.bytes) / 1e9); };
    const id = setInterval(read, 5000);
    const first = setTimeout(read, 1500);
    return () => { clearInterval(id); clearTimeout(first); };
  };
  // Text selected in the prompt goes to the clipboard a moment after the selection stops changing.
  const copySelection = () => {
    const input = self.input;
    const text = selectedText(input);
    if (!text || input.all) { self.copiedRef.current = ''; return undefined; }
    const t = setTimeout(() => {
      if (text === self.copiedRef.current) return;
      self.copiedRef.current = text;
      if (copyToClipboard(text)) self.flash(`copied ${text.length.toLocaleString()} char${text.length === 1 ? '' : 's'} to clipboard`, 2500);
    }, 250);
    return () => clearTimeout(t);
  };
  // What the memory saved after the last window here had closed, said once.
  const savedSinceNote = () => {
    if (!self.agent.memory) return;
    for (const line of sinceLastTime(self.cwd)) self.push({ type: 'note', text: line, tone: 'dim' });
  };
  // A permissions file that cannot be read turns every saved rule off: said once.
  const permissionsNote = () => {
    const r = rulesFor(self.cwd);
    if (r.broken) self.push({ type: 'note', text: `~/.agentic-coder/permissions.json cannot be read (${r.broken}), so none of your saved rules apply until it is fixed or deleted.`, tone: 'warn' });
  };
  return { servicesWatch, ramWatch, copySelection, savedSinceNote, permissionsNote };
}
