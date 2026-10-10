// Loops kept to load again, on the loop board (9 Oct 2026; loop-files.mjs keeps them). What it adds to
// the board and the setup wizard (loops-draw.mjs, loops-board.mjs):
//   · loading one: every step filled in from it, the wizard at its last step to check, with a row for
//     each blank it asks ({page}, {url}: its ready answer, typed over) and its own three step names
//   · Save as on the wizard's last step (a name, and for you or in the project), and Save over a run
//   · a one-page form with every field for a loop you kept (^E), where it can also be removed
//   · where you pick one: the board has two tabs, Running and Library, and the Library is a shelf of cards
//     (yours with + New loop first, then a project's, then the ready-made ones); typing finds one by name.
//     The owner's pick of two live designs (9 Oct 2026; the other was tabs in the wizard's first step)
// Plain data in, rows out for the drawing; the keys change ui only and send to the window as before.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fit, rowWidth, header, keysLine, framed, loopPicture, wrapWords, cut, pad, chip, rule, blank, setupChoices, setupPick, kindOfSetup, setupFields, MORE_ROWS, wizardSteps, CYCLE, planRows, splitAddress } from './loops-draw.mjs';
import { openSetup } from './loops-board.mjs';
import { filledText, fillsIn, pictureOf, pictureText } from './loop-files.mjs';
import { modeName, readEvery } from './loops.mjs';

const p = (t, s = 'text') => [String(t), s];
const FROM = { ready: 'ready-made', yours: 'yours', project: 'from a project' };
const listOf = (state, from) => (state.library ?? []).filter((l) => l.from === from);
const paceOf = (f) => (f.every === 'until done' ? (f.check ? 'until clean' : 'until they pass') : /^own/.test(f.every) ? 'its own pace' : `every ${f.every}`);
const untilOf = (f) => (f.runs && f.runs !== 'no limit' ? `${f.runs} runs` : f.stopAt && f.stopAt !== 'none' ? `stops ${/^\d+(\.\d+)?[hm]$/.test(f.stopAt) ? 'in ' : 'at '}${f.stopAt}` : 'until closed');
// What a loop does to your files, in two words: by its mode and kind, else by what it is told.
const touches = (e) => (e.fields.mode === 'edits' || e.fields.kind === 'debug' ? 'changes files' : /change (no file|nothing|no code)|read the newest|^read /i.test(e.message) ? 'reads only' : 'asks to change');

// ---- loading one into the wizard ----
// A blank's ready answer when the file has none: a {repo} is this folder's GitHub repo, read from .git/config.
function guessFill(key, folder) {
  if (key !== 'repo' || !folder) return '';
  try { return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m.exec(readFileSync(join(folder, '.git', 'config'), 'utf8'))?.[1] ?? ''; } catch { return ''; }
}
// The wizard at its last step with a kept loop in it, to check before it starts (the owner's pick).
export function loadInto(ui, entry, state) {
  const back = ui.view === 'shelf' ? 'shelf' : ui.back ?? null; // esc in the wizard goes back there
  openSetup(ui, { mode: entry.fields.mode ?? state.mode ?? 'ask' });
  const su = ui.setup;
  const folder = entry.folder ?? state.places?.[0]?.path ?? null;
  su.fills = entry.fills.map((x) => ({ key: x.key, value: x.value || guessFill(x.key, folder) }));
  su.loaded = { id: entry.id, from: entry.from, name: entry.name, about: entry.about, file: entry.file, project: entry.project ? entry.project.split('/').pop() : null, trusted: entry.trusted !== false, template: entry.message };
  wordsFrom(su, filledText(entry.message, Object.fromEntries(su.fills.map((x) => [x.key, x.value]))));
  const { kind, every, runs, stopAt, cap, steps, mode, askFirst, check } = entry.fields;
  Object.assign(su.f, { kind, every, runs, stopAt, cap, steps, mode, askFirst, folder: entry.folder ?? null, check: check ?? null });
  su.picture = entry.picture;
  su.touched.often = true;
  su.keep = true;
  su.save = { name: '', where: entry.from === 'project' ? 'project' : 'yours', replace: entry.from === 'ready' ? null : entry.file };
  su.step = wizardSteps(su).length - 1;
  // Typing goes to the first blank, with its answer ready: an empty one is what to fill in first.
  su.rule = su.fills.length ? Math.max(0, su.fills.findIndex((x) => !x.value)) : -1;
  ui.back = back;
}
// A blank answered: the message is made again from the loop's own words.
export function setFill(su, i, value) {
  su.fills[i].value = value;
  wordsFrom(su, filledText(su.loaded.template, Object.fromEntries(su.fills.map((x) => [x.key, x.value]))));
}
// A loop's words, its page (if it watches one) taken out into the address box.
function wordsFrom(su, message) {
  const { words, url } = splitAddress(message);
  su.text = words;
  su.url = url;
  su.web = Boolean(url);
}

