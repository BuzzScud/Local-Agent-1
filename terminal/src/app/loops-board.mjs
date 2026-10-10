// The loop board: the loops of one coding window, drawn as the Cards (loops-draw.mjs). /loop shows
// it in the coding window itself (App.jsx, loops-view.jsx); `coding loops` shows it in another
// terminal, where it reads what that window wrote (loops.mjs: <home>/loops/<pid>/) five times a second
// and sends its keys back as small files, so closing it changes nothing: the loops belong to their
// window and go on. The keys are the same in both (handleKey): typing always goes in the box (4 Oct
// 2026, the owner's pick after letters ate what they typed); ←→ picks a card's button and enter
// presses it (9 Oct 2026); the ctrl keys of 4 Oct still work.
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { HOME } from '../../../models/index.mjs';
import { attachDropped, attachClipboard, chipOf } from './attach.mjs';
import { droppedFiles, ATTACH_TOKEN } from '../agent/images.mjs';
import { listBoards, readState, readRun, sendCommand, runFile, rulesOf, fieldsOf, unclearOf, isLoopCommand, STEPS_WORD, PRESET, readSentence, readEvery, readRuns, readStopAt } from './loops.mjs';
import { drawBoard, ansiRow, setupChoices, setupPick, setupFields, kindOfSetup, wizardSteps, stepOf, templateOf, TEMPLATES, MORE_ROWS, buttonsOf, watchButtonsOf, splitAddress, wantsAddress, needsAddress } from './loops-draw.mjs';
import { canResize, resizeSeq } from './agents-window.mjs';
import { loadInto, setFill, startRows, shelfKey, editorKey, openEditor, openShelf } from './loops-library.mjs';
import { findByName } from './loop-files.mjs';
import { pickOnTerminal } from './pick.mjs';

const BOARD_SIZE = [168, 46];
// inApp: the board is the coding window's own screen (esc goes back to the chat).
// back: where the wizard goes on esc (the Library, or the cards); shelf: the Library's pick and what was typed
// to find; editor: the one-page form of a loop you kept (loops-library.mjs).
export const newUi = ({ inApp = false } = {}) => ({ sel: 0, btn: 0, view: 'main', watch: null, chat: { text: '', as: 'note' }, toast: null, confirm: null, stamp: null, setup: null, inApp, back: null, shelf: null, editor: null });
export const say = (ui, text, style = 'accent') => { ui.toast = { text, style, until: Date.now() + 3200 }; };
const over = (l) => l.state === 'done' || l.state === 'stopped';
const stampOf = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

// The keys in a chunk of terminal input, by name: a ctrl key is ^ and its letter.
export function keysOf(s) {
  const keys = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\x1b') {
      const m = /^\x1b(\[|O)([A-DZ])/.exec(s.slice(i));
      if (m) { keys.push({ A: 'up', B: 'down', C: 'right', D: 'left', Z: 'shiftTab' }[m[2]]); i += 2; continue; }
      const other = /^\x1b\[[\d;?<]*[A-Za-z~]/.exec(s.slice(i));
      if (other) { i += other[0].length - 1; continue; }
      keys.push('esc');
    } else if (c === '\r' || c === '\n') keys.push('enter');
    else if (c === '\t') keys.push('tab');
    else if (c === '\x7f' || c === '\b') keys.push('backspace');
    else if (c < ' ') keys.push(`^${String.fromCharCode(c.charCodeAt(0) + 64)}`);
    else keys.push(c);
  }
  return keys;
}

// A chunk of terminal input as keys and pastes: [{ keys } | { paste }]. A paste is what comes between
// the terminal's marks (\x1b[200~ … \x1b[201~, bracketed paste), across chunks too (st.pasting holds
// it meanwhile); a terminal without them sends a drop as one chunk of plain text, read as a paste. A
// chunk with an enter or another control key in it, unmarked, is keys, as typed.
export function inputParts(s, st = { pasting: null }) {
  const parts = [];
  let rest = s;
  while (rest) {
    if (st.pasting != null) {
      const end = rest.indexOf('\x1b[201~');
      if (end < 0) { st.pasting += rest; return parts; }
      parts.push({ paste: st.pasting + rest.slice(0, end) });
      st.pasting = null;
      rest = rest.slice(end + 6);
      continue;
    }
    const at = rest.indexOf('\x1b[200~');
    const before = at < 0 ? rest : rest.slice(0, at);
    if (before) parts.push([...before].length > 1 && !/[\x00-\x1f\x7f]/.test(before) ? { paste: before } : { keys: before });
    if (at < 0) break;
    st.pasting = '';
    rest = rest.slice(at + 6);
  }
  return parts;
}

// What the window said back to something sent from the board: a line at the bottom, and the loop it made picked.
export function showReply(ui, loops, r) {
  if (r == null) return;
  const text = typeof r === 'object' ? r.text : r;
  if (!text) return;
  if (typeof r === 'object' && r.made) { const i = loops.findIndex((l) => l.id === r.made); if (i >= 0) ui.sel = i; }
  say(ui, text, (typeof r === 'object' && r.warn) || /^(Only|A loop needs|A web loop)/.test(text) ? 'warn' : 'accent');
}

