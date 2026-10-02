// The Screen tool: a picture of one app's window, or of the whole screen, for a
// model that can look at pictures. It only looks: nothing is clicked or typed.
// macOS decides whether this terminal may take the picture (Screen Recording,
// System Settings → Privacy & Security); the media helper asks it
// (media-tool.swift screen-access / windows) and macOS's own screencapture
// takes it, so nothing new is installed. Which apps the model may look at is
// asked in permissions.mjs (Screen(App) rules), once per app.
//
// AGENTIC_SCREEN_FAKE=<folder> stands in for the screen (the tests, the
// preview): access.txt says yes or no, windows.json is the window list, and
// <id>.png / screen.png are the pictures.
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mediaTool, preparedImage } from './media.mjs';

const fake = () => process.env.AGENTIC_SCREEN_FAKE || null;
const helper = (args) => {
  const r = spawnSync(mediaTool(), args, { encoding: 'utf8', timeout: 15_000 });
  if (r.status !== 0) throw new Error(String(r.stderr || r.error?.message || 'the screen helper failed').trim().split('\n')[0]);
  return r.stdout.trim();
};

// The app this window runs in, for the setup words: macOS gives Screen Recording to it.
export const terminalApp = () => ({ Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm', vscode: 'Visual Studio Code', WezTerm: 'WezTerm', ghostty: 'Ghostty', WarpTerminal: 'Warp' })[process.env.TERM_PROGRAM] ?? 'your terminal app';

// Whether a picture can be taken now (no dialog is shown).
export function screenAccess() {
  if (process.platform !== 'darwin') return false;
  const f = fake();
  if (f) return existsSync(join(f, 'access.txt')) && readFileSync(join(f, 'access.txt'), 'utf8').trim() === 'yes';
  try { return helper(['screen-access']) === 'yes'; } catch { return false; }
}

// /screen setup: macOS's own question (shown once per app; after a no, only System
// Settings can change it), then the Settings page itself.
export function askScreenAccess() {
  if (fake()) return screenAccess();
  let ok = false;
  try { ok = helper(['screen-ask']) === 'yes'; } catch {}
  if (!ok) spawnSync('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'], { stdio: 'ignore', timeout: 10_000 });
  return ok;
}

// The windows on screen, front to back: { front, windows: [{ id, app, title, x, y, w, h }] }.
// Windows parked off screen (x or y far negative) are left out.
export function screenWindows() {
  const f = fake();
  const raw = f ? readFileSync(join(f, 'windows.json'), 'utf8') : helper(['windows']);
  const j = JSON.parse(raw);
  return { front: j.front ?? '', windows: (j.windows ?? []).filter((w) => w.x + w.w > 0 && w.y + w.h > 0) };
}

// The app's open window the model means: its name in any case, or a part of it ("chrome").
export function findWindow(app, list) {
  const want = String(app ?? '').trim().toLowerCase();
  if (!want) return null;
  const of = (fn) => list.find((w) => fn(String(w.app).toLowerCase()));
  return of((a) => a === want) ?? of((a) => a.startsWith(want)) ?? of((a) => a.includes(want)) ?? null;
}

// The apps with a window open, by name, once each, front first.
export const openApps = (list) => [...new Set(list.map((w) => w.app).filter(Boolean))];

// Take the picture: { image, app, size } or { error }. app: one app's window (its front one),
// else the whole main screen. The picture goes to the model no larger than media.mjs's MAX_SIDE.
export function takeScreen({ app } = {}) {
  if (process.platform !== 'darwin') return { error: 'Looking at the screen works on a Mac only.' };
  if (!screenAccess()) return { error: 'setup', why: `macOS has not let ${terminalApp()} take pictures of the screen yet (Screen Recording).` };
  let list;
  try { list = screenWindows(); } catch (e) { return { error: `The window list could not be read (${e.message}).` }; }
  const win = app ? findWindow(app, list.windows) : null;
  if (app && !win) {
    const open = openApps(list.windows);
    return { error: `No window of "${app}" is open. ${open.length ? `Apps with a window open now: ${open.join(', ')}.` : 'No app has a window open.'}` };
  }
  const f = fake();
  const out = join(tmpdir(), `agentic-screen-${process.pid}-${Date.now()}.png`);
  try {
    if (f) copyFileSync(join(f, win ? `${win.id}.png` : 'screen.png'), out);
    else {
      // -x: no sound; -o: no window shadow; -l: that window; -m: the main screen only.
      const r = spawnSync('/usr/sbin/screencapture', ['-x', ...(win ? ['-o', '-l', String(win.id)] : ['-m']), out], { encoding: 'utf8', timeout: 20_000 });
      if (r.status !== 0 || !existsSync(out)) return { error: `macOS could not take the picture (${String(r.stderr || 'screencapture failed').trim()}).` };
    }
    const image = preparedImage(out);
    return { image, app: win?.app ?? null, title: win?.title ?? '', size: `${image.srcW}×${image.srcH}` };
  } catch (e) {
    return { error: `The picture could not be made (${e.message}).` };
  } finally { rmSync(out, { force: true }); }
}