// ---- the wizard's last step: the rows a key can move to ----
export const startRows = (su) => [...(su.fills ?? []).map((_, i) => `fill:${i}`), ...planRows(su), ...MORE_ROWS, 'saveName', 'saveWhere'];
// Over the title: what was loaded, and a row for each blank it asks.
export function loadedRows(su, w) {
  const out = [];
  const l = su.loaded;
  out.push(fit([p('Loaded    ', 'faint'), p(cut(l.name, w - 26), 'white b'), p(`  ${l.from === 'project' ? `from ${l.project}` : FROM[l.from]}`, 'dim')], w));
  const rows = startRows(su);
  (su.fills ?? []).forEach((x, i) => {
    const on = rows[su.rule] === `fill:${i}`;
    const word = `{${x.key}}`;
    out.push(fit([p(on ? ' ▸ ' : '   ', 'accent b'), p(pad(word, 11), on ? 'white b' : 'dim'), p(cut(x.value || 'type it', w - 18), x.value ? (on ? 'white' : 'accent') : 'warn'), p(on ? '▏' : '', 'accent')], w, on ? 'sel' : null));
  });
  return out;
}
// Save as: optional; a name keeps it to load again, for you or in the project picked at Where.
export function saveRows(su, state, w) {
  const rows = startRows(su);
  const at = rows[su.rule];
  const name = su.save?.name ?? '';
  const where = setupFields(su, state).folder;
  const place = (state.places ?? []).find((x) => x.path === where);
  const home = !place || place.shown === '~';
  const forWord = su.save?.where === 'project' && !home ? `in ${place.shown.split('/').pop()}` : 'you, every project';
  const out = [fit([p('Save as', 'dim'), p(su.id ? '      a copy to load again later' : '      optional: keep it to load again', 'faint')], w)];
  const nameOn = at === 'saveName';
  out.push(fit([p(nameOn ? ' ▸ ' : '   ', 'accent b'), p(pad('Name', 14), nameOn ? 'white b' : 'dim'), p(cut(name || (nameOn ? '' : 'type a name to keep it'), w - 20), name ? 'white' : 'faint'), p(nameOn ? '▏' : '', 'accent')], w, nameOn ? 'sel' : null));
  const forOn = at === 'saveWhere';
  out.push(fit([p(forOn ? ' ▸ ' : '   ', 'accent b'), p(pad('For', 14), forOn ? 'white b' : 'dim'), p(forOn ? '◂ ' : '  ', 'accent'), p(forWord, name ? (forOn ? 'white b' : 'text') : 'faint'), p(forOn ? ' ▸' : '', 'accent'), p(home && forOn ? '   a project: pick one at Where' : '', 'faint')], w, forOn ? 'sel' : null));
  return out;
}

function askRemove(b, e) {
  const { ui } = b;
  ui.confirm = { text: `Remove “${e.name}”? Its file is deleted${e.from === 'project' ? ` from ${e.project}` : ''}.`, back: ui.view, yes: () => { ui.toast = { text: `Removing “${e.name}”…`, style: 'dim', until: Date.now() + 3200 }; b.send({ op: 'remove', file: e.file, name: e.name }); } };
  ui.view = 'confirm';
}