// ---- the setup wizard (9 Oct 2026): a new loop, or one loop's rules, a step at a time ----
// /loop alone with no loop yet, or ^N: step 1, the first example picked. /loop <a sentence>: the last
// step, filled in from what was read. Rules (a card's button, ^O): that loop's own, at the last step.
// An unclear task (loops.mjs unclearOf) is asked about at step 1 before it goes on.
export function openSetup(ui, { mode = 'ask', text = null, unclear = null, sentence = null, loop = null, state = null } = {}) {
  const f = { every: '10m', runs: 'no limit', stopAt: 'none', cap: 'none', steps: STEPS_WORD, mode, askFirst: false, kind: null, folder: null };
  const su = { step: 0, id: null, again: false, name: '', text: text ?? TEMPLATES[0].text, url: '', web: false, focus: 'text', tpl: 0, f, custom: { often: '', stop: '' }, touched: {}, unclear, pick: 0, error: null, typed: '', found: [], keep: false, rule: -1,
    loaded: null, fills: [], picture: null, save: { name: '', where: 'yours', replace: null }, pasted: { n: 0, files: new Map(), info: new Map() } };
  ui.back = ui.view === 'shelf' ? 'shelf' : null;
  if (loop) {
    const lf = fieldsOf(loop);
    Object.assign(f, { every: lf.every, runs: lf.runs, stopAt: lf.stopAt, cap: lf.cap, steps: lf.steps, mode: lf.mode, askFirst: lf.askFirst, kind: lf.kind, check: lf.check ?? null, folder: state?.places?.find((x) => x.shown === loop.folder)?.path ?? null });
    const { words, url } = splitAddress(loop.message);
    Object.assign(su, { id: loop.id, again: over(loop), name: loop.name, text: chipsBack(words, su.pasted), url, web: Boolean(url), keep: true, picture: loop.picture ?? null });
    su.touched.often = true;
    su.step = wizardSteps(su).length - 1;
  } else if (sentence != null) {
    const r = readSentence(sentence);
    if (r.error) { su.error = r.error; su.text = ''; su.tpl = TEMPLATES.length - 1; }
    else {
      Object.assign(f, { every: r.fields.every, runs: r.fields.runs, stopAt: r.fields.stopAt, kind: r.fields.kind });
      Object.assign(su, { text: r.fields.message, typed: sentence.trim(), found: r.found });
      su.touched.often = true;
      su.step = wizardSteps(su).length - 1;
    }
  }
  if (!su.touched.often) oftenFor(su);
  ui.setup = su;
  ui.view = 'setup';
}
// A picture for every run (10 Oct 2026, the owner's ask): at step 1 a screenshot dragged in, pasted as
// its path or put on the clipboard (ctrl+v) is copied at once to <home>/attachments (macOS's floating
// screenshot goes away) and shows as [Image #n] in the box, as in the prompt box (attach.mjs). The
// loop's message carries the copy's path in its place (loops-draw.mjs messageOf), and each run's
// `coding -p` sends a picture its prompt names along with it (cli.jsx).
const attachDir = () => join(HOME, 'attachments');
const pastedOf = (su) => (su.pasted ??= { n: 0, files: new Map(), info: new Map() });
// A loop's message, its copies made chips again, for its rules to change.
function chipsBack(message, pasted) {
  let out = String(message ?? '');
  const dir = attachDir();
  for (const d of droppedFiles(out, homedir(), { any: true })) {
    if (!d.path.startsWith(`${dir}/`)) continue;
    const n = ++pasted.n;
    let bytes = null;
    try { bytes = statSync(d.path).size; } catch { /* gone: the chip says so as a plain name */ }
    pasted.files.set(n, d.path);
    pasted.info.set(n, { kind: d.kind, name: basename(d.path), bytes });
    out = out.replace(d.raw, chipOf(d.kind, n));
  }
  return out;
}
// New words at step 1: the kind is read off them again, and so is how often, until you choose it; a loaded loop is yours now.
function wordsChanged(su) {
  su.f.kind = null;
  su.keep = false;
  if (su.loaded) { su.loaded = null; su.fills = []; su.picture = null; }
  su.error = null;
  oftenFor(su);
}
const isExample = (su) => TEMPLATES.some((t) => t.text && t.text === (su.text ?? '').trim());
// Words or a picture added to the box at step 1: a picture goes after your words (and an example's), with a space.
function addToBox(su, words, picture) {
  const had = picture ? su.text ?? '' : isExample(su) ? '' : su.text ?? '';
  su.text = picture && had.trim() && !/\s$/.test(had) && !/^\s/.test(words) ? `${had} ${words}` : had + words;
  wordsChanged(su);
}
// ctrl+v at step 1: the clipboard's picture.
function pasteClipboard(ui, su) {
  let got = null;
  try { got = attachClipboard({ pasted: pastedOf(su), dir: attachDir(), id: `loop-${stampOf()}` }); } catch (e) { say(ui, `Could not attach the clipboard's picture: ${e.message}`, 'warn'); return; }
  if (!got) { say(ui, 'No picture on the clipboard: copy a screenshot (ctrl+shift+cmd+4) or drag one in', 'dim'); return; }
  addToBox(su, got.token, true);
  say(ui, `Picture attached as ${got.token}: each run gets it`);
}
// Text pasted (or a file dropped: Terminal types its path) while the board has the window. At step 1 a
// picture, PDF or dropped file becomes a chip (attach.mjs attachDropped); elsewhere the text goes in
// as typed, its line breaks as spaces, so a paste never presses enter.
export function handlePaste(b, text) {
  const { ui } = b;
  const su = ui.setup;
  const clean = String(text ?? '').replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
  if (ui.view === 'setup' && su && !su.unclear && stepOf(su) === 'what') {
    // An address pasted into its box goes in as it is, on one line.
    if (su.focus === 'url' && wantsAddress(su)) { su.url += clean.replace(/\s+/g, ' ').trim(); wordsChanged(su); return; }
    const r = attachDropped(clean, { cwd: su.f.folder ?? b.state?.places?.[0]?.path ?? homedir(), pasted: pastedOf(su), dir: attachDir(), id: `loop-${stampOf()}` });
    if (r.failed.length) say(ui, `Could not attach ${basename(r.failed[0].path)}: ${r.failed[0].error}`, 'warn');
    else if (r.added.length) say(ui, r.added.length === 1 ? `${r.added[0].token} attached: each run gets it` : `${r.added.length} files attached: each run gets them`);
    const words = r.text.replace(/\s*\n\s*/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
    if (words.trim()) addToBox(su, r.added.length ? words.trim() : words, r.added.length > 0);
    return;
  }
  for (const c of [...clean.replace(/\s*\n\s*/g, ' ')]) if (c >= ' ' && c !== '\x7f') handleKey(b, c);
}
// How often, until you choose: a fixing loop until its tests pass, any other every 10 minutes.
const oftenFor = (su) => { if (!su.touched.often && !su.custom.often) su.f.every = kindOfSetup(su) === 'debug' ? 'until done' : '10m'; };
function setValue(su, row, v) {
  if (row === 'often') { su.f.every = v; su.touched.often = true; }
  else if (row === 'stop') { su.f.runs = v.runs; su.f.stopAt = v.stopAt; }
  else if (row === 'where') su.f.folder = v;
  else if (row === 'ask') su.f.askFirst = v;
  else su.f[row] = v;
}
const toStep = (su, name) => { const i = wizardSteps(su).indexOf(name); su.step = i < 0 ? 0 : i; };
// The step's answer read before going on: an error stays on the step.
function stepError(su, step) {
  if (step === 'what' && !(su.text ?? '').trim()) return 'Type what each run should do first';
  if (step === 'what' && needsAddress(su)) { su.focus = 'url'; return 'Type the address of the page to watch'; }
  if (step === 'often' && su.custom.often) return readEvery(su.custom.often, { kind: kindOfSetup(su) }).error ?? null;
  if (step === 'stop' && su.custom.stop) { const t = su.custom.stop.trim().replace(/^(at|in)\s+/i, ''); return /^\d+(\s*runs?)?$/i.test(t) ? readRuns(t).error ?? null : readStopAt(t).error ?? null; }
  return null;
}
// Enter on the last step: the loop made (or its rules saved), when its words and rules read well.
function startSetup(b) {
  const { ui, state } = b;
  const su = ui.setup;
  const fields = setupFields(su, state);
  if (!fields.message) { su.error = 'Type what each run should do first'; return toStep(su, 'what'); }
  if (needsAddress(su)) { su.error = 'Type the address of the page to watch'; su.rule = startRows(su).indexOf('url'); return; }
  if (!su.keep) { const u = unclearOf(fields.message); if (u) { su.unclear = u; su.pick = 0; return toStep(su, 'what'); } }
  const read = rulesOf(fields);
  if (read.error) { su.error = read.error; const row = { message: 'what', every: 'often', runs: 'stop', stopAt: 'stop' }[read.field]; if (row) toStep(su, row); else su.rule = startRows(su).indexOf(read.field === 'cap' ? 'cap' : 'steps'); return; }
  // A blank left empty ({page}): asked for before it starts.
  const blank = (su.fills ?? []).findIndex((x) => !x.value.trim());
  if (blank >= 0) { su.error = `Type the ${su.fills[blank].key} this loop asks for`; su.rule = blank; return; }
  const save = keptOf(su, state);
  // Said before it is sent: in the coding window the answer comes back at once and takes this line's place.
  say(ui, su.id ? (su.again ? 'Starting it again…' : 'Saving…') : state.model?.wake ? 'Making the loop and turning the model on…' : save ? 'Keeping it and making the loop…' : 'Making the loop…', 'dim');
  ui.setup = null;
  ui.view = 'main';
  ui.stamp = stampOf();
  if (su.id) { b.send({ op: 'edit', id: su.id, again: su.again, fields, stamp: ui.stamp }); if (save) b.send({ op: 'save', save }); }
  else b.send({ op: 'add', fields, save, trust: su.loaded?.from === 'project' && !su.loaded.trusted ? su.loaded.file : null, wake: Boolean(state.model?.wake), stamp: ui.stamp });
}
// What Save as keeps (loop-files.mjs), or null with no name typed: a loaded loop keeps its own words and blanks.
function keptOf(su, state) {
  const name = (su.save?.name ?? '').trim();
  if (!name) return null;
  const f = setupFields(su, state);
  const message = su.loaded?.template ?? f.message;
  return { name, about: su.loaded?.about ?? '', message, fills: su.loaded ? su.fills.map((x) => ({ ...x })) : [], picture: su.picture ?? null,
    fields: { kind: f.kind, every: f.every, runs: f.runs, stopAt: f.stopAt, cap: f.cap, steps: f.steps, mode: f.mode, askFirst: f.askFirst, ...(su.f.check ? { check: su.f.check } : {}) }, where: su.save.where, folder: f.folder, replace: su.save.replace ?? null };
}
// ^S on the last step: kept, not started.
function saveOnly(b) {
  const { ui, state } = b;
  const su = ui.setup;
  const save = keptOf(su, state);
  if (!save) { su.error = 'Type a name at Save as first'; su.rule = startRows(su).indexOf('saveName'); return; }
  say(ui, `Keeping “${save.name}”…`, 'dim');
  ui.setup = null;
  ui.view = ui.back ?? 'main';
  if (ui.view === 'main' && !state.loops.length) openShelf(ui);
  ui.stamp = stampOf();
  b.send({ op: 'save', save, stamp: ui.stamp });
}
function setupKey(b, k) {
  const { ui, state } = b;
  const su = ui.setup;
  const steps = wizardSteps(su);
  const step = stepOf(su);
  const back = () => { if (su.step > 0) { su.step--; su.error = null; su.rule = -1; } };
  const next = () => { const e = stepError(su, step); if (e) { su.error = e; return; } su.error = null; if (su.step < steps.length - 1) su.step++; };
  // esc: back to where it came from (the Library, the cards), or out of the board when there is nothing to show.
  if (k === 'esc') { ui.setup = null; ui.view = ui.back ?? 'main'; if (ui.view === 'main' && !state.loops.length) b.quit(); return; }
  if (su.unclear) {
    const n = su.unclear.options.length;
    const pick = () => {
      const o = su.unclear.options[su.pick];
      su.unclear = null;
      su.error = null;
      if (o.act === 'again') { su.text = ''; su.tpl = TEMPLATES.length - 1; return; }
      if (o.act === 'use') { su.text = PRESET[o.kind] ?? su.text; su.f.kind = o.kind; if (o.every) { su.f.every = o.every; su.touched.often = true; } else oftenFor(su); }
      su.keep = true;
      next();
    };
    if (k === 'up') su.pick = (su.pick + n - 1) % n;
    else if (k === 'down') su.pick = (su.pick + 1) % n;
    else if (/^[1-9]$/.test(k) && Number(k) <= n) { su.pick = Number(k) - 1; pick(); }
    else if (k === 'enter') pick();
    else if (k === 'left' || k === 'backspace') su.unclear = null;
    return;
  }
  if (step === 'what') {
    // A web loop's page has a box of its own: tab goes to it and back, and typing goes where it is.
    const inUrl = su.focus === 'url' && wantsAddress(su);
    if ((k === 'tab' || k === 'shiftTab') && wantsAddress(su)) { su.focus = inUrl ? 'text' : 'url'; su.error = null; return; }
    if (k === 'up' || k === 'down' || k === 'tab' || k === 'shiftTab') {
      const n = TEMPLATES.length;
      su.tpl = (templateOf(su) + (k === 'up' || k === 'shiftTab' ? n - 1 : 1)) % n;
      su.text = TEMPLATES[su.tpl].text;
      su.web = TEMPLATES[su.tpl].kind === 'web';
      if (!su.web) su.url = '';
      su.focus = 'text';
    } else if (k === 'enter') {
      if (!(su.text ?? '').trim()) { su.error = 'Type what each run should do first'; return; }
      if (!su.keep) { const u = unclearOf(su.text); if (u) { su.unclear = u; su.pick = 0; return; } }
      return next();
    } else if (k === '^V') return pasteClipboard(ui, su);
    else if (inUrl && k === 'backspace') su.url = [...su.url].slice(0, -1).join('');
    else if (inUrl && k === '^U') su.url = '';
    else if (inUrl && k.length === 1 && k >= ' ') su.url += k;
    // A chip ([Image #1]) goes in one piece.
    else if (k === 'backspace') { const chip = /\[(?:Image|PDF|File|Folder) #\d+\]$/.exec(su.text ?? ''); su.text = chip ? su.text.slice(0, chip.index) : [...su.text].slice(0, -1).join(''); }
    else if (k === '^U') su.text = '';
    // Typing over an example, as it was picked, starts your own words.
    else if (k.length === 1 && k >= ' ') su.text = (isExample(su) ? '' : su.text) + k;
    else return;
    wordsChanged(su);
    return;
  }
  if (step === 'start') {
    const rows = startRows(su);
    const at = rows[su.rule];
    if (k === 'enter') return startSetup(b);
    if (k === '^S') return saveOnly(b);
    if (k === '^E' && su.loaded && su.loaded.from !== 'ready') { const e = state.library?.find((x) => x.id === su.loaded.id); if (e) openEditor(ui, e, state); return; }
    if (k === 'up' || k === 'shiftTab') { su.rule = su.rule < 0 ? rows.length - 1 : su.rule - 1; return; }
    if (k === 'down' || k === 'tab') { su.rule = su.rule >= rows.length - 1 ? -1 : su.rule + 1; return; }
    // A blank or the name: typing goes in it.
    if (String(at).startsWith('fill:') || at === 'saveName') {
      const get = () => (at === 'saveName' ? su.save.name : su.fills[Number(at.slice(5))].value);
      const set = (v) => { if (at === 'saveName') su.save.name = v; else setFill(su, Number(at.slice(5)), v); su.error = null; };
      if (k === 'backspace') { set([...get()].slice(0, -1).join('')); return; }
      if (k === '^U') { set(''); return; }
      if (k.length === 1 && k >= ' ') { set(get() + k); return; }
      if (k === 'left') back();
      return;
    }
    // Its words or its page, typed in place: the rows may come and go as the kind is read again, so
    // the one you are on is found again by name.
    if (at === 'text' || at === 'url') {
      if (k === 'left') return back();
      if (at === 'url') {
        if (k === 'backspace') su.url = [...su.url].slice(0, -1).join('');
        else if (k === '^U') su.url = '';
        else if (k.length === 1 && k >= ' ') su.url += k;
        else return;
      } else if (k === 'backspace') { const chip = /\[(?:Image|PDF|File|Folder) #\d+\]$/.exec(su.text ?? ''); su.text = chip ? su.text.slice(0, chip.index) : [...su.text].slice(0, -1).join(''); }
      else if (k === '^U') su.text = '';
      else if (k.length === 1 && k >= ' ') su.text = (su.text ?? '') + k;
      else return;
      wordsChanged(su);
      const now = startRows(su);
      su.rule = now.includes(at) ? now.indexOf(at) : now.indexOf('text');
      return;
    }
    if (at === 'saveWhere' && (k === 'left' || k === 'right' || k === ' ')) { su.save.where = su.save.where === 'project' ? 'yours' : 'project'; su.error = null; return; }
    if ((MORE_ROWS.includes(at) || ['where', 'often', 'stop'].includes(at)) && (k === 'left' || k === 'right' || k === ' ')) {
      const cs = setupChoices(at, su, state);
      const pick = setupPick(at, su, state);
      if (at === 'often' || at === 'stop') su.custom[at] = '';
      setValue(su, at, cs[pick < 0 ? 0 : (pick + (k === 'left' ? cs.length - 1 : 1)) % cs.length][0]);
      su.error = null;
      return;
    }
    if (k === 'left' || k === 'backspace') back();
    return;
  }
  // Where, how often, until: ↑↓ picks, and the last two take what you type (7m · 20, 18:30, 2h).
  const typed = step === 'often' || step === 'stop';
  if (k === 'enter') return next();
  if (k === 'up' || k === 'down' || k === 'tab' || k === 'shiftTab') {
    const cs = setupChoices(step, su, state);
    if (!cs.length) return;
    if (typed) su.custom[step] = '';
    const at = setupPick(step, su, state);
    setValue(su, step, cs[at < 0 ? 0 : (at + (k === 'up' || k === 'shiftTab' ? cs.length - 1 : 1)) % cs.length][0]);
    su.error = null;
    return;
  }
  if (k === 'left') return back();
  if (k === 'backspace') { if (typed && su.custom[step]) { su.custom[step] = [...su.custom[step]].slice(0, -1).join(''); su.error = null; } else back(); return; }
  if (typed && k === '^U') { su.custom[step] = ''; return; }
  if (typed && k.length === 1 && k >= ' ') { su.custom[step] += k; if (step === 'often') su.touched.often = true; su.error = null; }
}

// /loop <words> in the coding window (and /loops, typed): what the board opens with. Alone, the
// cards, or the setup wizard when there is no loop yet; a sentence, the wizard's last step filled in
// to confirm it; an unclear task, the wizard's first step asking about it. Answers false for words
// that are a loop's command ("/loop stop", "/loop 2 every 7m"): the window does those itself.
export function openFromChat(ui, arg, state) {
  const a = String(arg ?? '').trim();
  const mode = state?.mode ?? 'ask';
  if (/^(stop|pause|run)\s*(all|\d+)?$/i.test(a) || (a && isLoopCommand(a))) return false;
  ui.chat = { text: '', as: 'note' };
  ui.btn = 0;
  if (!a || /^(board|open|list)$/i.test(a)) {
    if (state?.loops?.length) { ui.setup = null; if (['setup', 'editor'].includes(ui.view)) ui.view = 'main'; }
    else if (ui.view !== 'setup' && ui.view !== 'editor') openShelf(ui);
    return true;
  }
  if (/^(library|kept|saved|new)$/i.test(a)) { openShelf(ui); return true; }
  // A loop you kept, or a ready-made one, by its name: loaded at the last step to check.
  const kept = findByName(state?.library ?? [], a);
  if (kept) { loadInto(ui, kept, state); return true; }
  const u = unclearOf(a);
  openSetup(ui, u ? { mode, text: a, unclear: u } : { mode, sentence: a });
  return true;
}

// ---- the buttons: what pressing one does (loops-draw.mjs buttonsOf) ----
function press(b, l, id) {
  const { ui, state } = b;
  if (!id) return;
  if (id === 'back') { ui.view = 'main'; ui.watch = null; ui.btn = 0; return; }
  if (!l) return;
  const q = l.current?.needs;
  if (/^pick\d$/.test(id)) {
    const opt = q?.options?.[Number(id.slice(4)) - 1];
    if (opt) { b.send({ op: 'answer', id: l.id, choice: 'yes', text: opt }); say(ui, `${l.name}: you picked “${opt}”`); }
    return;
  }
  if (id === 'yes' || id === 'always' || id === 'no') {
    b.send({ op: 'answer', id: l.id, choice: id });
    say(ui, id === 'no' ? `${l.name}: you said no` : id === 'always' ? `${l.name}: yes, and it will not ask this again` : `${l.name}: yes`);
    return;
  }
  if (id === 'go' || id === 'skip') { b.send({ op: id, id: l.id }); say(ui, id === 'go' ? `${l.name}: run ${l.ready?.n ?? ''} starts` : `${l.name}: that run is left out`); return; }
  if (id === 'rules') { openSetup(ui, { loop: l, state, mode: state.mode ?? 'ask' }); return; }
  // Save: its rules page, the name box picked (Save as keeps a copy to load again).
  if (id === 'save') { openSetup(ui, { loop: l, state, mode: state.mode ?? 'ask' }); ui.setup.rule = startRows(ui.setup).indexOf('saveName'); ui.setup.save.name = l.name; ui.watch = null; return; }
  if (id === 'again') { ui.stamp = stampOf(); b.send({ op: 'typed', text: `/loop ${l.id} again`, id: l.id, stamp: ui.stamp }); say(ui, `${l.name}: starting again…`, 'dim'); return; }
  if (id === 'wake') { ui.stamp = stampOf(); b.send({ op: 'wake', stamp: ui.stamp }); say(ui, 'Turning the model on…', 'dim'); return; }
  if (id === 'older' || id === 'newer') {
    const runs = [...l.runs, ...(l.current ? [l.current] : [])].map((r) => r.n);
    const at = ui.watch?.n ? runs.indexOf(ui.watch.n) : runs.length - 1;
    if (id === 'older' && at > 0) { ui.watch.n = runs[at - 1]; ui.watch.scroll = 0; }
    else if (id === 'newer' && at >= 0 && at < runs.length - 1) { ui.watch.n = at + 1 >= runs.length - 1 ? null : runs[at + 1]; ui.watch.scroll = 0; }
    else say(ui, id === 'older' ? 'This is its first run' : 'This is its newest run', 'dim');
    return;
  }
  const key = { run: '^R', pause: '^P', stop: '^S', undo: '^B', open: '^G', redo: '^X' }[id];
  if (key) { if (id === 'open') ui.btn = 0; handleKey(b, key); }
}

// ---- the box: what enter does with the words typed ----
function send(b, l) {
  const { state, ui } = b;
  const text = ui.chat.text.trim();
  const as = ui.chat.as ?? 'note';
  if (!text) { if (as !== 'note' && l && !over(l)) say(ui, 'Type what it should do differently first, then enter', 'dim'); return; }
  ui.chat.text = '';
  ui.chat.as = 'note';
  // A /loop line: a sentence opens the wizard's last step to confirm, an unclear one its first; "/loop 2 every 7m" goes to the window.
  if (/^\/loops?\b/i.test(text)) {
    const rest = text.replace(/^\/loops?\s*/i, '');
    if (!rest) { openSetup(ui, { mode: state.mode ?? 'ask' }); return; }
    if (isLoopCommand(rest)) { ui.stamp = stampOf(); b.send({ op: 'typed', text, id: l?.id ?? null, stamp: ui.stamp }); say(ui, 'Sent', 'dim'); return; }
    openFromChat(ui, rest, state);
    return;
  }
  if (!l) { ui.chat.text = text; say(ui, 'No loop yet: ^N makes one, or type /loop and what it should do', 'warn'); return; }
  const q = l.current?.needs;
  if (q) {
    // A question: a number picks one of its choices, other words are the answer.
    if (q.kind === 'question') {
      const num = /^[1-9]$/.test(text);
      const opt = num ? q.options?.[Number(text) - 1] : null;
      if (num && !opt) { ui.chat.text = text; say(ui, `It gave ${q.options?.length || 'no'} choices`, 'dim'); return; }
      b.send({ op: 'answer', id: l.id, choice: 'yes', text: opt ?? text });
      say(ui, opt ? `${l.name}: you picked “${opt}”` : `Answered ${l.name}`);
      return;
    }
    // A step to allow: y, a (always) or n; anything else goes to it as a note, and it still asks.
    const choice = /^(y|yes)$/i.test(text) ? 'yes' : /^(a|always)$/i.test(text) ? 'always' : /^(n|no)$/i.test(text) ? 'no' : null;
    if (choice === 'always' && !q.always) { ui.chat.text = text; say(ui, 'This one is asked every time: y or n', 'dim'); return; }
    if (choice) {
      b.send({ op: 'answer', id: l.id, choice });
      say(ui, choice === 'no' ? `${l.name}: you said no` : choice === 'always' ? `${l.name}: yes, and it will not ask this again` : `${l.name}: yes`);
      return;
    }
  } else if (l.ready && !l.current && /^(y|yes|go|n|no|skip)$/i.test(text)) {
    // Ask first: y starts the waiting run, n leaves this one out.
    const go = /^(y|yes|go)$/i.test(text);
    b.send({ op: go ? 'go' : 'skip', id: l.id });
    say(ui, go ? `${l.name}: run ${l.ready.n} starts` : `${l.name}: run ${l.ready.n} left out`);
    return;
  }
  if (as !== 'note' && !over(l)) {
    ui.stamp = stampOf();
    b.send({ op: 'redo', id: l.id, text, putBack: as === 'redo', stamp: ui.stamp });
    say(ui, `${l.name}: starting over…`, 'dim');
    return;
  }
  ui.stamp = stampOf();
  b.send({ op: 'typed', text, id: l.id, stamp: ui.stamp });
  say(ui, q ? 'Sent as a note: it still asks, so type y, a or n' : 'Sent', 'dim');
}

// What a key does. b: { state, ui, send(cmd), quit() }. Every printable key is text for the box;
// the commands are ctrl keys, and a question that needs a yes is answered by typing it.
export function handleKey(b, k) {
  const { state, ui } = b;
  if (ui.view === 'setup') return setupKey(b, k);
  if (ui.view === 'shelf') return shelfKey(b, k);
  if (ui.view === 'editor' && ui.editor) return editorKey(b, k);
  if (ui.view === 'confirm') {
    // Only y does it: enter does nothing here (4 Oct 2026: a stop came from an s typed and an enter).
    const c = ui.confirm;
    if (k === 'y') { ui.view = c.back; ui.confirm = null; c.yes(); }
    else if (k === 'n' || k === 'esc') { ui.view = c.back; ui.confirm = null; }
    return;
  }
  const watching = ui.view === 'watch';
  const l = watching ? state.loops.find((x) => x.id === ui.watch.id) : state.loops[ui.sel];
  if (k === 'esc') {
    // The box first, then the run you watch, then the board itself.
    if (ui.chat.text || ui.chat.as !== 'note') { ui.chat.text = ''; ui.chat.as = 'note'; return; }
    if (watching) { ui.view = 'main'; ui.watch = null; return; }
    return b.quit();
  }
  // Enter: what you typed goes to the loop; with nothing typed, the lit button is pressed.
  const btns = watching ? watchButtonsOf(l, state.model) : buttonsOf(l, state.model);
  const lit = Math.max(0, Math.min(ui.btn ?? 0, btns.length - 1));
  if (k === 'enter') { if (ui.chat.text.trim() || ui.chat.as !== 'note') return send(b, l); if (!l) { openShelf(ui); return; } return press(b, l, btns[lit]?.[0]); }
  if (k === 'backspace') { ui.chat.text = [...ui.chat.text].slice(0, -1).join(''); return; }
  if (k === '^U') { ui.chat.text = ''; return; }
  // ^N, and tab with nothing typed: the Library (its first card makes a new loop from scratch).
  if (k === '^N' || (!watching && (k === 'tab' || k === 'shiftTab') && !ui.chat.text)) { openShelf(ui); return; }
  if ((k === 'left' || k === 'right') && !ui.chat.text) { if (btns.length) ui.btn = (lit + (k === 'left' ? btns.length - 1 : 1)) % btns.length; return; }
  if (watching && (k === 'up' || k === 'down')) {
    if (k === 'up') ui.watch.scroll = (ui.watch.scroll ?? 0) + 3;
    else ui.watch.scroll = Math.max(0, (ui.watch.scroll ?? 0) - 3);
    return;
  }
  if (['up', 'down', 'tab', 'shiftTab'].includes(k)) {
    const n = state.loops.length;
    if (!n) return;
    ui.sel = (ui.sel + (k === 'up' || k === 'shiftTab' ? n - 1 : 1)) % n;
    ui.btn = 0;
    ui.chat.as = 'note';
    return;
  }
  if (k === 'left' || k === 'right') return;
  if (k.length === 1 && k >= ' ') { ui.chat.text += k; return; }
  if (!l) { if (/^\^[A-Z]$/.test(k)) say(ui, 'No loop yet: ^N makes one', 'dim'); return; }
  if (k === '^R') { if (l.current) say(ui, `${l.name} is already running`, 'dim'); else if (over(l)) say(ui, `${l.name} has ended: type a note and enter starts it again`, 'dim'); else if (!state.model.on) say(ui, `${state.model.why || 'The model is off'}: /start in the coding window first`, 'warn'); else { b.send({ op: 'run', id: l.id }); say(ui, `${l.name}: running now`); } return; }
  if (k === '^P') { if (over(l)) { say(ui, `${l.name} has ended`, 'dim'); return; } b.send({ op: 'pause', id: l.id }); say(ui, l.state === 'paused' || l.pauseAfter ? `${l.name}: going again` : l.current ? `${l.name}: pauses after this run` : `${l.name}: paused · ^P goes on`); return; }
  if (k === '^S') {
    if (over(l)) { say(ui, `${l.name} has already ended`, 'dim'); return; }
    ui.confirm = { text: `Stop "${l.name}"? Its runs so far stay.`, back: ui.view, yes: () => { b.send({ op: 'stop', id: l.id }); say(ui, `${l.name}: stopped · type a note to start it again`); } };
    ui.view = 'confirm';
    return;
  }
  // ^O: the loop's rules on the setup page (one that ended can start again from there).
  if (k === '^O') { openSetup(ui, { loop: l, state, mode: state.mode ?? 'ask' }); return; }
  // ^X: the box starts the run over with your words; again keeps its changes, again a plain note.
  if (k === '^X') {
    if (over(l)) { say(ui, `${l.name} has ended: type a note and enter starts it again`, 'dim'); return; }
    const ways = ['note', 'redo', 'redoKeep'];
    ui.chat.as = ways[(ways.indexOf(ui.chat.as ?? 'note') + 1) % 3];
    say(ui, ui.chat.as === 'redo' ? 'Type what to do differently, then enter: the run starts over and its changes go back · ^X again keeps them' : ui.chat.as === 'redoKeep' ? 'Starting over keeps its changes · ^X again: a plain note' : 'A plain note again', 'dim');
    return;
  }
  // ^B: put back what a run changed (the run you are watching, else the last one that kept a copy).
  if (k === '^B') {
    const n = watching ? (ui.watch.n ?? l.current?.n ?? l.runs.at(-1)?.n) : null;
    if (l.current && (!n || n === l.current.n)) { say(ui, `${l.name} is running: wait for run ${l.current.n} to end, or ^X to start it over`, 'dim'); return; }
    const r = n ? l.runs.find((x) => x.n === n) : [...l.runs].reverse().find((x) => x.point != null && !x.undone);
    if (!r) { say(ui, `${l.name} has no run to put back`, 'dim'); return; }
    if (r.undone) { say(ui, `Run ${r.n} was already put back`, 'dim'); return; }
    if (r.point == null) { say(ui, `Run ${r.n} kept no copy to put back`, 'dim'); return; }
    const files = (r.files ?? []).filter((f) => f.by !== 'other').map((f) => f.path);
    const what = files.length ? `${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}` : 'nothing it changed is known';
    ui.confirm = { text: `Put back what run ${r.n} changed? ${what}. A file changed since stays as it is.`, back: ui.view, yes: () => { ui.stamp = stampOf(); b.send({ op: 'undo', id: l.id, n: r.n, stamp: ui.stamp }); say(ui, `Putting back run ${r.n}…`, 'dim'); } };
    ui.view = 'confirm';
    return;
  }
  // ^G: one run full size, the one under way or the last; it stays on the screen when the next starts.
  if (k === '^G') {
    ui.btn = 0;
    if (watching) { ui.view = 'main'; ui.watch = null; return; }
    ui.watch = { id: l.id, n: l.current?.n ?? l.runs.at(-1)?.n ?? null, scroll: 0 };
    ui.view = 'watch';
  }
}

// A run's lines, read again only when its file has grown: linesOf(loop, n) for drawBoard.
export function runReader(home, pid) {
  const cache = new Map();
  return (l, n) => {
    if (!n) return [];
    const file = runFile(home, pid, l.id, n);
    let size = -1;
    try { size = statSync(file).size; } catch { return []; }
    const key = `${l.id}-${n}`;
    const had = cache.get(key);
    if (had && had.size === size) return had.lines;
    const lines = readRun(home, pid, l.id, n);
    cache.set(key, { size, lines });
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return lines;
  };
}

// `coding loops [pid]`: the board in a terminal of its own, until esc or ctrl+c. Answers the exit code.
export async function runBoard({ home = HOME, pid = null, input = process.stdin, output = process.stderr, env = process.env } = {}) {
  const out = process.stdout;
  if (!input.isTTY || !out.isTTY) { output.write('coding loops needs a terminal.\n'); return 2; }
  if (!pid) {
    const boards = listBoards(home);
    if (!boards.length) { output.write('No coding window has a loop now. In a coding window, type /loop to load a ready-made loop or make one, or say it in a sentence: /loop run the tests every 10 min until 6pm\n'); return 0; }
    if (boards.length === 1) pid = boards[0].pid;
    else {
      output.write('Which window\'s loops?\n\n');
      const i = await pickOnTerminal(boards.map((s) => `${s.name} · ${s.folder} · ${s.loops.length} loop${s.loops.length === 1 ? '' : 's'}`));
      if (i === null) return 0;
      pid = boards[i].pid;
    }
  }
  let state = readState(home, pid);
  if (!state) { output.write(`No coding window ${pid} has loops (it may have closed: its loops ended with it).\n`); return 1; }
  const ui = newUi();
  const linesOf = runReader(home, pid);
  let lastFrame = [];
  const paint = (force = false) => {
    const cols = out.columns || BOARD_SIZE[0], rows = out.rows || BOARD_SIZE[1];
    const frame = drawBoard(state, ui, { cols, rows, now: Date.now(), linesOf }).map(ansiRow);
    let buf = '';
    for (let y = 0; y < frame.length; y++) if (force || frame[y] !== lastFrame[y]) buf += `\x1b[${y + 1};1H${frame[y]}`;
    lastFrame = frame;
    if (buf) out.write(buf);
  };
  return await new Promise((resolve) => {
    let done = false;
    const timers = [];
    const leave = (code, last = '') => {
      if (done) return;
      done = true;
      for (const t of timers) clearInterval(t);
      input.off('readable', onReadable);
      out.off('resize', onResize);
      out.write('\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1049l');
      input.setRawMode(false);
      if (last) out.write(`${last}\n`);
      resolve(code);
    };
    const b = { get state() { return state; }, ui, send: (cmd) => sendCommand(home, pid, cmd), quit: () => leave(0, 'The loop board is closed. The loops go on in their window; /loop there shows them.') };
    const pasteState = { pasting: null };
    const onReadable = () => {
      let c;
      while (!done && (c = input.read()) !== null) {
        for (const part of inputParts(String(c), pasteState)) {
          if (part.paste != null) { handlePaste(b, part.paste); continue; }
          for (const k of keysOf(part.keys)) { if (k === '^C') return leave(0, 'The loop board is closed. The loops go on in their window.'); handleKey(b, k); if (done) return; }
        }
        paint();
      }
    };
    const onResize = () => { out.write('\x1b[2J'); paint(true); };
    // The board grows to 124 × 38 where the terminal follows that (as /agents does), keeping a bigger window.
    if (canResize(env, out) && ((out.columns ?? 0) < BOARD_SIZE[0] || (out.rows ?? 0) < BOARD_SIZE[1])) out.write(resizeSeq(Math.max(out.columns ?? 0, BOARD_SIZE[0]), Math.max(out.rows ?? 0, BOARD_SIZE[1])));
    // Bracketed paste: the terminal marks a paste (and a drop), so its line breaks are never enter.
    out.write('\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J');
    input.setRawMode(true);
    input.on('readable', onReadable);
    out.on('resize', onResize);
    timers.push(setInterval(() => {
      const next = readState(home, pid);
      // The window closed: its loops ended with it.
      if (!next) return leave(0, 'That coding window closed, and its loops ended with it.');
      state = next;
      if (ui.sel >= state.loops.length) ui.sel = Math.max(0, state.loops.length - 1);
      // What the window said back to the last thing typed here.
      if (ui.stamp && state.reply?.stamp === ui.stamp) { ui.stamp = null; showReply(ui, state.loops, state.reply); }
    }, 200));
    timers.push(setInterval(() => paint(), 125));
    process.once('SIGTERM', () => leave(143));
    process.once('SIGHUP', () => leave(129));
    paint(true);
  });
}
