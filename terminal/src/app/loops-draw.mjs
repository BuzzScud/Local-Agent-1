// The loop board's screen (/loop in the coding window, `coding loops` in another terminal): the
// Cards, the owner's pick of 4 Oct 2026 (design round: docs/design rounds/
// agentic-coder-loops-4-designs-2026-10-04.html). A card per loop says in four plain lines what it
// is doing now, how its last run ended, when it runs next and what became of your last note, with
// its buttons under them (9 Oct 2026, the owner's pick: ←→ picks one, enter presses it); under
// the cards, what happened, newest first; then a line for what waits for you, the box (typing
// always goes in it) and the keys. Open shows one run full size; ^N and Rules, the setup wizard.
// drawBoard(state, ui, { cols, rows, now, linesOf }) → rows of [text, style] pieces, each row exactly
// `cols` wide. state: what the window wrote (loops.mjs snapshot). linesOf(loop, n) → that run's lines.
// Plain data in, rows out: tested on its own (loops.test.mjs).
import { everyWord as secsWord, limitWords, modeName, guessKind, spokenEvery, readEvery, readRuns, readStopAt, LOOP_MODES, STEPS_WORD } from './loops.mjs';
import { HUE } from '../ui/theme.mjs';
import { homedir } from 'node:os';
import { ATTACH_TOKEN } from '../agent/images.mjs';
import { trayItems, compactText } from './attach.mjs';
import { drawShelf, drawEditor, shelfTabs, startRows, loadedRows, saveRows } from './loops-library.mjs';

// Styles: a foreground (xterm-256, the app's own colours in ui/theme.mjs), "b" for bold, "on <bg>".
export const STYLE = {
  accent: HUE.accent, accentDim: HUE.dim, dim: 245, faint: 240, border: 242, white: 255, text: 252, ask: 147, ok: HUE.accent, bad: 203, warn: 215,
  debug: 209, test: 111, web: 73, task: 141, okDim: HUE.deep, badDim: 131,
};
export const BG = { sel: 236, user: 237, needs: 58, chipDebug: 52, chipTest: 17, chipWeb: 23, chipTask: 53, btn: 237, btnOn: 25 };
const KIND = { debug: ['FIX', 'chipDebug'], test: ['TEST', 'chipTest'], web: ['WEB', 'chipWeb'], task: ['TASK', 'chipTask'] };
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const MIN_COLS = 96;
export const MIN_ROWS = 30;
const CARD_H = 11;

// ---- pieces ----
const p = (t, s = 'text') => [String(t), s];
export const rowWidth = (row) => row.reduce((n, [t]) => n + [...t].length, 0);
// A row cut or filled to n cells; bg (a BG name) paints the whole row.
export function fit(row, n, bg = null) {
  const out = [];
  let w = 0;
  for (const [t, s] of row) {
    if (w >= n) break;
    const cs = [...t];
    const take = cs.length > n - w ? cs.slice(0, n - w).join('') : t;
    out.push([take, bg && !String(s).includes(' on ') ? `${s} on ${bg}` : s]);
    w += Math.min(cs.length, n - w);
  }
  if (w < n) out.push([' '.repeat(n - w), bg ? `text on ${bg}` : 'text']);
  return out;
}
export const pad = (s, n) => { const cs = [...String(s)]; return cs.length >= n ? cs.slice(0, n).join('') : String(s) + ' '.repeat(n - cs.length); };
export const cut = (s, n) => { const cs = [...String(s ?? '')]; return cs.length <= n ? cs.join('') : n <= 0 ? '' : `${cs.slice(0, Math.max(0, n - 1)).join('')}…`; };
const clock = (t) => new Date(t).toTimeString().slice(0, 8);
const hm = (t) => new Date(t).toTimeString().slice(0, 5);
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}
const countdown = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const spin = (now) => SPIN[Math.floor(now / 120) % SPIN.length];
export const chip = (kind) => [` ${(KIND[kind] ?? KIND.task)[0]} `, `white b on ${(KIND[kind] ?? KIND.task)[1]}`];
export const chipW = (kind) => (KIND[kind] ?? KIND.task)[0].length + 2;
const over = (l) => Boolean(l) && (l.state === 'done' || l.state === 'stopped');
const paceWord = (l) => (l.until ? 'until done' : l.every ? `every ${secsWord(l.every)}` : 'its own pace');
// Words wrapped to w cells; a word longer than w is cut where it must.
export function wrapWords(text, w) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ([...`${line} ${word}`.trim()].length <= w) { line = `${line} ${word}`.trim(); continue; }
      if (line) out.push(line);
      line = word;
      while ([...line].length > w) { out.push([...line].slice(0, w).join('')); line = [...line].slice(w).join(''); }
    }
    if (line) out.push(line);
  }
  return out;
}
// At most two lines, the second ending in … when there is more.
const twoLines = (text, w) => { const ls = wrapWords(text, w); return ls.length <= 2 ? [ls[0] ?? '', ls[1] ?? ''] : [ls[0], cut(ls.slice(1).join(' '), w)]; };
export const rule = (cols) => fit([p('─'.repeat(cols), 'faint')], cols);
export const blank = (cols) => fit([], cols);
// The loop the box talks to: the run you watch, else the picked card.
const pickedOf = (state, ui) => (ui.view === 'watch' || ui.confirm?.back === 'watch' ? state.loops.find((x) => x.id === ui.watch?.id) : null) ?? state.loops[ui.sel] ?? null;
const waitsForYou = (l) => Boolean(l.current?.needs || (l.stuck && !l.current) || (l.ready && !l.current));

export function header(state, ui, now, cols, title) {
  const run = state.loops.filter((l) => l.current && !l.current.needs).length;
  const need = state.loops.filter(waitsForYou).length;
  const m = state.model;
  // In the coding window, esc goes back to the chat; in a terminal of its own, it closes the board.
  const crumb = ui?.inApp ? [p(' esc ', 'white on user'), p(' chat ', 'dim'), p('› ', 'faint')] : [p(' ')];
  const right = [p(`${run} running`, run ? 'accent' : 'dim'), ...(need ? [p(' · ', 'faint'), p(`${need} needs you`, 'warn b')] : []), p('   '), p(m.on ? '● ' : '○ ', m.on ? 'accent' : 'faint'), p(cut(`${m.name} ${m.on ? (m.where === 'this Mac' ? 'loaded' : `on ${m.where}`) : 'off'}`, 34), m.on ? 'dim' : 'faint'), p(`   ${clock(now)} `, 'dim')];
  let left = [...crumb, p('↻ ', 'accent b'), p(title, 'white b'), p(`  ·  ${state.name} · ${state.folder}`, 'dim')];
  if (rowWidth(left) + rowWidth(right) + 1 > cols) left = [...crumb, p('↻ ', 'accent b'), p(title, 'white b'), p(`  ·  ${cut(state.name, Math.max(4, cols - rowWidth(right) - rowWidth(crumb) - title.length - 8))}`, 'dim')];
  return fit([...left, p(' '.repeat(Math.max(1, cols - rowWidth(left) - rowWidth(right)))), ...right], cols);
}
// keys: [key, word, a shorter word for a narrow window].
export function keysLine(cols, keys, toast, now) {
  if (toast && toast.until > now) return fit([p(' '), p(toast.text, toast.style ?? 'accent')], cols);
  const width = (list, gap) => list.reduce((n, [k, w]) => n + [...k].length + [...w].length + 1 + gap, 0) - gap + 1;
  const tight = width(keys, 3) > cols;
  const use = tight && width(keys, 2) > cols ? keys.map(([k, w, s]) => [k, s ?? w]) : keys;
  const row = [p(' ')];
  use.forEach(([k, w], i) => { if (i) row.push(p(tight ? '  ' : ' · ', 'faint')); row.push(p(k, 'white'), p(` ${w}`, 'dim')); });
  return fit(row, cols);
}