// ---- design 2: the board's Running · Library tabs, and the Library as a shelf of cards ----
export function shelfTabs(state, ui, cols) {
  const lib = state.library?.length ?? 0;
  const t = (id, word) => p(` ${word} `, (ui.view === 'shelf') === (id === 'shelf') ? 'white b on btnOn' : 'dim on btn');
  return [fit([p('  '), t('main', `Running ${state.loops.length}`), p(' '), t('shelf', `Library ${lib}`), p('   tab switches', 'faint'), ...(ui.view === 'shelf' && ui.shelf?.find ? [p('   find: ', 'dim'), p(ui.shelf.find, 'white b'), p('▏', 'accent')] : [])], cols), blank(cols)];
}
export function openShelf(ui) { ui.view = 'shelf'; ui.shelf = { at: ui.shelf?.at ?? 0, find: '' }; ui.setup = null; }
// The cards in their sections, filtered by what you typed: [{ id, title, items: [entry | { new: true }] }].
function shelfSections(state, find = '') {
  const f = find.trim().toLowerCase();
  const keep = (e) => !f || e.name.toLowerCase().includes(f) || (e.about ?? '').toLowerCase().includes(f);
  return [
    { id: 'yours', title: 'Yours', items: [...(f ? [] : [{ new: true }]), ...listOf(state, 'yours').filter(keep)] },
    { id: 'project', title: 'Projects', items: listOf(state, 'project').filter(keep) },
    { id: 'ready', title: 'Ready-made', items: listOf(state, 'ready').filter(keep) },
  ].filter((s) => s.items.length);
}
function card(e, w, on) {
  const bs = on ? 'accent' : 'border';
  const side = (pieces) => fit([p('│ ', bs), ...fit(pieces, w - 4), p(' │', bs)], w);
  if (e.new) return [
    fit([p('╭', bs), p('─'.repeat(w - 2), bs), p('╮', bs)], w),
    side([p('+ New loop', on ? 'white b' : 'accent b')]),
    side([p('from scratch, step by step', 'dim')]),
    side([p('keep it to find it here', 'faint')]),
    fit([p('╰', bs), p('─'.repeat(w - 2), bs), p('╯', bs)], w),
  ];
  const kind = e.fields.kind ?? 'task';
  const name = ` ${cut(e.name, w - 12)} `;
  const pic = (e.picture ?? CYCLE[kind] ?? CYCLE.task).map(([v]) => v).join(' › ');
  const last = e.from === 'project' ? `${e.project?.split('/').pop()}${e.trusted ? '' : ' · asks once'}` : `${modeName(e.fields.mode)} · ${touches(e)}`;
  return [
    fit([p('╭─', bs), chip(kind), p(name, on ? 'white b' : 'text'), p('─'.repeat(Math.max(0, w - 4 - [...chip(kind)[0]].length - [...name].length)), bs), p('─╮', bs)], w),
    side([p(cut(`${paceOf(e.fields)} · ${untilOf(e.fields)}`, w - 4), 'dim')]),
    side([p(cut(pic, w - 4), on ? 'accent b' : 'accentDim')]),
    side([p(cut(last, w - 4), e.from === 'project' && !e.trusted ? 'warn' : 'faint')]),
    fit([p('╰', bs), p('─'.repeat(w - 2), bs), p('╯', bs)], w),
  ];
}
export function drawShelf(state, ui, { cols, rows, now }) {
  const sh = ui.shelf ?? (ui.shelf = { at: 0, find: '' });
  const out = [header(state, ui, now, cols, 'Loops'), rule(cols), ...shelfTabs(state, ui, cols)];
  const sections = shelfSections(state, sh.find);
  const items = sections.flatMap((s) => s.items);
  sh.at = Math.max(0, Math.min(sh.at, items.length - 1));
  const per = cols >= 120 ? 4 : 3;
  const gap = 2;
  const cw = Math.min(34, Math.floor((cols - 4 - (per - 1) * gap) / per));
  const x0 = Math.floor((cols - (per * cw + (per - 1) * gap)) / 2);
  const body = [];
  let pickedAt = 0;
  let n = 0;
  for (const s of sections) {
    body.push(fit([p(' '.repeat(x0)), p(s.title, 'white b'), p(`  ${s.id === 'yours' ? 'kept for you, in every project' : s.id === 'project' ? 'kept in a project, shared through git' : 'come with the app'}`, 'faint')], cols));
    for (let i = 0; i < s.items.length; i += per) {
      const rowItems = s.items.slice(i, i + per);
      if (rowItems.some((_, j) => n + j === sh.at)) pickedAt = body.length;
      const cards = rowItems.map((e, j) => card(e, cw, n + j === sh.at));
      for (let y = 0; y < 5; y++) body.push(fit([p(' '.repeat(x0)), ...cards.flatMap((c, j) => [...(j ? [p(' '.repeat(gap))] : []), ...c[y]])], cols));
      n += rowItems.length;
    }
    body.push(blank(cols));
  }
  if (!items.length) body.push(fit([p(' '.repeat(x0)), p(`Nothing called “${sh.find}”: backspace or esc`, 'faint')], cols));
  // What the picked card does, at the bottom: its words and what enter does.
  const e = items[sh.at];
  const detail = [rule(cols)];
  if (e?.new) {
    detail.push(fit([p('  '), p('A new loop', 'white b'), p('  ·  the wizard: what, where, how often, until when, then Start. Type a name at Save as on its last step to keep it.', 'dim')], cols));
    detail.push(blank(cols));
  } else if (e) {
    detail.push(fit([p('  '), p(e.name, 'white b'), p(`  ·  ${e.from === 'project' ? `from ${e.project}` : FROM[e.from]}  ·  ${e.about}`, 'dim')], cols));
    detail.push(fit([p('  '), p(cut(`“${filledText(e.message, Object.fromEntries(e.fills.map((x) => [x.key, x.value || `{${x.key}}`])))}”`, cols - 4), 'text')], cols));
  }
  const keys = sh.find ? [['enter', 'load it'], ['←→↑↓', 'pick'], ['backspace', 'find less'], ['esc', 'clear']]
    : [['enter', e?.new ? 'start a new one' : 'load it'], ['←→↑↓', 'pick'], ...(e && !e.new && e.from !== 'ready' ? [['^E', 'change it'], ['^D', 'remove']] : []), ['type', 'to find'], ['tab', 'Running'], ['esc', state.loops.length ? 'Running' : ui.inApp ? 'chat' : 'close']];
  const room = rows - out.length - detail.length - 1;
  // Scrolled so the picked card's row is in sight.
  const top = Math.max(0, Math.min(pickedAt - Math.max(0, room - 7), body.length - room));
  for (let i = 0; i < room; i++) out.push(body[top + i] ?? blank(cols));
  return [...out, ...detail, keysLine(cols, keys, ui.toast, now)].slice(0, rows);
}
// The shelf's keys: arrows move over the cards, enter loads one (or starts a new one), typing finds.
export function shelfKey(b, k) {
  const { ui, state } = b;
  const sh = ui.shelf ?? (ui.shelf = { at: 0, find: '' });
  const sections = shelfSections(state, sh.find);
  const items = sections.flatMap((s) => s.items);
  const per = 4;
  // Each card's place: [row, column], row counted over the sections.
  const places = [];
  let r = 0;
  for (const s of sections) { s.items.forEach((_, i) => places.push([r + Math.floor(i / per), i % per])); r += Math.ceil(s.items.length / per); }
  const e = items[sh.at];
  if (k === 'left' || k === 'right') { if (items.length) sh.at = (sh.at + (k === 'left' ? items.length - 1 : 1)) % items.length; return; }
  if (k === 'up' || k === 'down') {
    const [row, col] = places[sh.at] ?? [0, 0];
    const want = row + (k === 'up' ? -1 : 1);
    const inRow = places.map((x, i) => [x, i]).filter(([x]) => x[0] === want);
    if (inRow.length) sh.at = (inRow.find(([x]) => x[1] === col) ?? inRow.at(-1))[1];
    return;
  }
  if (k === 'enter') {
    if (!e) return;
    if (e.new) { openSetup(ui, { mode: state.mode ?? 'ask' }); ui.back = 'shelf'; return; }
    loadInto(ui, e, state);
    return;
  }
  if (k === '^E' && e && !e.new && e.from !== 'ready') { openEditor(ui, e, state); return; }
  if (k === '^D' && e && !e.new && e.from !== 'ready') { askRemove(b, e); return; }
  if (k === 'tab' || k === 'shiftTab') { ui.view = 'main'; return; }
  if (k === 'esc') { if (sh.find) { sh.find = ''; sh.at = 0; return; } if (state.loops.length) { ui.view = 'main'; return; } b.quit(); return; }
  if (k === 'backspace') { sh.find = [...sh.find].slice(0, -1).join(''); sh.at = 0; return; }
  if (k === '^U') { sh.find = ''; sh.at = 0; return; }
  if (k === '^N') { openSetup(ui, { mode: state.mode ?? 'ask' }); ui.back = 'shelf'; return; }
  if (k.length === 1 && k >= ' ') { sh.find += k; sh.at = 0; }
}

