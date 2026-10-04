// The loop board's screen (/loops in the coding window, `coding loops` in another terminal): the
// Cards, the owner's pick of 4 Oct 2026 (design round: docs/design rounds/
// agentic-coder-loops-4-designs-2026-10-04.html). A card per loop says in four plain lines what it
// is doing now, how its last run ended, when it runs next and what became of your last note; under
// the cards, what happened, newest first; then a line for what waits for you, the box (typing
// always goes in it) and the keys, which are ctrl keys. ^G opens one run full size, ^O a loop's
// rules (the form), ^N a new loop a step at a time (the setup).
// drawBoard(state, ui, { cols, rows, now, linesOf }) → rows of [text, style] pieces, each row exactly
// `cols` wide. state: what the window wrote (loops.mjs snapshot). linesOf(loop, n) → that run's lines.
// Plain data in, rows out: tested on its own (loops.test.mjs).
import { everyWord as secsWord, limitWords, modeName, kindWord, guessKind } from './loops.mjs';

// Styles: a foreground (xterm-256, the app's own colours in ui/theme.mjs), "b" for bold, "on <bg>".
export const STYLE = {
  accent: 114, accentDim: 71, dim: 245, faint: 240, border: 242, white: 255, text: 252, ask: 147, ok: 114, bad: 203, warn: 215,
  debug: 209, test: 111, web: 73, task: 141, okDim: 65, badDim: 131,
};
export const BG = { sel: 236, user: 237, needs: 58, chipDebug: 52, chipTest: 17, chipWeb: 23, chipTask: 53 };
const KIND = { debug: ['FIX', 'chipDebug'], test: ['TEST', 'chipTest'], web: ['WEB', 'chipWeb'], task: ['TASK', 'chipTask'] };
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const MIN_COLS = 96;
export const MIN_ROWS = 30;
const CARD_H = 10;

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
const pad = (s, n) => { const cs = [...String(s)]; return cs.length >= n ? cs.slice(0, n).join('') : String(s) + ' '.repeat(n - cs.length); };
const cut = (s, n) => { const cs = [...String(s ?? '')]; return cs.length <= n ? cs.join('') : n <= 0 ? '' : `${cs.slice(0, Math.max(0, n - 1)).join('')}…`; };
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
const chip = (kind) => [` ${(KIND[kind] ?? KIND.task)[0]} `, `white b on ${(KIND[kind] ?? KIND.task)[1]}`];
const chipW = (kind) => (KIND[kind] ?? KIND.task)[0].length + 2;
const over = (l) => Boolean(l) && (l.state === 'done' || l.state === 'stopped');
const paceWord = (l) => (l.until ? 'until done' : l.every ? `every ${secsWord(l.every)}` : 'its own pace');
// Words wrapped to w cells; a word longer than w is cut where it must.
function wrapWords(text, w) {
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
const rule = (cols) => fit([p('─'.repeat(cols), 'faint')], cols);
const blank = (cols) => fit([], cols);
// The loop the box talks to: the run you watch, else the picked card.
const pickedOf = (state, ui) => (ui.view === 'watch' || ui.confirm?.back === 'watch' ? state.loops.find((x) => x.id === ui.watch?.id) : null) ?? state.loops[ui.sel] ?? null;
const waitsForYou = (l) => Boolean(l.current?.needs || (l.stuck && !l.current) || (l.ready && !l.current));

// What a loop is doing, in a word or two, and its colour (the window's /loop list, the chat's line).
export function stateOf(l, now) {
  if (l.current?.needs) return ['! needs you', 'warn b'];
  if (l.ready && !l.current) return [`! run ${l.ready.n} waits for your go`, 'warn b'];
  if (l.state === 'redoing') return [`${spin(now)} starting over`, 'accent'];
  if (l.current && l.pauseAfter) return [`${spin(now)} running · pauses after`, 'dim'];
  if (l.current) return [`${spin(now)} running ${dur(now - l.current.startedAt)}`, 'accent'];
  if (l.stuck) return ['! needs you · stuck', 'warn b'];
  if (l.state === 'paused') return ['‖ paused', 'dim'];
  if (l.state === 'done') return ['✓ ended', 'ok'];
  if (l.state === 'stopped') return ['■ stopped', 'faint'];
  if (l.state === 'off') return [`○ waits: ${l.offWhy ?? 'the model is off'}`, 'faint'];
  if (l.queued) return ['… next in line', 'dim'];
  return [`in ${countdown(l.nextAt - now)}`, 'dim'];
}

function header(state, ui, now, cols, title) {
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
function keysLine(cols, keys, toast, now) {
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
export function nowWords(l, lines, now) {
  const q = l.current?.needs;
  if (q) return [`! asks you: ${q.text}`, 'warn'];
  if (l.ready && !l.current) return [`! run ${l.ready.n} waits for your go`, 'warn'];
  if (l.state === 'redoing') return [`${spin(now)} starting over`, 'accent'];
  if (l.current) {
    const took = dur(now - l.current.startedAt);
    const steps = lines.filter((x) => x.kind === 'tool' || x.kind === 'fail');
    const x = [...lines].reverse().find((y) => y.kind === 'tool' || y.kind === 'fail' || y.kind === 'text');
    if (!x) return [`${spin(now)} starting · ${took}`, 'accent'];
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
export function lastWords(l) {
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
function card(l, lines, sel, w, now) {
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
// The first loop that waits because it stopped getting closer (loops.mjs stuckWhy).
const stuckOf = (state) => state.loops.find((l) => l.stuck && !l.current) ?? null;
// The loop whose next run waits longest for your go (Ask first).
export const readyOf = (state) => state.loops.filter((l) => l.ready && !l.current).sort((a, b) => a.ready.since - b.ready.since)[0] ?? null;
export const askingOf = (state) => state.loops.filter((l) => l.current?.needs).sort((a, b) => a.current.needs.since - b.current.needs.since)[0] ?? null;
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
  const ph = !l ? 'type /loop 5m <message> and enter, or ^N for a new loop a step at a time' : q?.kind === 'question' ? (q.options?.length ? `type 1–${Math.min(9, q.options.length)}, or your own answer` : 'type your answer') : q ? 'type y, a or n and enter (anything else goes to it as a note)' : `type to tell ${l.name} what to do`;
  const inner = [p(' › ', 'accent b'), p(shown, 'white'), p(Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent'), ...(text ? [] : [p(ph, 'faint')])];
  const hint = ` enter ${slash ? 'sends the line' : as !== 'note' ? 'starts over' : q ? 'answers' : over(l) ? 'starts it again' : 'sends'}${state.loops.length > 1 ? ' · ↑↓ another loop' : ''} `;
  return [
    fit([p(' ╭─', bs), p(title, 'white b'), p('─'.repeat(Math.max(0, w - 3 - [...title].length)), bs), p('╮', bs)], cols),
    fit([p(' │', bs), ...fit(inner, w - 2), p('│', bs)], cols),
    fit([p(' ╰', bs), p('─'.repeat(Math.max(0, w - 3 - hint.length)), bs), p(hint, 'dim'), p('─╯', bs)], cols),
  ];
}
function statusLine(state, cols) {
  const run = state.loops.filter((l) => l.current && !l.current.needs);
  const line = state.loops.filter((l) => l.queued).length;
  const need = state.loops.filter(waitsForYou).length;
  const m = state.model;
  const b = (label, value, style = 'text') => [p(` ${label} `, 'faint'), p('[', 'faint'), p(value, style), p(']', 'faint'), p(' ')];
  const parts = [b('loops', String(state.loops.length)), b('running', run.length ? cut(run.map((l) => l.name).join(', '), 20) : '0', run.length ? 'accent' : 'dim'), b('needs you', String(need), need ? 'warn b' : 'dim'), b('in line', String(line), line ? 'text' : 'dim'), b('model', cut(m.on ? `${m.name} ${m.where === 'this Mac' ? 'loaded' : `on ${m.where}`}` : `${m.name} off`, 30), m.on ? 'accent' : 'faint'), b('end', `window closes · ${state.maxHours ?? 24} h`, 'dim')];
  // A part that would be cut is left out whole, the last first.
  const row = [];
  for (const part of parts) { if (rowWidth(row) + rowWidth(part) > cols) break; row.push(...part); }
  return fit(row, cols);
}
function bottomBlock(state, ui, cols, now, keys) {
  const out = [...needRows(state, ui, cols), ...inputBox(state, ui, cols, now)];
  if (ui.view === 'confirm') out.push(fit([p(' '), p(cut(ui.confirm.text, cols - 40), 'warn b'), p('   y', 'white b'), p(' yes   ', 'dim'), p('n', 'white b'), p(' no', 'dim'), p('   (enter does nothing here)', 'faint')], cols));
  else out.push(keysLine(cols, keys, ui.toast, now));
  return out;
}
const mainKeys = (ui) => [['^N', 'new loop', 'new'], ['^R', 'run now', 'run'], ['^P', 'pause'], ['^S', 'stop'], ['^O', 'rules'], ['^X', 'start over', 'redo'], ['^B', 'undo'], ['^G', 'whole run', 'whole'], ['↑↓', 'pick'], ['esc', ui.inApp ? 'chat' : 'close']];

// ---- the cards ----
function drawCards(state, ui, { cols, rows, now, linesOf }) {
  const out = [header(state, ui, now, cols, 'Loops'), rule(cols)];
  const bottom = bottomBlock(state, ui, cols, now, mainKeys(ui));
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
    lines.push(boxRow([p('^N', 'white b'), p(' makes one a step at a time: what each run does, how often', 'dim')]));
    lines.push(boxRow([p('   it runs, and when it stops.', 'dim')]));
    lines.push(boxRow([]));
    lines.push(boxRow([p('Or type one of these in the box below, then enter:', 'dim')]));
    lines.push(boxRow([p('  /loop test 5m', 'white'), p('                  runs the tests every 5 minutes', 'faint')]));
    lines.push(boxRow([p('  /loop debug', 'white'), p('                    fixes failing tests until they pass', 'faint')]));
    lines.push(boxRow([p('  /loop web 30m <what to read>', 'white'), p('   reads pages and says what is new', 'faint')]));
    lines.push(boxRow([p('  /loop 10m <message>', 'white'), p('            sends your message every 10 minutes', 'faint')]));
    lines.push(fit([p(' '.repeat(x)), p(`└${'─'.repeat(w - 2)}┘`, 'border')], cols));
  } else {
    // Three cards across in a wide window (two in a narrow one), the picked one among them.
    const show = Math.min(n, cols >= 118 ? 3 : 2);
    const gap = 2;
    const bw = Math.min(44, Math.floor((cols - 2 - (show - 1) * gap) / show));
    const first = Math.max(0, Math.min(ui.sel - Math.floor((show - 1) / 2), n - show));
    const vis = state.loops.slice(first, first + show);
    const x0 = Math.floor((cols - (show * bw + (show - 1) * gap)) / 2);
    const cards = vis.map((l, i) => card(l, linesOf(l, l.current?.n ?? l.runs.at(-1)?.n ?? 0), first + i === ui.sel, bw, now));
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
  out.push(rule(cols));
  const bottom = bottomBlock(state, ui, cols, now, [['esc', 'back to the cards', 'back'], ['↑↓', 'scroll'], ['←→', 'older / newer run', 'other runs'], ['^X', 'start over', 'redo'], ['^B', 'undo it', 'undo'], ['^R', 'run now', 'run'], ['^P', 'pause'], ['^S', 'stop']]);
  const body = rows - out.length - bottom.length;
  const lines = runLines(l, run, run ? linesOf(l, run.n) : [], cols - 2, now, { full: true });
  const scroll = Math.max(0, Math.min(ui.watch.scroll ?? 0, lines.length - body));
  const start = Math.max(0, lines.length - body - scroll);
  for (let i = 0; i < body; i++) out.push(fit([p(' '), ...(lines[start + i] ?? [])], cols));
  out.push(...bottom);
  return out;
}

// ---- the form: every rule of a new loop or of one loop (^O) ----
const ROW_WORD = { message: 'What each run does', kind: 'Kind', every: 'How often', runs: 'Stop after', stopAt: 'Stop at', cap: 'Spending cap', mode: 'Mode', steps: 'Steps a run', askFirst: 'Ask first' };
const ROW_HELP = {
  kind: (f) => (f.kindSet ? 'what its runs are told to do' : 'guessed from the message · ←→ to change'),
  every: (f, kind) => (kind === 'debug' ? 'until done: again 15 s after a miss' : 'type 7m, 90s or 2h · own pace ≈ every 10m'),
  runs: () => 'then it ends · start-overs do not count',
  stopAt: () => 'a time like 18:30 or 6pm, or a while like 2h',
  cap: () => 'on a paid service · the window\'s $5 still holds',
  mode: () => 'what a run may do without asking you',
  steps: () => 'a run stops after this many tool steps',
  askFirst: () => 'each run waits for your y',
};
const valueWord = (row, v) => (row === 'kind' ? kindWord(v) : row === 'mode' ? modeName(v) : row === 'askFirst' ? (v ? 'on' : 'off') : row === 'every' && /^\d/.test(String(v)) ? `every ${v}` : row === 'runs' && /^\d+$/.test(String(v)) ? `${v} run${v === '1' ? '' : 's'}` : row === 'steps' && /^\d+$/.test(String(v)) ? `${v} steps` : String(v));
function drawForm(state, ui, { cols, rows, now }) {
  const f = ui.form;
  const out = [header(state, ui, now, cols, 'Loops')];
  out.push(rule(cols));
  const w = Math.min(100, cols - 6);
  const x = Math.floor((cols - w) / 2);
  const inner = w - 4;
  const lines = [];
  const edge = (t) => fit([p(' '.repeat(x)), p(t, 'accent')], cols);
  const side = (row, bg = null) => fit([p(' '.repeat(x)), p('│ ', 'accent'), ...fit(row, inner, bg), p(' │', 'accent')], cols);
  const l = f.id ? state.loops.find((y) => y.id === f.id) : null;
  const title = f.id ? ` Loop ${f.id} · ${cut(f.name ?? l?.name ?? '', 40)}${f.again ? ' · ended: saving starts it again' : ''} ` : ' New loop · every rule ';
  lines.push(edge(`┌─${title}${'─'.repeat(Math.max(0, w - 3 - [...title].length))}┐`));
  lines.push(side([]));
  const v = f.fields;
  const kind = v.kind ?? guessKind(v.message ?? '');
  FORM_ROW_LIST.forEach((row, i) => {
    const on = i === f.row;
    const bad = f.field === row && f.error;
    if (row === 'message') {
      lines.push(side([p('  '), p(ROW_WORD.message, on ? 'white b' : 'dim')]));
      const room = inner - 6;
      const text = String(v.message ?? '');
      const shown = [...text].length > room ? `…${[...text].slice(-(room - 1)).join('')}` : text;
      const cur = on ? p(Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent') : p('');
      lines.push(side([p(on ? ' › ' : '   ', on ? 'accent b' : 'faint'), p(shown || (on ? '' : 'type what each run should do'), shown ? 'white' : 'faint'), cur], on ? 'sel' : null));
      lines.push(side([]));
      return;
    }
    const val = row === 'kind' ? kind : v[row];
    const word = valueWord(row, val);
    const typed = !['kind', 'mode', 'askFirst'].includes(row);
    const help = ROW_HELP[row]?.(f, kind) ?? '';
    lines.push(side([p('  '), p(pad(ROW_WORD[row], 14), on ? 'white b' : 'dim'), p(on ? '‹ ' : '  ', 'accent'), p(pad(word + (on && typed && !f.fresh ? '▏' : ''), 18), bad ? 'warn b' : on ? 'white b' : 'text'), p(on ? ' ›' : '  ', 'accent'), p('   '), p(cut(help, inner - 42), on ? 'dim' : 'faint')], on ? 'sel' : null));
  });
  lines.push(side([]));
  if (f.error) lines.push(side([p('  ! ', 'warn b'), p(cut(f.error, inner - 4), 'warn')]));
  else {
    lines.push(side([p('  '), p(cut(`Its runs work right in ${state.folder}, one at a time on ${state.model?.where ?? 'this Mac'}.`, inner - 2), 'faint')]));
    lines.push(side([p('  '), p(cut(`It ends when this window closes, or after ${state.maxHours ?? 24} hours. Each run keeps a copy, so ^B can undo it.`, inner - 2), 'faint')]));
  }
  lines.push(side([]));
  const go = f.id ? (f.again ? ' enter  Save and start again ' : ' enter  Save ') : ' enter  Start the loop ';
  lines.push(side([p('  '), p(go, 'white b on sel'), p('    esc', 'white'), p(' cancel', 'dim'), p('    ↑↓', 'white'), p(' a row', 'dim'), p('    ←→', 'white'), p(' its choices', 'dim')]));
  lines.push(edge(`└${'─'.repeat(w - 2)}┘`));
  const body = rows - out.length - 2;
  const top = Math.max(0, Math.floor((body - lines.length) / 3));
  for (let i = 0; i < body; i++) out.push(lines[i - top] ?? blank(cols));
  out.push(statusLine(state, cols));
  out.push(keysLine(cols, [['↑↓', 'a row'], ['←→', 'its choices'], ['type', 'on a typed row'], ['enter', f.id ? 'save' : 'start'], ['esc', 'cancel']], ui.toast, now));
  return out.slice(0, rows);
}
const FORM_ROW_LIST = ['message', 'kind', 'every', 'runs', 'stopAt', 'cap', 'mode', 'steps', 'askFirst'];

// ---- the setup: a new loop a step at a time (^N; /loops with no loop yet) ----
// What each run does → how often → when it stops → a read-back, then enter starts it. The rows'
// values are the form's words (loops.mjs rulesOf reads them).
export const SETUP_EXAMPLES = ['run the tests and say what fails', 'fix the failing tests until they all pass', 'read the Bun releases page and tell me when there is a new version', 'check the build and the lint, change nothing'];
export function setupChoices(step, kind, now = Date.now()) {
  if (step === 'often') return [
    ...(kind === 'debug' ? [{ w: 'until the tests pass', note: 'again 15 s after a miss', every: 'until done' }] : []),
    { w: 'every 5 minutes', every: '5m' }, { w: 'every 10 minutes', every: '10m' }, { w: 'every 30 minutes', every: '30m' }, { w: 'every hour', every: '1h' },
    { w: 'at its own pace', note: 'it decides; about every 10 minutes', every: 'own pace' },
  ];
  return [
    { w: 'never', note: 'it ends when this window closes, or after 24 hours', runs: 'no limit', stopAt: 'none' },
    { w: 'after 5 runs', runs: '5', stopAt: 'none' }, { w: 'after 10 runs', runs: '10', stopAt: 'none' }, { w: 'after 20 runs', runs: '20', stopAt: 'none' },
    { w: 'in 2 hours', note: `at ${hm(now + 7_200_000)}`, runs: 'no limit', stopAt: '2h' },
  ];
}
const SETUP_STEPS = ['What it does', 'How often', 'When it stops', 'Start'];
function drawSetup(state, ui, { cols, rows, now }) {
  const su = ui.setup;
  const out = [header(state, ui, now, cols, 'New loop'), rule(cols), blank(cols)];
  const WD = Math.min(100, cols - 6);
  const X = Math.floor((cols - WD) / 2);
  const at = { task: 0, unclear: 0, often: 1, stop: 2, ready: 3 }[su.step];
  const row = (pieces, bg = null) => out.push(fit([p(' '.repeat(X)), ...fit(pieces, WD, bg)], cols));
  const prog = [];
  SETUP_STEPS.forEach((name, i) => { if (i) prog.push(p('  ──  ', 'faint')); prog.push(p(i < at ? '● ' : i === at ? '◉ ' : '○ ', i < at ? 'ok' : i === at ? 'accent' : 'faint'), p(name, i === at ? 'white b' : i < at ? 'text' : 'faint')); });
  row(prog);
  row([p('  '), p([at > 0 ? cut(su.name ?? '', 40) : '', at > 1 ? su.words?.every : '', at > 2 ? su.words?.stop : ''].filter(Boolean).join('  ·  '), 'faint')]);
  out.push(blank(cols));
  const box = (text, ph, bs, title, live) => {
    const room = WD - 8;
    const shown = [...text].length > room ? `…${[...text].slice(-(room - 1)).join('')}` : text;
    row([p('╭─', bs), p(title, 'white b'), p('─'.repeat(Math.max(0, WD - 3 - [...title].length)), bs), p('╮', bs)]);
    row([p('│', bs), ...fit([p(' › ', 'accent b'), p(shown, 'white'), p(live && Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent'), ...(text ? [] : [p(ph, 'faint')])], WD - 2), p('│', bs)]);
    row([p(`╰${'─'.repeat(WD - 2)}╯`, bs)]);
  };
  // numbered: the question about an unclear task, where 1–3 pick; the other steps take typed words.
  const list = (choices, numbered = false) => choices.forEach((c, i) => row([p(i === su.pick ? ' ▸ ' : '   ', 'accent b'), p(numbered ? `${i + 1}  ` : '', 'faint'), p(pad(c.w ?? c.label, 44), i === su.pick ? 'white b' : 'text'), p(c.note ?? '', 'faint')], i === su.pick ? 'sel' : null));
  const error = () => out.push(su.error ? fit([p(' '.repeat(X)), p('! ', 'warn b'), p(su.error, 'warn')], cols) : blank(cols));
  if (su.step === 'task' || su.step === 'unclear') {
    row([p('What should each run do?', 'white b')]);
    row([p('Say it the way you would ask in the chat. Each run is a fresh conversation that gets these words.', 'dim')]);
    out.push(blank(cols));
    box(su.text, SETUP_EXAMPLES[0], su.step === 'unclear' ? 'warn' : 'accent', ' each run does ', su.step === 'task');
    error();
    if (su.step === 'unclear') {
      row([p('! ', 'warn b'), p(su.unclear.why, 'warn')]);
      out.push(blank(cols));
      list(su.unclear.options, true);
    } else {
      out.push(blank(cols));
      row([p('For example', 'faint'), p('   tab puts one in', 'faint')]);
      SETUP_EXAMPLES.forEach((e, i) => row([p(i === su.ex ? ' › ' : '   ', 'accent'), p(e, i === su.ex ? 'text' : 'dim')]));
    }
  } else if (su.step === 'often' || su.step === 'stop') {
    const often = su.step === 'often';
    row([p(often ? 'How often should it run?' : 'When should it stop?', 'white b')]);
    row([p(often ? `${kindWord(su.fields.kind)}. The next run counts from the end of the last one.` : 'It also stops when this window closes, after 24 hours at most, or when a run says its job is done.', 'dim')]);
    out.push(blank(cols));
    list(setupChoices(su.step, su.fields.kind, now));
    out.push(blank(cols));
    row([p('or type your own: ', 'dim'), p(su.custom, 'white'), p(Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent'), ...(su.custom ? [] : [p(often ? '7m, 90s, 2h' : 'a number of runs (20), or a time (18:30, 2h)', 'faint')])]);
    error();
  } else {
    row([p('Ready to start', 'white b')]);
    row([p('Read it once more: enter starts the loop, and its first run starts right away.', 'dim')]);
    out.push(blank(cols));
    const lab = (t) => p(pad(t, 12), 'faint');
    const side = (pieces) => row([p('│ ', 'accent'), ...fit(pieces, WD - 4), p(' │', 'accent')]);
    row([p(`┌${'─'.repeat(WD - 2)}┐`, 'accent')]);
    wrapWords(su.fields.message, WD - 18).slice(0, 2).forEach((t, i) => side([lab(i ? '' : 'Each run'), p(t, 'white')]));
    side([lab('How often'), p(`${su.words.every} · the first run starts now`, 'text')]);
    side([lab('Stops'), p(su.words.stop === 'never' ? 'when this window closes, or after 24 hours' : `${su.words.stop}, or when this window closes`, 'text')]);
    side([lab('Works in'), p(cut(`${state.folder} · ${modeName(su.fields.mode)}, this window's mode`, WD - 18), 'text')]);
    side([lab('Undo'), p('each run keeps a copy, so ^B puts back what it changed', 'text')]);
    row([p(`└${'─'.repeat(WD - 2)}┘`, 'accent')]);
    out.push(blank(cols));
    row([p(' enter ', 'white b on sel'), p('  Start the loop', 'white'), p('     ← back     esc cancel     ^O more rules: mode, cap, steps, ask first', 'dim')]);
  }
  while (out.length < rows - 1) out.push(blank(cols));
  const keys = su.step === 'task' ? [['enter', 'next'], ['tab', 'an example'], ['^O', 'every rule at once', 'all rules'], ['esc', 'cancel']]
    : su.step === 'unclear' ? [['1–3', 'pick'], ['↑↓', 'move'], ['enter', 'this one'], ['←', 'change the words'], ['esc', 'cancel']]
    : su.step === 'ready' ? [['enter', 'start'], ['←', 'back'], ['^O', 'more rules'], ['esc', 'cancel']]
    : [['enter', 'next'], ['↑↓', 'pick'], ['type', 'your own'], ['←', 'back'], ['esc', 'cancel']];
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
  segs.push(p('   /loops opens them', 'faint'));
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
  if (ui.view === 'form' && ui.form) return drawForm(state, ui, size);
  if (ui.view === 'setup' && ui.setup) return drawSetup(state, ui, size);
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
