// The window's small helpers (App.jsx): the spinner's words and the turn's end words, the prompt box's
// examples, paths written with ~, a model server let go of, and the files a prompt names with @.
import { homedir } from 'node:os';
import { existsSync, statSync } from 'node:fs';
import { resolvePath } from '../agent/tools.mjs';
import { liveUsers, stopServer, scanServers } from '../../../models/index.mjs';
import { droppedFiles, ATTACH_TOKEN } from '../agent/images.mjs';
import { isImage, isPdf, preparedImage, pdfText } from '../tools/media.mjs';
import { readFile } from '../tools/read.mjs';

// The spinner's verb for a turn and its past tense for the line left behind
// when the turn ends ("⠿ Baked for 41s · done 12:58 PM"), as Claude Code does.
export const VERBS = [['Whittling', 'Whittled'], ['Untangling', 'Untangled'], ['Kneading', 'Kneaded'], ['Sifting', 'Sifted'], ['Scheming', 'Schemed'], ['Distilling', 'Distilled'], ['Spelunking', 'Spelunked'], ['Fermenting', 'Fermented'], ['Doodling', 'Doodled'], ['Juggling', 'Juggled']];
// A turn's end line when it did not finish its job (rail.jsx); the note before it says why.
export const END_WORDS = { stuck: 'Stopped: it was stuck', limit: 'Stopped at the step limit', error: 'Stopped by an error', declined: 'Stopped: you said no' };
export const PLACEHOLDERS = ['Try "explain what this project does"', 'Try "add a test for …"', 'Try "fix the failing tests"', 'Try "find where … is set"'];
export const IDLE = { phase: 'idle' };
// Big-model mode's note in few words: a row's new value as "12 tries", "the model decides" (limits.mjs show).
export const BIG_WORDS = { way: (v) => `the ${v.toLowerCase()} decides`, tries: (v) => `${v} tries`, steps: (v) => `${v} steps`, outputLines: (v) => `${v.replace(' lines', '')}-line output` };
export const INIT_PROMPT = 'Look through this project and write an AGENTS.md at its root for a coding assistant: what the project is, how to run it and its tests, the main folders and files, and conventions you notice in the code. Keep it under 60 lines. If an AGENTS.md already exists, improve it instead.';
export const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

export const home = homedir();
// A path as you would write it: ~ for your home folder.
export const tildeOf = (p) => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
export const short = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
// A stopped server's process really gone (false after `ms`): two copies of the model never fit side by side.
export async function exited(pid, ms = 15000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 200))) {
    try { process.kill(pid, 0); } catch { return true; }
  }
  return false;
}

// A window lets go of a model server: stopped when no other window uses it (a copy kept loaded
// by an earlier window, which this one only joined, is stopped too), else left to the others.
// The deciding steps run at once, so a window closing as it calls this still frees the memory.
// Answers { others: windows still on it, done: settles once the process has gone }.
export function letGo(srv) {
  if (!srv) return { others: 0, done: Promise.resolve() };
  const port = srv.port;
  const others = port ? liveUsers(port).filter((p) => p !== process.pid).length : 0;
  const joined = !others && srv.shared ? scanServers().find((e) => e.port === port && e.pid === srv.shared.pid) : null;
  const stopped = srv.stop({ keep: others > 0 });
  if (joined) stopServer(joined);
  return { others, done: stopped.then(() => (joined ? exited(joined.pid) : true)) };
}

// A remote's settings as a window keeps them for its after-close memory save: everything but a key
// typed in (the key itself stays in the Keychain; `key` says only whether there is one).
export const remoteConfOf = (r) => (r ? { ...r, key: Boolean(r.key) } : null);

// "@path" in a prompt attaches that file for the model.
// @picture.png and @doc.pdf too: a picture is attached as a picture (images), a
// PDF as its text. A file dragged into the window (its path) and a pasted or
// dropped one ([Image #n], [PDF #n]: `pasted`, n → its copy) count the same way;
// `from` (n → where a dropped one was) tells the model where it came from.
export function expandMentions(value, cwd, maxChars, pasted = new Map(), from = new Map()) {
  const attached = [];
  const images = [];
  let extra = '';
  const addPdf = (abs, shown) => {
    try {
      const pages = pdfText(abs);
      const body = pages.map((t, i) => `--- page ${i + 1} of ${pages.length} ---\n${t.trim() || '(no text on this page: a scan or a picture)'}`).join('\n');
      attached.push({ path: shown, label: `PDF, ${pages.length} page${pages.length === 1 ? '' : 's'}` });
      extra += `\n\n<file path="${shown}">\n${body.slice(0, maxChars)}\n</file>`;
    } catch (e) { attached.push({ path: shown, label: `not read: ${e.message}` }); }
  };
  const addImage = (abs, shown) => {
    try { const img = preparedImage(abs); images.push({ ...img, path: shown }); attached.push({ path: shown, label: `picture, ${img.srcW}×${img.srcH}` }); } catch (e) { attached.push({ path: shown, label: `not a picture it can open: ${e.message}` }); }
  };
  const chips = new Set();
  for (const m of value.matchAll(ATTACH_TOKEN)) {
    const n = Number(m[2]);
    const file = pasted.get(n);
    if (chips.has(n) || !file || !existsSync(file)) continue;
    chips.add(n);
    const was = from.get(n);
    const shown = was?.startsWith(homedir()) ? `~${was.slice(homedir().length)}` : was;
    if (isPdf(file)) addPdf(file, shown ?? m[0]); else addImage(file, m[0]);
    if (shown) extra += `\n\n(${m[0]} is ${shown}, dropped into the window.)`;
  }
  for (const d of droppedFiles(value, cwd)) {
    const shown = d.path.startsWith(homedir()) ? `~${d.path.slice(homedir().length)}` : d.path;
    if (d.kind === 'image') addImage(d.path, shown); else addPdf(d.path, shown);
  }
  for (const m of value.matchAll(/(^|\s)@([^\s]+)/g)) {
    // "@invoice.pdf?" names invoice.pdf: punctuation after a name that is not part of the file.
    let p = resolvePath(cwd, m[2]);
    if (!existsSync(p.abs) && /[?!.,;:)\]'"]+$/.test(m[2])) p = resolvePath(cwd, m[2].replace(/[?!.,;:)\]'"]+$/, ''));
    if (!p.inside || !existsSync(p.abs) || statSync(p.abs).isDirectory()) continue;
    if (isImage(p.abs)) { addImage(p.abs, p.rel); continue; }
    if (isPdf(p.abs)) { addPdf(p.abs, p.rel); continue; }
    const r = readFile(p.abs, { limit: 400 });
    if (r.text.includes('\u0000')) continue;
    attached.push({ path: p.rel, lines: r.lineCount });
    extra += `\n\n<file path="${p.rel}">\n${r.numbered.slice(0, maxChars)}\n</file>`;
  }
  return { text: value + extra, attached, images };
}

// The App's names for the functions in its parts (App.jsx's self): each a getter that reads the name when a
// function uses it, in the render that made the function; `set` holds the few the functions also write.
export const liveView = (get, set = {}) => Object.defineProperties({}, Object.fromEntries(Object.entries(get).map(([k, g]) => [k, { get: g, ...(set[k] ? { set: set[k] } : {}), enumerable: true }])));