// ---- the one-page form for a loop you kept (^E): every field, the picture beside it ----
export function openEditor(ui, e, state) {
  const values = Object.fromEntries(e.fills.map((x) => [x.key, x.value]));
  ui.editor = {
    entry: { file: e.file, from: e.from, folder: e.folder ?? null, project: e.project ?? null },
    name: e.name, about: e.about ?? '', template: e.message, values, pic: pictureText(e.picture),
    f: { ...e.fields, folder: e.folder ?? null }, custom: { often: '', stop: '' }, row: 0, where: e.from === 'project' ? 'project' : 'yours', error: null,
  };
  ui.editorBack = ui.view === 'setup' ? (ui.back ?? 'main') : ui.view;
  ui.view = 'editor';
}
const EDIT_TEXT = new Set(['name', 'message', 'picture']);
const editRows = (ed) => ['name', 'message', ...fillsIn(ed.template).map((k) => `fill:${k}`), 'picture', 'where', 'often', 'stop', 'mode', 'cap', 'steps', 'ask', 'savefor'];
// The form as the wizard sees a loop (for the picture and the choices).
const asSetup = (ed) => ({ f: ed.f, custom: ed.custom, text: filledText(ed.template, ed.values), picture: pictureOf(ed.pic), typed: ed.name, step: 4, id: null, touched: { often: true }, keep: true, loaded: null, save: null });
function choiceWord(row, su, state, now) {
  const cs = setupChoices(row === 'ask' ? 'ask' : row, su, state, now);
  const i = setupPick(row, su, state, now);
  if (i >= 0) return cs[i][1];
  if (row === 'often') return paceOf(su.f);
  if (row === 'stop') return untilOf(su.f);
  return '';
}
export function drawEditor(state, ui, { cols, rows, now }) {
  const ed = ui.editor;
  const su = asSetup(ed);
  const out = [header(state, ui, now, cols, `Change ${cut(ed.name, 40)}`), rule(cols)];
  const lines = [blank(cols), fit([p(' '.repeat(Math.max(0, Math.floor((cols - 62) / 2)))), p('One page: every field, and the picture beside it changes as you type', 'dim')], cols), blank(cols)];
  const WD = Math.min(cols - 4, 168); // room for the picture's four boxes at full width
  const X = Math.floor((cols - WD) / 2);
  const wide = cols >= 118;
  const LW = wide ? Math.min(62, Math.floor(WD * 0.5)) : WD;
  const w = LW - 4;
  const er = [];
  const rowsAt = editRows(ed);
  const lab = (t, on) => [p(on ? ' ▸ ' : '   ', 'accent b'), p(pad(t, 13), on ? 'white b' : 'dim')];
  rowsAt.forEach((r, i) => {
    const on = i === ed.row;
    const bg = on ? 'sel' : null;
    if (r === 'name') er.push(fit([...lab('Name', on), p(ed.name, 'white'), p(on ? '▏' : '', 'accent')], w, bg));
    else if (r === 'message') {
      er.push(fit([...lab('Each run', on), p('is told; a {word} makes a blank', 'faint')], w, bg));
      const lines2 = wrapWords(ed.template, w - 8);
      const bs = on ? 'accent' : 'border';
      er.push(fit([p('   ╭', bs), p('─'.repeat(w - 5), bs), p('╮', bs)], w));
      lines2.slice(-4).forEach((t, j, a) => er.push(fit([p('   │ ', bs), p(pad(`${t}${on && j === a.length - 1 ? '▏' : ''}`, w - 6), 'white'), p('│', bs)], w)));
      er.push(fit([p('   ╰', bs), p('─'.repeat(w - 5), bs), p('╯', bs)], w));
    } else if (r.startsWith('fill:')) {
      const k = r.slice(5);
      er.push(fit([...lab(`{${k}}`, on), p(ed.values[k] || 'its ready answer (or empty: asked when loaded)', ed.values[k] ? 'accent' : 'faint'), p(on ? '▏' : '', 'accent')], w, bg));
    } else if (r === 'picture') {
      // Four steps run long: past the row's width they go on a second line, split at a ›.
      const txt = ed.pic || 'VERB words › VERB words › VERB words › VERB words';
      const st = ed.pic ? (pictureOf(ed.pic) ? 'accent b' : 'warn') : 'faint';
      const room = w - 16;
      let one = txt, two = '';
      if (txt.length > room) {
        const cut2 = txt.lastIndexOf('›', room);
        if (cut2 > 0) { one = txt.slice(0, cut2 + 1).trimEnd(); two = txt.slice(cut2 + 1).trimStart(); }
      }
      er.push(fit([...lab('Its steps', on), p(one, st), p(on && !two ? '▏' : '', 'accent')], w, bg));
      if (two) er.push(fit([p(' '.repeat(16)), p(two, st), p(on ? '▏' : '', 'accent')], w, bg));
    }
    else if (r === 'savefor') {
      const place = (state.places ?? []).find((x) => x.path === setupFields(su, state).folder);
      er.push(fit([...lab('Kept', on), p(on ? '◂ ' : '  ', 'accent'), p(ed.where === 'project' && place && place.shown !== '~' ? `in ${place.shown.split('/').pop()}` : 'for you, every project', 'text'), p(on ? ' ▸' : '', 'accent')], w, bg));
    } else {
      const label = { where: 'Where', often: 'How often', stop: 'Until', mode: 'Mode', cap: 'Spending cap', steps: 'Steps a run', ask: 'Ask first' }[r];
      er.push(fit([...lab(label, on), p(on ? '◂ ' : '  ', 'accent'), p(cut(choiceWord(r, su, state, now), w - 20), on ? 'white b' : 'text'), p(on ? ' ▸' : '', 'accent')], w, bg));
    }
  });
  if (ed.error) { er.push(blank(w)); er.push(fit([p('! ', 'warn b'), p(cut(ed.error, w - 2), 'warn')], w)); }
  const left = framed(`${ed.entry.from === 'project' ? `Kept in ${ed.entry.project?.split('/').pop()}` : 'Kept for you'} · every field`, er, LW, 'accent');
  if (wide) {
    const RW = WD - LW - 2;
    const right = framed('Your loop', loopPicture(su, state, RW - 4, now), RW, 'border');
    const h = Math.max(left.length, right.length);
    const padBox = (box, bw) => { const last = box.at(-1); const b = box.slice(0, -1); while (b.length < h - 1) b.push(fit([p('│', last[0][1]), p(' '.repeat(bw - 2)), p('│', last[0][1])], bw)); return [...b, last]; };
    const L = padBox(left, LW), R = padBox(right, RW);
    for (let i = 0; i < h; i++) lines.push(fit([p(' '.repeat(X)), ...L[i], p('  '), ...R[i]], cols));
  } else {
    for (const r of left) lines.push(fit([p(' '.repeat(X)), ...r], cols));
    const kind = kindOfSetup(su);
    const ev = readEvery(su.f.every, { kind });
    const cyc = (su.picture ?? CYCLE[kind] ?? CYCLE.task).flatMap(([v, ww], i) => [...(i ? [p(' ─▶ ', 'accent')] : []), p(v, 'accent b'), p(` ${ww}`, 'text')]);
    lines.push(fit([p(' '.repeat(X + 2)), p('Your loop  ', 'white b'), ...cyc, p(` ─▶ ${ev.until ? (su.f.check ? 'again until clean' : 'again until they pass') : ev.every ? 'then wait' : 'its own pace'} ↺`, 'dim')], cols));
  }
  lines.push(blank(cols));
  const leftB = [p('  ^D Remove  ', 'text on btn')];
  const rightB = [p('  enter Save  ', 'text on btn'), p('  '), p('  ^G Save and start  ', 'white b on btnOn')];
  lines.push(fit([p(' '.repeat(X)), ...leftB, p(' '.repeat(Math.max(1, WD - rowWidth(leftB) - rowWidth(rightB)))), ...rightB], cols));
  const room = rows - out.length - 1;
  const top = Math.max(0, Math.floor((room - lines.length) / 3));
  for (let i = 0; i < room; i++) out.push(lines[i - top] ?? blank(cols));
  const r = rowsAt[ed.row];
  const keys = [['↑↓', 'a field'], EDIT_TEXT.has(r) || r.startsWith('fill:') ? ['type', 'in it'] : ['←→', 'change it'], ['enter', 'save'], ['^G', 'save and start'], ['^D', 'remove'], ['esc', 'cancel']];
  return [...out.slice(0, rows - 1), keysLine(cols, keys, ui.toast, now)];
}
// What the form keeps: the shape loop-files.mjs saves.
function editorSave(ed, state) {
  const su = asSetup(ed);
  const f = setupFields(su, state);
  const fills = fillsIn(ed.template).map((key) => ({ key, value: ed.values[key] ?? '' }));
  return { name: ed.name, about: ed.about, message: ed.template, fills, picture: pictureOf(ed.pic), fields: { kind: f.kind, every: f.every, runs: f.runs, stopAt: f.stopAt, cap: f.cap, steps: f.steps, mode: f.mode, askFirst: f.askFirst, ...(ed.f.check ? { check: ed.f.check } : {}) }, where: ed.where, folder: f.folder, replace: ed.entry.file };
}
const leaveEditor = (ui) => { ui.view = ui.editorBack && ui.editorBack !== 'editor' ? ui.editorBack : 'main'; ui.editor = null; if (ui.view === 'setup' && !ui.setup) ui.view = 'main'; };
export function editorKey(b, k) {
  const { ui, state } = b;
  const ed = ui.editor;
  const rows = editRows(ed);
  const r = rows[ed.row];
  const su = asSetup(ed);
  if (k === 'esc') { leaveEditor(ui); return; }
  if (k === 'up' || k === 'shiftTab') { ed.row = (ed.row + rows.length - 1) % rows.length; return; }
  if (k === 'down' || k === 'tab') { ed.row = (ed.row + 1) % rows.length; return; }
  if (k === 'enter' || k === '^G') {
    const s = editorSave(ed, state);
    if (!s.name.trim()) { ed.error = 'Give it a name first'; ed.row = 0; return; }
    if (!s.message.trim()) { ed.error = 'Type what each run should do first'; ed.row = 1; return; }
    if (ed.pic && !s.picture) { ed.error = 'Its steps: four of them, each a word and a few more, with › between'; ed.row = rows.indexOf('picture'); return; }
    if (k === '^G') {
      const values = ed.values;
      const fields = { ...s.fields, message: filledText(s.message, values), name: s.name, picture: s.picture, folder: setupFields(su, state).folder, ...(s.fields.check ? { check: filledText(s.fields.check, values) } : {}) };
      if (/\{[a-z][\w-]*\}/i.test(fields.message)) { ed.error = 'Give each blank an answer to start it now'; ed.row = rows.findIndex((x) => x.startsWith('fill:') && !values[x.slice(5)]); return; }
      // Said before it is sent: in the coding window the answer comes back at once and takes this line's place.
      ui.toast = { text: 'Saving and starting…', style: 'dim', until: Date.now() + 3200 };
      ui.editor = null;
      ui.view = 'main';
      ui.stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      b.send({ op: 'add', fields, save: s, wake: Boolean(state.model?.wake), stamp: ui.stamp });
      return;
    }
    ui.toast = { text: `Saving “${s.name}”…`, style: 'dim', until: Date.now() + 3200 };
    leaveEditor(ui);
    ui.stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    b.send({ op: 'save', save: s, stamp: ui.stamp });
    return;
  }
  if (k === '^D') { const e = { name: ed.name, file: ed.entry.file, from: ed.entry.from, project: ed.entry.project }; ui.editor = null; ui.view = ui.editorBack ?? 'main'; askRemove(b, e); return; }
  const text = r === 'name' ? 'name' : r === 'message' ? 'template' : r === 'picture' ? 'pic' : null;
  if (text || r.startsWith('fill:')) {
    const get = () => (text ? ed[text] : ed.values[r.slice(5)] ?? '');
    const set = (v) => { if (text) ed[text] = v; else ed.values[r.slice(5)] = v; ed.error = null; };
    if (k === 'backspace') set([...get()].slice(0, -1).join(''));
    else if (k === '^U') set('');
    else if (k.length === 1 && k >= ' ') set(get() + k);
    return;
  }
  if (k === 'left' || k === 'right' || k === ' ') {
    const step = k === 'left' ? -1 : 1;
    if (r === 'savefor') { ed.where = ed.where === 'project' ? 'yours' : 'project'; return; }
    const cs = setupChoices(r, su, state);
    if (!cs.length) return;
    const at = setupPick(r, su, state);
    const v = cs[at < 0 ? 0 : (at + step + cs.length) % cs.length][0];
    if (r === 'often') ed.f.every = v;
    else if (r === 'stop') { ed.f.runs = v.runs; ed.f.stopAt = v.stopAt; }
    else if (r === 'where') ed.f.folder = v;
    else if (r === 'ask') ed.f.askFirst = v;
    else ed.f[r] = v;
  }
}