// ---- a run's lines, as the app draws a conversation ----
function runLines(l, run, lines, cols, now, { tail = null, full = false } = {}) {
  const out = [];
  if (!run) return out;
  const w = cols;
  const live = l.current && run.n === l.current.n;
  for (const x of lines) {
    if (x.kind === 'user') { if (full) out.push(fit([p(' > ', 'dim'), p(cut(x.text, w - 4), 'white')], w, 'user')); continue; }
    if (x.kind === 'you') { out.push(fit([p(' > ', 'accent b'), p(cut(x.text, w - 4), 'white')], w, 'user')); continue; }
    if (x.kind === 'heard') { out.push(fit([p('   ⎿ ', 'faint'), p(cut(`it read your note${x.after ? ` with the result of ${x.after}` : ''}`, w - 6), 'accentDim')], w)); continue; }
    if (x.kind === 'loopnote') { if (full) out.push(fit([p('   '), p(cut(String(x.text).replace(/\s+/g, ' '), w - 4), 'faint')], w)); continue; }
    if (x.kind === 'tool' || x.kind === 'fail') {
      const m = /^([A-Za-z ]+)\((.*)\)$/s.exec(x.text);
      out.push(fit([p(' ⏺ ', x.kind === 'fail' ? 'bad' : 'accent'), ...(m ? [p(m[1], 'white b'), p(`(${cut(m[2].replace(/\s+/g, ' '), w - m[1].length - 6)})`, 'dim')] : [p(cut(x.text, w - 4), 'white')])], w));
      if (x.kind === 'fail') out.push(fit([p('   ⎿ ', 'faint'), p(isTest(x) ? 'the tests fail' : 'did not work', 'badDim')], w));
      continue;
    }
    if (x.kind === 'note') { out.push(fit([p('   · ', 'faint'), p(cut(x.text, w - 6), 'dim')], w)); continue; }
    // The loop's page check (loops.mjs pageWords): checking, what it found.
    if (x.kind === 'page' || x.kind === 'check') { out.push(fit([p(' ◉ ', 'accent'), p(cut(x.text, w - 4), 'white')], w)); continue; }
    if (x.kind === 'ask') { if (live && l.current.needs && x === lines.at(-1)) continue; out.push(fit([p(' ? ', 'warn b'), p(cut(x.text, w - 4), 'warn')], w)); continue; }
    if (x.kind === 'answer') { out.push(fit([p('   ⎿ ', 'faint'), p(cut(`you: ${x.text}`, w - 6), 'dim')], w)); continue; }
    if (x.kind === 'text') {
      // The model's words, wrapped at words.
      wrapWords(String(x.text).replace(/[*`]/g, ''), w - 4).slice(0, full ? 400 : 8).forEach((t, i) => out.push(fit([p(i ? '   ' : ' ● ', 'white'), p(cut(t, w - 4), 'text')], w)));
    }
  }
  if (live && !l.current.needs) out.push(fit([p(` ${spin(now)} `, 'accent'), p(`Working… ${dur(now - run.startedAt)}`, 'dim')], w));
  return tail ? out.slice(-tail) : out;
}
const labelOf = (x) => String(x.text ?? '').split('(')[0];
// A run of the tests, as the run said (loop-run.mjs); a line written without that word is read by its command.
const isTest = (x) => (typeof x.test === 'boolean' ? x.test : labelOf(x) === 'Bash' && /\b(test|tests|pytest|jest|vitest|mocha|unittest|rspec)\b/.test(x.text));

// ---- a card: Now, Last, Next and You, in words ----
// What the run is doing now: the step it is on, read off its lines.
function nowWords(l, lines, now) {
  const q = l.current?.needs;
  if (q) return [`! asks you: ${q.text}`, 'warn'];
  if (l.ready && !l.current) return [`! run ${l.ready.n} waits for your go`, 'warn'];
  if (l.state === 'redoing') return [`${spin(now)} starting over`, 'accent'];
  if (l.current) {
    const took = dur(now - l.current.startedAt);
    const steps = lines.filter((x) => x.kind === 'tool' || x.kind === 'fail');
    const x = [...lines].reverse().find((y) => y.kind === 'tool' || y.kind === 'fail' || y.kind === 'text' || y.kind === 'page' || y.kind === 'check');
    if (!x) return [`${spin(now)} starting · ${took}`, 'accent'];
    if (x.kind === 'page' || x.kind === 'check') return [`${spin(now)} ${x.text} · ${took}`, 'accent'];
    if (x.kind === 'text') return [`${spin(now)} writing its answer · ${took}`, 'accent'];
    const m = /^([^(]+)\((.*)\)$/s.exec(x.text);
    const what = m ? `${m[1]} ${m[2].replace(/\s+/g, ' ')}` : x.text;
    return [`${spin(now)} step ${steps.length} · ${took} · ${what}${x.kind === 'fail' ? (isTest(x) ? ': the tests fail' : ': did not work') : ''}`, 'accent'];
  }
  if (l.stuck) return [`! stuck: ${l.stuck}`, 'warn'];
  if (l.state === 'paused') return ['‖ paused', 'dim'];
  if (l.state === 'done') return [`✓ ended: ${l.doneWhy ?? 'its job is done'}`, 'ok'];
  if (l.state === 'stopped') return ['■ stopped by you', 'faint'];
  if (l.state === 'off') return [`○ waits: ${l.offWhy ?? 'the model is off'}`, 'faint'];
  if (l.queued) return ['… next in line', 'dim'];
  return ['○ waiting for its next run', 'dim'];
}
// How its last run ended.
function lastWords(l) {
  const r = l.runs.at(-1);
  if (!r) return ['no run yet', 'faint'];
  if (r.undone) return [`↶ run ${r.n} put back${r.undone.put?.length ? `: ${r.undone.put.join(', ')}` : ''}`, 'dim'];
  if (r.redo) return [`↺ run ${r.n}: ${r.summary}`, 'dim'];
  return [`${r.ok ? '✓' : '✗'} run ${r.n}: ${r.summary}`, r.ok ? 'ok' : 'bad'];
}
// When it runs next, or what it waits for.
export function nextWords(l, now) {
  if (over(l)) return ['type a note: enter starts it again', 'faint'];
  if (l.current) return [l.pauseAfter ? 'it pauses after this run' : l.until ? 'until done: again 15 s after a miss' : `after this run, ${paceWord(l)}`, 'dim'];
  if (l.ready) return ['type y to start it, n to leave it out', 'warn'];
  if (l.stuck) return ['type a hint · ^R tries again as it is', 'warn'];
  if (l.state === 'redoing') return ['as soon as its changes are back', 'dim'];
  if (l.state === 'paused') return ['nothing until ^P', 'faint'];
  if (l.state === 'off') return ['when the model is on again', 'faint'];
  if (l.queued) return ['when the run before it ends', 'dim'];
  return [`run ${(l.runs.at(-1)?.n ?? 0) + 1} at ${clock(l.nextAt)} · in ${countdown(l.nextAt - now)}`, 'text'];
}
// Your last note, and what became of it: [the note, what became of it, its colour].
export function youWords(l) {
  const n = l.lastNote;
  if (!n) return ['nothing yet: type below', '', 'faint'];
  const said = `“${String(n.text).replace(/\s+/g, ' ')}”`;
  if (n.read?.after) return [said, `✓ read after ${n.read.after}`, 'accentDim'];
  if (n.read?.start) return [said, `✓ read at the start of run ${n.read.start}`, 'accentDim'];
  if (n.read?.late) return [said, '✓ read as it gave its answer', 'accentDim'];
  if (l.note) return [said, 'its next run starts with it', 'dim'];
  return [said, 'sent: it reads it at its next step', 'dim'];
}
// ---- the buttons: under each card and over a run you open ----
// What a loop's buttons are, by what it is doing: [id, word, a shorter word]. The board presses
// them (loops-board.mjs press); the ctrl keys of 4 Oct still do the same.
export function buttonsOf(l, model = {}) {
  if (!l) return [];
  const q = l.current?.needs;
  if (q?.kind === 'question' && q.options?.length) return [...q.options.slice(0, 3).map((o, i) => [`pick${i + 1}`, `Answer ${i + 1}`, `${i + 1}`]), ['open', 'Open']];
  if (q) return [['yes', 'Yes'], ...(q.always ? [['always', 'Always']] : []), ['no', 'No'], ['open', 'Open']];
  if (l.ready && !l.current) return [['go', 'Go'], ['skip', 'Skip'], ['rules', 'Rules'], ['open', 'Open']];
  if (l.state === 'redoing') return [['open', 'Open']];
  if (over(l)) return [['again', 'Start again', 'Again'], ['undo', 'Undo'], ['open', 'Open']];
  if (l.current) return [['pause', l.pauseAfter ? 'Keep going' : 'Pause', l.pauseAfter ? 'Go on' : 'Pause'], ['stop', 'Stop'], ['redo', 'Start over', 'Redo'], ['open', 'Open']];
  if (l.stuck) return [['run', 'Try again', 'Retry'], ['stop', 'Stop'], ['open', 'Open']];
  if (l.state === 'off' && model.wake) return [['wake', 'Turn the model on', 'Model on'], ['stop', 'Stop'], ['open', 'Open']];
  if (l.state === 'paused') return [['pause', 'Resume'], ['stop', 'Stop'], ['undo', 'Undo'], ['open', 'Open']];
  return [['run', 'Run now', 'Run'], ['pause', 'Pause'], ['stop', 'Stop'], ['undo', 'Undo'], ['open', 'Open']];
}
// Over a run you opened: older and newer runs, then what you can do to the loop, then back.
export function watchButtonsOf(l, model = {}) {
  if (!l) return [['back', 'Back']];
  const q = l.current?.needs;
  const answer = q ? buttonsOf(l, model).filter(([id]) => id !== 'open') : [];
  const doing = over(l) ? [['again', 'Start again', 'Again']] : l.current ? [['pause', l.pauseAfter ? 'Keep going' : 'Pause'], ['stop', 'Stop']] : [['run', 'Run now', 'Run'], ['pause', l.state === 'paused' ? 'Resume' : 'Pause'], ['stop', 'Stop']];
  return [...answer, ['older', '‹ Older run', '‹ Older'], ['newer', 'Newer run ›', 'Newer ›'], ...(over(l) ? [] : [['redo', 'Start over', 'Redo']]), ['rules', 'Rules'], ['save', 'Save'], ['undo', 'Undo'], ...doing, ['back', 'Back']];
}
// A row of buttons in w cells: the lit one bright when the row is the one the keys move on.
// Full words where they fit, else the shorter ones.
function buttonRow(btns, lit, w, active) {
  const width = (short) => btns.reduce((n, [, word, sh]) => n + [...(short ? sh ?? word : word)].length + 2, 0) + Math.max(0, btns.length - 1);
  const short = width(false) > w;
  const row = [];
  btns.forEach(([, word, sh], i) => {
    if (i) row.push(p(' '));
    const on = active && i === lit;
    row.push(p(` ${short ? sh ?? word : word} `, on ? 'white b on btnOn' : active ? 'text on btn' : 'dim on btn'));
  });
  return fit(row, w);
}
const litOf = (ui, n) => Math.max(0, Math.min(ui.btn ?? 0, n - 1));

function card(l, lines, sel, w, now, ui = {}, model = {}) {
  const bs = waitsForYou(l) ? 'warn' : sel ? 'white' : 'border';
  const inner = w - 4;
  const side = (row) => fit([p('│ ', bs), ...fit(row, inner), p(' │', bs)], w);
  const lab = (t) => p(pad(t, 6), 'faint');
  const tw = inner - 6;
  const name = ` ${cut(l.name, inner - chipW(l.kind) - 2)} `;
  const n = l.current?.n ?? l.runs.at(-1)?.n ?? 0;
  const info = [paceWord(l), n ? `run ${n}${l.maxRuns ? ` of ${l.maxRuns}` : ''}` : 'no run yet', ...limitWords(l, { short: true }).filter((x) => !/runs$/.test(x)), modeName(l.mode), ...(l.askFirst ? ['asks first'] : [])].join(' · ');
  const nw = nowWords(l, lines, now), lw = lastWords(l), xw = nextWords(l, now), yw = youWords(l);
  const now2 = twoLines(nw[0], tw), last2 = twoLines(lw[0], tw);
  return [
    fit([p('┌─', bs), chip(l.kind), p(name, sel ? 'white b' : 'text'), p('─'.repeat(Math.max(0, w - 3 - chipW(l.kind) - [...name].length)), bs), p('┐', bs)], w),
    side([p(cut(info, inner), 'dim')]),
    side([lab('Now'), p(now2[0], nw[1])]),
    side([lab(''), p(now2[1], nw[1])]),
    side([lab('Last'), p(last2[0], lw[1])]),
    side([lab(''), p(last2[1], lw[1])]),
    side([lab('Next'), p(cut(xw[0], tw), xw[1])]),
    side([lab('You'), p(cut(yw[0], tw), yw[1] ? 'white' : yw[2])]),
    side([lab(''), p(cut(yw[1], tw), yw[2])]),
    fit([p('│', bs), ...buttonRow(buttonsOf(l, model), litOf(ui, buttonsOf(l, model).length), w - 2, sel), p('│', bs)], w),
    fit([p('└', bs), p('─'.repeat(w - 2), bs), p('┘', bs)], w),
  ];
}

// ---- the lines every screen ends with ----
function logPieces(state, e, w) {
  const l = e.id ? state.loops.find((x) => x.id === e.id) : null;
  const head = [p(`${clock(e.at)} `, 'dim'), ...(e.kind === 'you' ? [p(' YOU ', 'white b on user')] : l ? [chip(l.kind)] : [p('  ·  ', 'faint')]), p(' '.repeat(Math.max(1, 7 - (e.kind === 'you' ? 5 : l ? chipW(l.kind) : 5))))];
  const name = l ? cut(l.name, 20) : '';
  const room = w - rowWidth(head) - 2;
  if (e.kind === 'end') return [...head, p(`${name} · run ${e.n}  `, 'dim'), p(cut(`${e.ok ? '✓' : '✗'} ${e.text}`, room - name.length - 18), e.ok ? 'ok' : 'bad'), p(`  ${dur(e.ms)}`, 'faint')];
  if (e.kind === 'ask') return [...head, p(`${name} asks: `, 'dim'), p(cut(e.text, room - name.length - 7), 'warn')];
  if (e.kind === 'stuck') return [...head, p(`${name} waits for you: `, 'dim'), p(cut(e.text, room - name.length - 17), 'warn')];
  if (e.kind === 'answer') return [...head, p(`${name}: `, 'dim'), p(cut(`you answered “${e.text}”`, room - name.length - 2), 'text')];
  if (e.kind === 'you') return [...head, p(`to ${name}: `, 'dim'), p(cut(`“${e.text}”`, room - name.length - 5), 'white')];
  if (e.kind === 'new') return [...head, p(`${name}: `, 'dim'), p(cut(`a new loop · ${e.text}`, room - name.length - 2), 'text')];
  return [...head, p(l ? `${name}: ` : '', 'dim'), p(cut(e.text, room - name.length - 2), 'dim')];
}
// What waits for you: the picked loop's question (its choices on a row of their own), its go, its
// hint; else a line naming another loop that waits, and how to pick it.
function needRows(state, ui, cols) {
  const l = pickedOf(state, ui);
  const row = (pieces) => fit(pieces, cols, 'needs');
  const keys = (list) => list.flatMap(([k, w], i) => [...(i ? [p(' · ', 'dim')] : []), p(k, 'white b'), p(` ${w}`, 'dim')]);
  const q = l?.current?.needs;
  if (q) {
    const head = [p(' ! ', 'warn b'), chip(l.kind), p(` ${cut(l.name, 22)} asks: `, 'white')];
    if (q.kind === 'question') {
      const opts = (q.options ?? []).slice(0, 9);
      const out = [row([...head, p(cut(q.text, cols - rowWidth(head) - 2), 'white b')])];
      if (opts.length) { const each = Math.max(8, Math.floor((cols - 6) / opts.length) - 6); out.push(row([p('   '), ...opts.flatMap((o, i) => [p(`${i + 1}`, 'white b on needs'), p(` ${cut(o, each)}   `, 'white')]), p('or type your own answer', 'dim')])); }
      return out;
    }
    const how = [p('type ', 'dim'), ...keys([['y', 'yes'], ...(q.always ? [['a', cols >= 110 ? `yes, always (${cut(q.always, 20)})` : 'always']] : []), ['n', 'no']])];
    return [row([...head, p(cut(q.text, Math.max(10, cols - rowWidth(head) - rowWidth(how) - 4)), 'white b'), p(' '.repeat(Math.max(2, cols - rowWidth(head) - [...cut(q.text, Math.max(10, cols - rowWidth(head) - rowWidth(how) - 4))].length - rowWidth(how) - 1))), ...how])];
  }
  if (l?.ready && !l.current) {
    const how = [p('type ', 'dim'), ...keys([['y', 'go'], ['n', l.every ? 'skip this one' : 'not now (pause)'], ['^O', 'edit first']])];
    const head = [p(' ! ', 'warn b'), chip(l.kind), p(` ${cut(l.name, 26)} · run ${l.ready.n} is ready and waits for your go`, 'white b')];
    return [row([...head, p(' '.repeat(Math.max(2, cols - rowWidth(head) - rowWidth(how) - 1))), ...how])];
  }
  if (l?.stuck && !l.current) {
    const how = keys([['type', 'a hint'], ['^R', 'try again'], ['^S', 'stop']]);
    const head = [p(' ! ', 'warn b'), chip(l.kind), p(` ${cut(l.name, 22)} is stuck: `, 'white')];
    const why = cut(l.stuck.split(':')[0], Math.max(10, cols - rowWidth(head) - rowWidth(how) - 4));
    return [row([...head, p(why, 'white b'), p(' '.repeat(Math.max(2, cols - rowWidth(head) - [...why].length - rowWidth(how) - 1))), ...how])];
  }
  const other = state.loops.find((x) => x !== l && waitsForYou(x));
  if (other) {
    const up = state.loops.indexOf(other) < state.loops.indexOf(l);
    return [row([p(' ! ', 'warn b'), chip(other.kind), p(` ${cut(other.name, 30)} ${other.current?.needs ? 'asks you something' : other.stuck ? 'is stuck' : 'waits for your go'}`, 'white'), p(`  ·  ${up ? '↑' : '↓'} picks it`, 'dim')])];
  }
  return [blank(cols)];
}
// The box: typing always goes in it. Its title says what enter does with the words.
function inputBox(state, ui, cols, now) {
  const l = pickedOf(state, ui);
  const text = ui.chat?.text ?? '';
  const slash = /^\//.test(text);
  const as = l && !over(l) && !slash ? ui.chat?.as ?? 'note' : 'note';
  const q = l?.current?.needs;
  const ready = l?.ready && !l.current;
  const name = l ? cut(l.name, 30) : '';
  const title = slash ? ' a /loop line ' : !l ? ' a new loop ' : as === 'redo' ? ` start ${name} over with this · its changes go back first ` : as === 'redoKeep' ? ` start ${name} over with this · its changes stay ` : q ? (q.kind === 'question' ? ` your answer to ${name} ` : ` ${name} asks: y, ${q.always ? 'a, ' : ''}n, or a note `) : ready ? ` ${name}: y starts run ${l.ready.n}, n leaves it out, or a note ` : over(l) ? ` ${name} has ended · enter starts it again with this ` : l.stuck ? ` a hint for ${name} · enter sends it on with it ` : l.current ? ` to ${name} · it reads it at its next step ` : ` to ${name} · its next run starts with it `;
  const bs = q || ready || l?.stuck ? 'warn' : 'accent';
  const w = cols - 2;
  const room = w - 6;
  const shown = [...text].length > room ? `…${[...text].slice(-(room - 1)).join('')}` : text;
  const ph = !l ? 'type /loop and what it should do, or tab for the Library' : q?.kind === 'question' ? (q.options?.length ? `type 1–${Math.min(9, q.options.length)}, or your own answer` : 'type your answer') : q ? 'type y, a or n and enter (anything else goes to it as a note)' : `type to tell ${l.name} what to do`;
  const inner = [p(' › ', 'accent b'), p(shown, 'white'), p(Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent'), ...(text ? [] : [p(ph, 'faint')])];
  const hint = ` enter ${slash ? 'sends the line' : as !== 'note' ? 'starts over' : q ? 'answers' : over(l) ? 'starts it again' : 'sends'}${state.loops.length > 1 ? ' · ↑↓ another loop' : ''} `;
  return [
    fit([p(' ╭─', bs), p(title, 'white b'), p('─'.repeat(Math.max(0, w - 3 - [...title].length)), bs), p('╮', bs)], cols),
    fit([p(' │', bs), ...fit(inner, w - 2), p('│', bs)], cols),
    fit([p(' ╰', bs), p('─'.repeat(Math.max(0, w - 3 - hint.length)), bs), p(hint, 'dim'), p('─╯', bs)], cols),
  ];
}
function bottomBlock(state, ui, cols, now, keys) {
  const out = [...needRows(state, ui, cols), ...inputBox(state, ui, cols, now)];
  if (ui.view === 'confirm') out.push(fit([p(' '), p(cut(ui.confirm.text, cols - 40), 'warn b'), p('   y', 'white b'), p(' yes   ', 'dim'), p('n', 'white b'), p(' no', 'dim'), p('   (enter does nothing here)', 'faint')], cols));
  else out.push(keysLine(cols, keys, ui.toast, now));
  return out;
}
// The keys: the buttons do the rest (the ctrl keys of 4 Oct still work, unlisted).
const mainKeys = (ui, state) => (ui.chat?.text ? [['enter', 'sends what you typed', 'sends'], ['esc', 'clears it', 'clear'], ['↑↓', 'another loop', 'loop']]
  : [['←→', 'a button'], ['enter', 'presses it', 'press'], ...(state.loops.length > 1 ? [['↑↓', 'another loop', 'loop']] : []), ['tab', 'the library', 'library'], ['^N', 'new loop', 'new'], ['type', 'talk to it'], ['esc', ui.inApp ? 'chat' : 'close']]);

// ---- the cards ----
function drawCards(state, ui, { cols, rows, now, linesOf }) {
  const out = [header(state, ui, now, cols, 'Loops'), rule(cols), ...shelfTabs(state, ui, cols)];
  const bottom = bottomBlock(state, ui, cols, now, mainKeys(ui, state));
  const body = rows - out.length - bottom.length;
  const lines = [];
  const n = state.loops.length;
  if (!n) {
    const w = Math.min(78, cols - 8);
    const x = Math.floor((cols - w) / 2);
    const boxRow = (row) => fit([p(' '.repeat(x)), p('│ ', 'border'), ...fit(row, w - 4), p(' │', 'border')], cols);
    lines.push(blank(cols));
    lines.push(fit([p(' '.repeat(x)), p(`┌${'─'.repeat(w - 2)}┐`, 'border')], cols));
    lines.push(boxRow([p('No loop yet in this window.', 'white b')]));
    lines.push(boxRow([]));
    lines.push(boxRow([p('tab', 'white b'), p(' opens the Library: a ready-made loop, one you kept, or a new one.', 'dim')]));
    lines.push(boxRow([]));
    lines.push(boxRow([p('Or say it in a sentence in the box below, then enter:', 'dim')]));
    lines.push(boxRow([p('  /loop run the tests every 10 min until 6pm', 'white')]));
    lines.push(boxRow([p('  /loop fix the failing tests until they pass', 'white')]));
    lines.push(boxRow([p('  /loop read bun.sh/blog every hour, stop after 5 runs', 'white')]));
    lines.push(fit([p(' '.repeat(x)), p(`└${'─'.repeat(w - 2)}┘`, 'border')], cols));
  } else {
    // Three cards across in a wide window (two in a narrow one), the picked one among them.
    const show = Math.min(n, cols >= 118 ? 3 : 2);
    const gap = 2;
    const bw = Math.min(44, Math.floor((cols - 2 - (show - 1) * gap) / show));
    const first = Math.max(0, Math.min(ui.sel - Math.floor((show - 1) / 2), n - show));
    const vis = state.loops.slice(first, first + show);
    const x0 = Math.floor((cols - (show * bw + (show - 1) * gap)) / 2);
    const cards = vis.map((l, i) => card(l, linesOf(l, l.current?.n ?? l.runs.at(-1)?.n ?? 0), first + i === ui.sel, bw, now, ui, state.model));
    for (let y = 0; y < CARD_H; y++) lines.push(fit([p(' '.repeat(x0)), ...cards.flatMap((c, i) => [...(i ? [p(' '.repeat(gap))] : []), ...c[y]])], cols));
    const less = first > 0 ? `  ‹ ${first} more` : '';
    const more = first + show < n ? `${n - first - show} more ›  ` : '';
    lines.push(fit([p(less, 'faint'), p(' '.repeat(Math.max(0, cols - less.length - more.length))), p(more, 'faint')], cols));
  }
  // What happened, newest first: it takes the rows that are left.
  const logH = body - lines.length;
  if (logH >= 2) {
    const events = state.log.filter((e) => e.kind !== 'start').slice(-(logH - 1)).reverse();
    lines.push(fit([p('  What happened', 'white b'), p('   newest first', 'faint')], cols));
    for (let i = 0; i < logH - 1; i++) lines.push(events[i] ? fit([p('  '), ...fit(logPieces(state, events[i], cols - 4), cols - 4)], cols) : i === 0 ? fit([p('  nothing yet', 'faint')], cols) : blank(cols));
  }
  for (let i = 0; i < body; i++) out.push(lines[i] ?? blank(cols));
  return [...out, ...bottom];
}

// ---- one run full size (^G), the box under it ----
function drawWatch(state, ui, { cols, rows, now, linesOf }) {
  const l = state.loops.find((x) => x.id === ui.watch.id) ?? state.loops[ui.sel];
  const out = [header(state, ui, now, cols, 'Loops')];
  if (!l) { while (out.length < rows) out.push(blank(cols)); return out; }
  const run = ui.watch.n ? [...l.runs, ...(l.current ? [l.current] : [])].find((r) => r.n === ui.watch.n) : (l.current ?? l.runs.at(-1));
  const live = run && l.current && run.n === l.current.n;
  const said = !run || live ? null : run.undone ? [`↶ put back${run.undone.put?.length ? `: ${run.undone.put.join(', ')}` : ''}`, 'dim'] : run.redo ? [`↺ ${run.summary}`, 'dim'] : [`${run.ok ? '✓' : '✗'} ${run.summary}`, run.ok ? 'ok' : 'bad'];
  out.push(fit([p('  '), chip(l.kind), p(' '), p(l.name, 'white b'), p(run ? `  ·  run ${run.n}  ·  ${live ? `live, ${dur(now - run.startedAt)}` : `${hm(run.startedAt)}, took ${dur(run.endedAt - run.startedAt)}  ·  `}` : '  ·  no run yet', 'dim'), ...(said ? [p(cut(said[0], 60), said[1])] : [])], cols));
  const wb = watchButtonsOf(l, state.model);
  out.push(fit([p('  '), ...buttonRow(wb, litOf(ui, wb.length), cols - 4, true)], cols));
  out.push(rule(cols));
  const bottom = bottomBlock(state, ui, cols, now, ui.chat?.text ? [['enter', 'sends what you typed', 'sends'], ['esc', 'clears it', 'clear']] : [['←→', 'a button'], ['enter', 'presses it', 'press'], ['↑↓', 'scroll'], ['type', 'talk to it'], ['esc', 'back to the cards', 'back']]);
  const body = rows - out.length - bottom.length;
  const lines = runLines(l, run, run ? linesOf(l, run.n) : [], cols - 2, now, { full: true });
  const scroll = Math.max(0, Math.min(ui.watch.scroll ?? 0, lines.length - body));
  const start = Math.max(0, lines.length - body - scroll);
  for (let i = 0; i < body; i++) out.push(fit([p(' '), ...(lines[start + i] ?? [])], cols));
  out.push(...bottom);
  return out;
}

// ---- the setup wizard (9 Oct 2026): a new loop, or one loop's rules, a step at a time ----
// The owner, on a one-page setup: "can we make this step easier? like a step by step wizard? with a
// nice ui / visual of the actual loops and what they are going to do?". Five steps (What · Where ·
// How often · Until · Start), one question each, and beside them the loop as it is being made: what
// each run is told, the steps a run takes with the way back to the next run, when the runs fall, and
// where it works. A step not reached yet is drawn faint. /loop <a sentence> opens at the last step
// with what was read; a loop's Rules open its own there (Where is not asked again). Their earlier
// picks hold: Start turns the model on, your home folder is warned about, and you see what it will do.
// The wizard's state is ui.setup (loops-board.mjs openSetup, setupKey); these are pure.
export const TEMPLATES = [
  { kind: 'test', name: 'Run the tests', about: 'and say what fails', text: 'run the tests and say what fails' },
  { kind: 'debug', name: 'Fix the failing tests', about: 'until they all pass', text: 'fix the failing tests until they all pass' },
  { kind: 'web', name: 'Watch a web page', about: 'and say what is new', text: 'read the Bun releases page and tell me when there is a new version' },
  { kind: 'test', name: 'Check the build', about: 'and the lint', text: 'check the build and the lint, change nothing' },
  { kind: null, name: 'Something else', about: 'type it below', text: '' },
];
export const MODE_NOTE = { ask: 'asks before each change', edits: 'edits without asking, asks before commands', auto: 'Auto decides what to ask', plan: 'plans only, changes nothing', bypass: 'never asks' };
export const STEP_NAME = { what: 'What', where: 'Where', often: 'How often', stop: 'Until', start: 'Start' };
export const wizardSteps = (su) => ['what', ...(su.id ? [] : ['where']), 'often', 'stop', 'start'];
export const stepOf = (su) => wizardSteps(su)[Math.min(su.step ?? 0, wizardSteps(su).length - 1)];
export const MORE_ROWS = ['mode', 'cap', 'steps', 'ask'];
export const kindOfSetup = (su) => su.f.kind ?? guessKind(su.text ?? '');
// Which template the words are: one whose words they are, else Something else.
export const templateOf = (su) => { const i = TEMPLATES.findIndex((t) => t.text && t.text === (su.text ?? '').trim()); return i >= 0 ? i : (su.text ?? '').trim() ? TEMPLATES.length - 1 : su.tpl ?? 0; };
// A row's choices: [value, word, note]. Until's values are { runs, stopAt }.
export function setupChoices(row, su, state = {}, now = Date.now()) {
  const kind = kindOfSetup(su);
  if (row === 'often') return [
    ...(kind === 'debug' ? [['until done', su.f.check ? 'until the page is clean' : 'until the tests pass', 'again 15 s after a miss']] : []),
    ['1m', 'every minute'], ['5m', 'every 5 minutes'], ['10m', 'every 10 minutes'], ['30m', 'every 30 minutes'], ['1h', 'every hour'],
    ['own pace', 'at its own pace', 'it decides, about every 10 minutes'],
  ];
  if (row === 'stop') {
    const t = new Date(now + 15 * 60_000);
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() <= 30 ? 30 : 60);
    const at = (h) => hm(t.getTime() + h * 3_600_000);
    return [
      [{ runs: 'no limit', stopAt: 'none' }, 'when I close the window', `or after ${state.maxHours ?? 24} hours`],
      ...['1', '5', '10', '20'].map((n) => [{ runs: n, stopAt: 'none' }, `after ${n} run${n === '1' ? '' : 's'}`]),
      [{ runs: 'no limit', stopAt: '1h' }, 'in 1 hour', `at ${hm(now + 3_600_000)}`], [{ runs: 'no limit', stopAt: '2h' }, 'in 2 hours', `at ${hm(now + 7_200_000)}`],
      [{ runs: 'no limit', stopAt: at(0) }, `at ${at(0)}`], [{ runs: 'no limit', stopAt: at(2) }, `at ${at(2)}`],
    ];
  }
  if (row === 'where') return (state.places ?? [{ path: null, shown: state.folder ?? '' }]).map((x) => [x.path, x.shown, x.shown === '~' ? 'your home folder' : x.tests ? 'tests found' : 'no tests found']);
  if (row === 'mode') return [...LOOP_MODES, ...(su.f.mode === 'bypass' ? ['bypass'] : [])].map((m) => [m, modeName(m), MODE_NOTE[m]]);
  if (row === 'cap') return ['none', '$0.25', '$0.50', '$1.00', '$2.00', '$5.00'].map((c) => [c, c === 'none' ? 'no cap' : c, 'on a paid service']);
  if (row === 'steps') return [STEPS_WORD, '10', '20', '40', '80', '120'].map((v) => [v, v === STEPS_WORD ? 'as /effort' : `${v} steps`, 'a run stops after this many']);
  if (row === 'ask') return [[false, 'off', 'each run starts by itself'], [true, 'on', 'each run waits for your go']];
  return [];
}
// Where the row's value is among its choices (-1: typed, or not one of them).
export function setupPick(row, su, state = {}, now = Date.now()) {
  const cs = setupChoices(row, su, state, now);
  const f = su.f;
  if (row === 'often') return su.custom.often ? -1 : cs.findIndex(([v]) => v === f.every);
  if (row === 'stop') return su.custom.stop ? -1 : cs.findIndex(([v]) => v.runs === f.runs && v.stopAt === f.stopAt);
  if (row === 'where') { const i = cs.findIndex(([v]) => v === f.folder); return i < 0 ? 0 : i; }
  const key = { mode: 'mode', cap: 'cap', steps: 'steps', ask: 'askFirst' }[row];
  return cs.findIndex(([v]) => v === f[key]);
}
// What each run is told: the box's words, each chip ([Image #1]: loops-board.mjs handlePaste) as its
// copy's path, which the run's `coding -p` sends as a picture (cli.jsx); in quotes when it has a space.
export function messageOf(su) {
  const files = su.pasted?.files;
  const text = String(su.text ?? '').replace(ATTACH_TOKEN, (chip, kind, n) => {
    const file = files?.get(Number(n));
    if (!file) return chip;
    const shown = file.startsWith(`${homedir()}/`) ? `~${file.slice(homedir().length)}` : file;
    return /\s/.test(shown) ? `'${file}'` : shown;
  });
  return text.replace(/[ \t]+/g, ' ').trim();
}
// The wizard's fields as rulesOf reads them.
export function setupFields(su, state = {}) {
  const f = su.f;
  const every = su.custom.often ? su.custom.often.trim() : f.every;
  let { runs, stopAt } = f;
  const t = su.custom.stop?.trim();
  if (t) { if (/^\d+$/.test(t.replace(/\s*runs?$/i, ''))) { runs = t.replace(/\s*runs?$/i, ''); stopAt = 'none'; } else { runs = 'no limit'; stopAt = t.replace(/^(at|in)\s+/i, ''); } }
  const name = su.id ? su.name : (su.save?.name ?? '').trim() || su.loaded?.name || '';
  return { message: messageOf(su), kind: kindOfSetup(su), every, runs, stopAt, cap: f.cap, steps: f.steps, mode: f.mode, askFirst: f.askFirst, folder: f.folder ?? state.places?.[0]?.path ?? null, name, picture: su.picture ?? null,
    // Its page check (a loaded loop's "- Page check: {page}"), with the blank as answered.
    ...(f.check ? { check: String(f.check).replace(/\{([a-z][a-z0-9_-]{0,30})\}/gi, (all, k) => (su.fills ?? []).find((x) => x.key === k)?.value?.trim() || all) } : {}) };
}
const placeOf = (su, state) => (state.places ?? []).find((x) => x.path === setupFields(su, state).folder) ?? { shown: state.folder ?? '', tests: false };
// What to look at before Start: [mark, words, style]; warnings only (the picture says the rest).
export function setupChecks(su, state = {}) {
  const m = state.model ?? {};
  const where = placeOf(su, state);
  const kind = kindOfSetup(su);
  const projects = (state.places ?? []).filter((x) => x.shown !== '~').length;
  const out = [];
  if (!m.on) out.push(m.wake ? ['!', `${m.name} is off: Start turns it on`, 'warn'] : ['!', `${m.why || `${m.name} is off`}: the first run waits for it`, 'warn']);
  if (where.shown === '~') out.push(['!', projects ? `Your home folder is not a project: ${su.id ? 'its runs work there' : 'pick one at Where'}` : 'This window is in your home folder: open coding in a project first', 'warn']);
  else if (!where.tests && (kind === 'test' || kind === 'debug')) out.push(['!', `No tests found in ${where.shown}: a test run may find nothing to run`, 'warn']);
  if (su.loaded?.from === 'project' && !su.loaded.trusted) out.push(['!', `This loop came with ${su.loaded.project}: read what it is told on the right. Start runs it, and it won't ask again`, 'warn']);
  return out;
}

// ---- the picture of the loop ----
export const CYCLE = {
  debug: [['RUN', 'the tests'], ['FIND', 'the cause'], ['FIX', 'the code']],
  test: [['RUN', 'the tests'], ['READ', 'what fails'], ['TELL', 'you']],
  web: [['OPEN', 'the page'], ['READ', 'what is new'], ['TELL', 'you']],
  task: [['LOOK', 'at the folder'], ['DO', 'what you asked'], ['TELL', 'you']],
};
// When the runs fall, as the wizard has it now: [{ when, label }], whether more come, and the end.
export function runsAhead(su, state = {}, now = Date.now(), most = 5) {
  const f = setupFields(su, state);
  const goal = f.check ? 'clean' : 'all pass';
  const kind = kindOfSetup(su);
  const ev = readEvery(f.every, { kind });
  const runs = readRuns(f.runs).maxRuns ?? null;
  const stop = readStopAt(f.stopAt, now).stopAt ?? null;
  const first = state.model?.on ? 'now' : 'once on';
  if (ev.until) return { slots: [{ when: first, label: 'run 1' }, { when: '15 s on', label: 'not yet?' }, { when: '15 s on', label: 'again' }].slice(0, Math.min(3, runs ?? 3)), more: !runs || runs > 3, end: runs ? `ends when ${goal}, or after run ${runs}` : `ends when ${goal}`, ok: true };
  const gap = (ev.every ?? 600) * 1000;
  const slots = [];
  for (let i = 0, t = now; i < Math.min(most, runs ?? most); i++, t += gap) {
    if (stop && t >= stop) break;
    slots.push({ when: i ? `${ev.every ? '' : '~'}${hm(t)}` : first, label: `run ${i + 1}` });
  }
  const nextAt = now + slots.length * gap;
  const more = runs ? runs > slots.length : !(stop && nextAt >= stop);
  const end = runs ? `ends after run ${runs}` : stop ? `ends at ${hm(stop)}` : 'ends when you close the window';
  return { slots, more, end };
}
const ARROW = ' ──▶ ';
export function loopPicture(su, state, w, now) {
  const rows = [];
  const steps = wizardSteps(su);
  const at = su.typed ? steps.length : steps.indexOf(stepOf(su));
  const seen = (name) => su.id || su.typed || steps.indexOf(name) <= at;
  const kind = kindOfSetup(su);
  const f = setupFields(su, state);
  const dim = (on, s) => (on ? s : 'faint');
  const center = (pieces) => { const n = rowWidth(pieces); return fit([p(' '.repeat(Math.max(0, Math.floor((w - n) / 2)))), ...pieces], w); };
  // What each run is told (a picture as its chip, not its copy's path).
  const told = (su.text ?? '').trim();
  const words = wrapWords(f.message ? `“${told}”` : 'What each run does comes here: pick it or type it on the left', w - 4);
  const said = words.length > 2 ? [words[0], cut(words.slice(1).join(' '), w - 4)] : words;
  said.forEach((t) => rows.push(center([p(t, f.message ? 'white b' : 'faint')])));
  if (said.length < 2) rows.push(blank(w));
  rows.push(blank(w));
  // The steps of one run, in boxes, and the way back to the next run under them.
  const cyc = su.picture ?? CYCLE[kind] ?? CYCLE.task;
  const on = Boolean(f.message);
  const bw = Math.max(12, Math.min(18, Math.floor((w - 2 * ARROW.length - 2) / 3)));
  const span = 3 * bw + 2 * ARROW.length;
  const x = Math.max(0, Math.floor((w - span) / 2));
  const bs = dim(on, 'border');
  const line = (fn) => rows.push(fit([p(' '.repeat(x)), ...cyc.flatMap((c, i) => [...(i ? fn.gap(i) : []), ...fn.box(c, i)])], w));
  line({ gap: () => [p(' '.repeat(ARROW.length))], box: () => [p(`┌${'─'.repeat(bw - 2)}┐`, bs)] });
  line({ gap: () => [p(ARROW, dim(on, 'accent'))], box: ([verb], i) => [p('│', bs), p(` ${i + 1} `, 'faint'), p(pad(verb, bw - 5), dim(on, 'accent b')), p('│', bs)] });
  line({ gap: () => [p(' '.repeat(ARROW.length))], box: ([, what]) => [p('│', bs), p(`   ${pad(cut(what, bw - 6), bw - 6)} `, dim(on, 'text')), p('│', bs)] });
  const c1 = x + Math.floor(bw / 2), c3 = x + 2 * (bw + ARROW.length) + Math.floor(bw / 2);
  line({ gap: () => [p(' '.repeat(ARROW.length))], box: () => [p(`└${'─'.repeat(bw - 2)}┘`, bs)] });
  const ev = readEvery(f.every, { kind });
  const known = seen('often');
  const waitFor = (secs) => (secs === 3600 ? 'an hour' : secs === 86_400 ? 'a day' : spokenEvery(secs));
  const back = !known ? ' then the next run ' : ev.until ? (f.check ? ' still broken? again 15 s later ' : ' not all pass? again 15 s later ') : ev.every ? ` wait ${waitFor(ev.every)}, then again ` : ' it picks when, about 10 min ';
  rows.push(fit([p(' '.repeat(c1)), p('▲', bs), p(' '.repeat(Math.max(0, c3 - c1 - 1))), p('│', bs)], w));
  const room = c3 - c1 - 1;
  const lab = cut(back, room - 2);
  const l1 = Math.max(1, Math.floor((room - [...lab].length) / 2));
  rows.push(fit([p(' '.repeat(c1)), p('└', bs), p('─'.repeat(l1), bs), p(lab, dim(known && on, 'white')), p('─'.repeat(Math.max(0, room - l1 - [...lab].length)), bs), p('┘', bs)], w));
  rows.push(blank(w));
  // When the runs fall: a mark a run, as many as fit, then where it ends.
  const stopSeen = seen('stop');
  const cw = 9;
  let tl = runsAhead(su, state, now, 5);
  const fits = Math.max(2, Math.min(5, Math.floor((w - [...tl.end].length - 10) / cw)));
  if (tl.slots.length > fits) tl = { ...runsAhead(su, state, now, fits), end: tl.end, ok: tl.ok, more: true };
  const times = [], marks = [], labels = [];
  tl.slots.forEach((s, i) => {
    times.push(p(pad(s.when, cw), dim(known, i ? 'dim' : 'white')));
    marks.push(p(i ? '○' : '●', dim(known, 'accent b')), p('━'.repeat(cw - 1), dim(known, 'accent')));
    labels.push(p(pad(s.label, cw), dim(known, 'dim')));
  });
  if (tl.more) marks.push(p('┄┄ ', 'faint'));
  marks.push(p(tl.ok ? '✓ ' : '◆ ', dim(stopSeen, tl.ok ? 'ok b' : 'warn b')), p(tl.end, dim(stopSeen, 'white')));
  const tx = Math.max(0, Math.floor((w - rowWidth(marks)) / 2));
  for (const r of [times, marks, labels]) rows.push(fit([p(' '.repeat(tx)), ...r], w));
  rows.push(blank(w));
  // Where it works, how, on what, and when it ends.
  const where = placeOf(su, state);
  const m = state.model ?? {};
  const fact = (mark, words, style, isSeen = true) => rows.push(fit([p('  '), p(`${mark} `, dim(isSeen, `${style} b`)), p(cut(words, w - 6), dim(isSeen, style === 'warn' ? 'warn' : 'text'))], w));
  const home = where.shown === '~';
  fact(home ? '!' : '⌂', `works in ${where.shown}${home ? ', your home folder' : where.tests ? ' · tests found' : ''}`, home ? 'warn' : 'accent', seen('where'));
  fact('◐', `${modeName(f.mode)}: ${MODE_NOTE[f.mode] ?? MODE_NOTE.ask}${f.askFirst ? ' · waits for your go' : ''}${f.cap !== 'none' ? ` · cap ${f.cap}` : ''}`, 'accent', true);
  fact(m.on ? '●' : '!', m.on ? `${m.name} is on` : m.wake ? `${m.name} is off: Start turns it on` : `${m.why || `${m.name} is off`}`, m.on ? 'accent' : 'warn', true);
  fact('■', `${tl.end}, or after ${state.maxHours ?? 24} hours at most`, 'accent', stopSeen);
  return rows;
}

// A box of w cells around rows already w - 4 wide, its title in the top edge.
export function framed(title, body, w, bs = 'border', tstyle = 'white b') {
  const t = title ? ` ${title} ` : '';
  return [
    fit([p('╭─', bs), p(t, tstyle), p('─'.repeat(Math.max(0, w - 3 - [...t].length)), bs), p('╮', bs)], w),
    ...body.map((r) => fit([p('│ ', bs), ...fit(r, w - 4), p(' │', bs)], w)),
    fit([p(`╰${'─'.repeat(w - 2)}╯`, bs)], w),
  ];
}
// The question of a step, in w cells: [rows, the row the keys are on].
function stepRows(su, state, w, now) {
  const step = stepOf(su);
  const out = [];
  const row = (pieces, bg = null) => out.push(fit(pieces, w, bg));
  const blankRow = () => out.push(blank(w));
  const list = (items, pick, { typed = '', ph = '' } = {}) => {
    const ww = Math.max(10, Math.min(26, Math.floor(w * 0.5)));
    items.forEach(([, word, note], i) => { const on = i === pick; row([p(on ? ' ▸ ' : '   ', 'accent b'), p(pad(cut(word, ww - 1), ww), on ? 'white b' : 'text'), p(cut(note ?? '', w - ww - 4), note === 'your home folder' ? 'warn' : on ? 'dim' : 'faint')], on ? 'sel' : null); });
    if (ph) { blankRow(); row([p(' or type your own: ', 'dim'), p(typed, 'white b'), p(typed && Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent'), ...(typed ? [] : [p(ph, 'faint')])], typed ? 'sel' : null); }
  };
  const title = (t, sub) => { row([p(t, 'white b')]); wrapWords(sub, w).slice(0, 3).forEach((s) => row([p(s, 'dim')])); blankRow(); };
  if (step === 'what') {
    title('What should each run do?', 'Pick one, or type your own words. Each run is a fresh conversation that gets them.');
    const tp = templateOf(su);
    TEMPLATES.forEach((t, i) => { const on = i === tp; row([p(on ? ' ▸ ' : '   ', 'accent b'), p(pad(t.name, 24), on ? 'white b' : 'text'), p(cut(t.about, w - 28), on ? 'dim' : 'faint')], on ? 'sel' : null); });
    blankRow();
    const text = su.text ?? '';
    const room = w - 8;
    const shown = [...text].length > room ? `…${[...text].slice(-(room - 1)).join('')}` : text;
    const bs = su.unclear ? 'warn' : 'accent';
    row([p('╭', bs), p('─'.repeat(w - 2), bs), p('╮', bs)]);
    row([p('│', bs), ...fit([p(' › ', 'accent b'), p(shown, 'white'), p(Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent'), ...(text ? [] : [p('type what each run should do', 'faint')])], w - 2), p('│', bs)]);
    row([p('╰', bs), p('─'.repeat(w - 2), bs), p('╯', bs)]);
    // The pictures each run gets, or how to give it one.
    const held = trayItems(text, su.pasted);
    if (held.length) held.slice(0, 3).forEach((it) => row([p('  '), p(cut(compactText(it), w - 2), 'accent')]));
    else if (!su.unclear) row([p('  '), p(cut('drag a screenshot in, or ctrl+v: each run gets it', w - 2), 'faint')]);
    if (su.unclear) {
      wrapWords(su.unclear.why, w - 2).slice(0, 2).forEach((t, i) => row([p(i ? '  ' : '! ', 'warn b'), p(t, 'warn')]));
      su.unclear.options.forEach((o, i) => row([p(i === su.pick ? ' ▸ ' : '   ', 'accent b'), p(`${i + 1}  `, 'faint'), p(cut(o.label, w - 6), i === su.pick ? 'white b' : 'text')], i === su.pick ? 'sel' : null));
    }
  } else if (step === 'where') {
    title('Where should it work?', 'Its runs read and change files in this folder. Your recent projects are here.');
    list(setupChoices('where', su, state, now), setupPick('where', su, state, now));
  } else if (step === 'often') {
    title('How often should it run?', `${kindOfSetup(su) === 'debug' ? 'A fixing loop can run until its tests pass. ' : ''}The next run counts from the end of the last one.`);
    list(setupChoices('often', su, state, now), setupPick('often', su, state, now), { typed: su.custom.often, ph: '7m, 90s, 2h' });
  } else if (step === 'stop') {
    title('When should it stop?', 'It also stops when you close this window, after 24 hours, or when a run says its job is done (a fix: once its tests pass).');
    list(setupChoices('stop', su, state, now), setupPick('stop', su, state, now), { typed: su.custom.stop, ph: '20 (runs), 18:30, 2h' });
  } else {
    if (su.loaded) { out.push(...loadedRows(su, w)); blankRow(); }
    else if (su.typed) { row([p('You typed  ', 'faint'), p(cut(`/loop ${su.typed}`, w - 11), 'dim')]); if (su.found?.length) row([p('Read      ', 'faint'), p(cut(su.found.join('  ·  '), w - 10), 'dim')]); blankRow(); }
    const there = su.wide === false ? 'below' : 'on the right';
    title(su.id ? `Change ${cut(su.name, w - 8)}` : 'Ready to start', su.id ? `Its picture is ${there}. ← goes back to change what it does, how often or until when.` : `The picture ${there} is what it will do. ← goes back to change anything.`);
    const checks = setupChecks(su, state);
    for (const [mark, words, style] of checks) wrapWords(words, w - 3).slice(0, 3).forEach((t, i) => row([p(i ? '   ' : ` ${mark} `, `${style} b`), p(t, style)]));
    if (checks.length) blankRow();
    const rowsAt = startRows(su);
    row([p('More rules', 'dim'), p('   optional · ↑↓ a rule, ←→ change it', 'faint')]);
    MORE_ROWS.forEach((r) => {
      const on = rowsAt[su.rule] === r;
      const label = { mode: 'Mode', cap: 'Spending cap', steps: 'Steps a run', ask: 'Ask first' }[r];
      const cs = setupChoices(r, su, state, now);
      const c = cs[setupPick(r, su, state, now)] ?? cs[0];
      row([p(on ? ' ▸ ' : '   ', 'accent b'), p(pad(label, 14), on ? 'white b' : 'dim'), p(on ? '◂ ' : '  ', 'accent'), p(pad(c[1], 12), on ? 'white b' : 'text'), p(on ? ' ▸ ' : '   ', 'accent'), p(cut(c[2] ?? '', w - 36), 'faint')], on ? 'sel' : null);
    });
    blankRow();
    out.push(...saveRows(su, state, w, now));
  }
  if (su.error) { blankRow(); wrapWords(su.error, w - 2).slice(0, 2).forEach((t, i) => row([p(i ? '  ' : '! ', 'warn b'), p(t, 'warn')])); }
  return out;
}
function drawSetup(state, ui, { cols, rows, now }) {
  const su = ui.setup;
  const steps = wizardSteps(su);
  const step = stepOf(su);
  const at = steps.indexOf(step);
  const out = [header(state, ui, now, cols, su.id ? `Change ${cut(su.name ?? '', 40)}` : 'New loop'), rule(cols)];
  const lines = []; // [row, optional]: optional blanks go first in a short window
  const add = (r, opt = false) => lines.push([r, opt]);
  // The steps across the top: done ones ticked, this one lit.
  const chips = [];
  steps.forEach((s, i) => {
    if (i) chips.push(p('  ──  ', i <= at ? 'accentDim' : 'faint'));
    chips.push(p(i < at ? '✓ ' : i === at ? '◉ ' : '○ ', i < at ? 'ok b' : i === at ? 'accent b' : 'faint'), p(`${i + 1} ${STEP_NAME[s]}${s === 'start' && su.id ? '' : ''}`, i === at ? 'white b' : i < at ? 'text' : 'faint'));
  });
  add(blank(cols), true);
  add(fit([p(' '.repeat(Math.max(0, Math.floor((cols - rowWidth(chips)) / 2)))), ...chips], cols));
  add(blank(cols), true);
  const wide = cols >= 118;
  su.wide = wide;
  const pic = su;
  const WD = Math.min(cols - 4, 132);
  const X = Math.floor((cols - WD) / 2);
  if (wide) {
    const LW = Math.min(58, Math.floor(WD * 0.44));
    const RW = WD - LW - 2;
    const left = framed(`Step ${at + 1} of ${steps.length}`, stepRows(su, state, LW - 4, now), LW, 'accent');
    const right = framed('Your loop', loopPicture(pic, state, RW - 4, now), RW, 'border');
    const h = Math.max(left.length, right.length);
    const padBox = (box, bw) => { const last = box.at(-1); const body = box.slice(0, -1); while (body.length < h - 1) body.push(fit([p('│', last[0][1]), p(' '.repeat(bw - 2)), p('│', last[0][1])], bw)); return [...body, last]; };
    const L = padBox(left, LW), R = padBox(right, RW);
    for (let i = 0; i < h; i++) add(fit([p(' '.repeat(X)), ...L[i], p('  '), ...R[i]], cols));
  } else {
    for (const r of framed(`Step ${at + 1} of ${steps.length}`, stepRows(su, state, WD - 4, now), WD, 'accent')) add(fit([p(' '.repeat(X)), ...r], cols));
    add(blank(cols), true);
    // The picture, shorter: the steps on one line and the runs.
    const drawn = loopPicture(pic, state, WD - 4, now);
    const kind = kindOfSetup(pic);
    const f = setupFields(pic, state);
    const ev = readEvery(f.every, { kind });
    const cyc = (pic.picture ?? CYCLE[kind] ?? CYCLE.task).flatMap(([v, w], i) => [...(i ? [p(' ─▶ ', 'accent')] : []), p(v, 'accent b'), p(` ${w}`, 'text')]);
    add(fit([p(' '.repeat(X + 2)), p('Your loop  ', 'white b'), ...cyc, p(` ─▶ ${ev.until ? (f.check ? 'again until clean' : 'again until they pass') : ev.every ? `wait ${spokenEvery(ev.every)}` : 'its own pace'} ↺`, 'dim')], cols));
    for (const r of drawn.slice(-9, -5)) add(fit([p(' '.repeat(X)), ...r], cols));
  }
  add(blank(cols), true);
  // The buttons, always in the same place: Back on the left, the next step's on the right.
  const last = step === 'start';
  const named = Boolean((su.save?.name ?? '').trim());
  const next = last ? (su.id ? (su.again ? 'Save and start again' : 'Save') : named ? 'Save and start' : 'Start the loop') : `Next: ${STEP_NAME[steps[at + 1]]} →`;
  const backB = at > 0 ? [p(' ← Back ', 'text on btn')] : [p('        ')];
  const nextB = [...(last && named && !su.id ? [p('  Save  ', 'text on btn'), p('  ')] : []), p(`  ${next}  `, 'white b on btnOn')];
  add(fit([p(' '.repeat(X)), ...backB, p(' '.repeat(Math.max(1, WD - rowWidth(backB) - rowWidth(nextB)))), ...nextB], cols));
  const room = rows - out.length - 1;
  let list = lines;
  while (list.length > room && list.some(([, opt]) => opt)) { const i = list.map(([, opt]) => opt).lastIndexOf(true); list = [...list.slice(0, i), ...list.slice(i + 1)]; }
  const top = Math.max(0, Math.floor((room - list.length) / 3));
  for (let i = 0; i < room; i++) out.push(list[i - top]?.[0] ?? blank(cols));
  const at2 = startRows(su)[su.rule];
  const typing = last && (at2 === 'saveName' || String(at2).startsWith('fill:'));
  const keys = su.unclear ? [['1–3', 'pick'], ['↑↓', 'move'], ['enter', 'this one'], ['esc', 'cancel']]
    : last ? [['enter', su.id ? 'save' : named ? 'save and start' : 'start'], ...(named && !su.id ? [['^S', 'save only']] : []), ['←', 'back'], ['↑↓', 'a row'], typing ? ['type', at2 === 'saveName' ? 'its name' : 'the answer'] : ['←→', 'change it'], ...(su.loaded && su.loaded.from !== 'ready' ? [['^E', 'every field']] : []), ['esc', 'cancel']]
    : [['enter', last ? (su.id ? 'save' : 'start') : 'next'], ...(at > 0 ? [['←', 'back']] : []), ['↑↓', step === 'start' ? 'a rule' : 'pick'], ...(step === 'what' ? [['type', 'your own words'], ['ctrl+v', 'a picture']] : step === 'often' || step === 'stop' ? [['type', 'your own']] : step === 'start' ? [['←→', 'change a rule']] : []), ['esc', 'cancel']];
  return [...out.slice(0, rows - 1), keysLine(cols, keys, ui.toast, now)];
}

// ---- the coding window's line above the prompt: each open loop in a few words ----
export function loopsLine(state, now) {
  const open = state.loops.filter((l) => !over(l));
  if (!open.length) return null;
  const segs = [p(' ↻ ', 'accent b')];
  open.forEach((l, i) => {
    if (i) segs.push(p('  ·  ', 'faint'));
    const needs = waitsForYou(l);
    const [g, gs] = needs ? ['!', 'warn b'] : l.current ? [spin(now), 'accent'] : l.state === 'paused' ? ['‖', 'dim'] : ['○', 'dim'];
    const what = l.current?.needs ? 'asks you' : l.stuck && !l.current ? 'is stuck' : l.ready && !l.current ? 'waits for your go' : l.current ? dur(now - l.current.startedAt) : l.state === 'paused' ? 'paused' : l.state === 'off' ? 'waits' : l.queued ? 'next in line' : `at ${hm(l.nextAt)}`;
    segs.push(p(g, gs), p(` ${cut(l.name, open.length > 2 ? 20 : 30)} `, 'text'), p(what, needs ? 'warn' : 'dim'));
  });
  segs.push(p('   /loop opens them', 'faint'));
  return segs;
}

export function drawBoard(state, ui, size) {
  const { cols, rows } = size;
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    const out = [fit([p(`  This window is ${cols} × ${rows}. The loop board needs ${MIN_COLS} × ${MIN_ROWS} or more: make it bigger.`, 'warn')], cols)];
    if (ui.inApp) out.push(fit([p('  esc goes back to the chat.', 'dim')], cols));
    while (out.length < rows) out.push(blank(cols));
    return out;
  }
  if (ui.view === 'setup' && ui.setup) return drawSetup(state, ui, size);
  if (ui.view === 'shelf') return drawShelf(state, ui, size);
  if (ui.view === 'editor' && ui.editor) return drawEditor(state, ui, size);
  const watching = ui.view === 'watch' || (ui.view === 'confirm' && ui.confirm?.back === 'watch');
  return (watching ? drawWatch(state, ui, size) : drawCards(state, ui, size)).slice(0, rows);
}

// A row as terminal colours.
const sgrCache = new Map();
function sgr(style) {
  let c = sgrCache.get(style);
  if (c) return c;
  const [fgPart, bgPart] = String(style).split(' on ');
  const names = fgPart.split(' ');
  const codes = [`38;5;${STYLE[names[0]] ?? STYLE.text}`];
  if (names.includes('b')) codes.push('1');
  if (bgPart) codes.push(`48;5;${BG[bgPart] ?? bgPart}`);
  c = `\x1b[0;${codes.join(';')}m`;
  sgrCache.set(style, c);
  return c;
}
export const ansiRow = (row) => `${row.map(([t, s]) => `${sgr(s)}${t}`).join('')}\x1b[0m`;
