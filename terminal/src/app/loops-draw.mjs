// The loop board's screen (`coding loops`, /loops): the Tree, the owner's pick of 3 Oct 2026 (design
// round: docs/design rounds/agentic-coder-loop-board-3-designs-2026-10-03-v2.html), in the look of
// the /agents screen. This window on top, a box per loop under it with the four steps of a run
// and the step it is on, a log, then one line for a question, the chat box, a status line and the
// keys. enter opens one run full size with the chat box under it.
// drawBoard(state, ui, { cols, rows, now, linesOf }) → rows of [text, style] pieces, each row exactly
// `cols` wide. state: what the window wrote (loops.mjs snapshot). linesOf(loop, n) → that run's lines.
// Plain data in, rows out: tested on its own (loops-draw.test.mjs).
import { everyWord as secsWord } from './loops.mjs';

// Styles: a foreground (xterm-256, the app's own colours in ui/theme.mjs), "b" for bold, "on <bg>".
export const STYLE = {
  accent: 114, accentDim: 71, dim: 245, faint: 240, border: 242, white: 255, text: 252, ask: 147, ok: 114, bad: 203, warn: 215,
  debug: 209, test: 111, web: 73, task: 141, okDim: 65, badDim: 131,
};
export const BG = { sel: 236, user: 237, needs: 58, chipDebug: 52, chipTest: 17, chipWeb: 23, chipTask: 53 };
const KIND = { debug: ['DEBUG', 'chipDebug'], test: ['TEST', 'chipTest'], web: ['WEB', 'chipWeb'], task: ['TASK', 'chipTask'] };
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HALF = ['◐', '◓', '◑', '◒'];
export const MIN_COLS = 96;
export const MIN_ROWS = 30;
const BOTTOM = 6; // a question, the chat box (3), the status, the keys

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
const half = (now) => HALF[Math.floor(now / 220) % 4];
const chip = (kind) => [` ${(KIND[kind] ?? KIND.task)[0]} `, `${KIND[kind] ? kind : 'task'} b on ${(KIND[kind] ?? KIND.task)[1]}`];
const chipW = (kind) => (KIND[kind] ?? KIND.task)[0].length + 2;
const over = (l) => l.state === 'done' || l.state === 'stopped';
const paceWord = (l) => (l.until ? 'until done' : l.every ? `every ${secsWord(l.every)}` : 'its own pace');

// What a loop is doing, in a word or two, and its colour.
export function stateOf(l, now) {
  if (l.current?.needs) return ['! needs you', 'warn b'];
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
// The last runs as marks: green passed, red missed, yellow asking, a spinner while it runs.
function marks(l, n, now) {
  const out = l.runs.slice(-(l.current ? n - 1 : n)).map((r) => p('■', r.ok ? 'ok' : 'bad'));
  if (l.current) out.push(p(l.current.needs ? '■' : spin(now), l.current.needs ? 'warn' : 'accent'));
  return out.flatMap((m) => [m, p(' ')]);
}
function lastWords(l) {
  const r = l.runs.at(-1);
  if (!r) return [l.state === 'off' ? 'waits for the model' : 'no run yet', 'faint'];
  return [`${r.ok ? '✓' : '✗'} ${r.summary}`, r.ok ? 'ok' : 'bad'];
}
const rule = (cols) => fit([p('─'.repeat(cols), 'faint')], cols);
const blank = (cols) => fit([], cols);

function header(state, now, cols, title) {
  const run = state.loops.filter((l) => l.current && !l.current.needs).length;
  const need = state.loops.filter((l) => l.current?.needs || (l.stuck && !l.current)).length;
  const m = state.model;
  const right = [p(`${run} running`, run ? 'accent' : 'dim'), ...(need ? [p(' · ', 'faint'), p(`${need} needs you`, 'warn b')] : []), p('   '), p(m.on ? '● ' : '○ ', m.on ? 'accent' : 'faint'), p(cut(`${m.name} ${m.on ? (m.where === 'this Mac' ? 'loaded' : `on ${m.where}`) : 'off'}`, 34), m.on ? 'dim' : 'faint'), p(`   ${clock(now)} `, 'dim')];
  let left = [p(' ↻ ', 'accent b'), p(title, 'white b'), p(`  ·  ${state.name} · ${state.folder}`, 'dim')];
  if (rowWidth(left) + rowWidth(right) + 1 > cols) left = [p(' ↻ ', 'accent b'), p(title, 'white b'), p(`  ·  ${cut(state.name, Math.max(4, cols - rowWidth(right) - title.length - 10))}`, 'dim')];
  return fit([...left, p(' '.repeat(Math.max(1, cols - rowWidth(left) - rowWidth(right)))), ...right], cols);
}
function keysLine(cols, keys, toast, now) {
  if (toast && toast.until > now) return fit([p(' '), p(toast.text, toast.style ?? 'accent')], cols);
  const tight = keys.reduce((n, [k, w]) => n + k.length + w.length + 4, 0) - 2 > cols;
  const row = [p(' ')];
  keys.forEach(([k, w], i) => { if (i) row.push(p(tight ? '  ' : ' · ', 'faint')); row.push(p(k, 'white'), p(` ${w}`, 'dim')); });
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
      const rowsOf = [];
      for (const para of String(x.text).replace(/[*`]/g, '').split('\n')) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) { if ([...`${line} ${word}`.trim()].length > w - 4) { rowsOf.push(line.trim()); line = word; } else line += ` ${word}`; }
        if (line.trim()) rowsOf.push(line.trim());
      }
      rowsOf.slice(0, full ? 400 : 8).forEach((t, i) => out.push(fit([p(i ? '   ' : ' ● ', 'white'), p(cut(t, w - 4), 'text')], w)));
    }
  }
  if (live && !l.current.needs) out.push(fit([p(` ${spin(now)} `, 'accent'), p(`Working… ${dur(now - run.startedAt)}`, 'dim')], w));
  return tail ? out.slice(-tail) : out;
}

// ---- where a loop is in its cycle: four steps, read off the lines its run wrote ----
const LOOKS = new Set(['Read', 'Search', 'List', 'Map', 'CodeSearch', 'Explore', 'Screen']);
const CHANGES = new Set(['Update', 'Write', 'Rename']);
const WEB = new Set(['Fetch', 'Web Search']);
const labelOf = (x) => String(x.text ?? '').split('(')[0];
// A run of the tests, as the run said (loop-run.mjs); a line written without that word is read by its command.
const isTest = (x) => (typeof x.test === 'boolean' ? x.test : labelOf(x) === 'Bash' && /\b(test|tests|pytest|jest|vitest|mocha|unittest|rspec)\b/.test(x.text));
function cycleOf(l, lines, now) {
  const st = (name, state, note = '', frac = null, tone = null) => ({ name, state, note, frac, tone });
  const run = l.current;
  const last = l.runs.at(-1);
  const steps = lines.filter((x) => x.kind === 'tool' || x.kind === 'fail');
  const said = lines.some((x) => x.kind === 'text');
  const waiting = !run && !over(l);
  const span = (l.every ?? (l.until ? 15 : l.gap ?? 600)) * 1000;
  const waitNote = l.stuck ? 'stuck: needs you' : l.state === 'paused' ? 'paused' : l.state === 'off' ? 'model off' : l.queued ? 'next in line' : `in ${countdown(l.nextAt - now)}`;
  const waitFrac = waiting && l.state !== 'paused' && l.state !== 'off' && !l.queued ? Math.min(1, Math.max(0, 1 - (l.nextAt - now) / span)) : 0;
  const wait = st('WAIT', waiting ? 'active' : 'todo', run ? `then ${l.every ? secsWord(l.every) : 'its own pace'}` : over(l) ? '' : waitNote, run ? 0 : waitFrac);
  const back = over(l) ? (l.state === 'done' ? `✓ ${l.doneWhy ?? 'ended'}` : 'stopped by you') : l.until ? 'pass: done · miss: a new try' : `again ${paceWord(l)}`;
  const backTone = l.state === 'done' ? 'ok' : null;
  const ask = run?.needs ? st('', 'ask', 'needs you') : null;
  // done / active / todo for step i when the run has reached step `at`; a run that ended has done them all.
  const mark = (i, at) => (!run ? (last ? 'done' : 'todo') : i < at ? 'done' : i === at ? 'active' : 'todo');
  if (l.kind === 'debug') {
    const tests = steps.filter(isTest);
    const change = steps.find((x) => x.kind === 'tool' && CHANGES.has(labelOf(x)));
    const afterChange = change ? tests.filter((x) => lines.indexOf(x) > lines.indexOf(change)) : [];
    const at = !tests.length ? 0 : !change ? 1 : !afterChange.length ? 2 : 3;
    const first = tests[0], lastT = afterChange.at(-1);
    const file = change ? cut(/\((.*)\)$/s.exec(change.text)?.[1] ?? '', 24) : 'the change';
    const s = [
      st('TESTS', mark(0, at), first ? (first.kind === 'fail' ? 'some fail' : 'they pass') : 'what fails', null, first ? (first.kind === 'fail' ? 'bad' : 'ok') : null),
      st('FIND', mark(1, at), run && at === 1 ? 'reading' : 'the cause'),
      st('FIX', mark(2, at), change ? file : 'the change'),
      st('TESTS', run && at === 3 && lastT ? 'done' : mark(3, at), lastT ? (lastT.kind === 'fail' ? 'some still fail' : 'they pass') : run && at === 3 ? 'running' : 'run again', null, lastT ? (lastT.kind === 'fail' ? 'bad' : 'ok') : null),
    ];
    if (ask) { const i = Math.min(3, at); s[i] = { ...s[i], state: 'ask', note: 'needs you' }; }
    return { steps: s, back, backTone };
  }
  if (l.kind === 'test') {
    const t = steps.filter(isTest).at(-1);
    const at = !t ? 0 : !said ? 1 : 2;
    const s = [
      st('RUN', mark(0, at), t ? (t.kind === 'fail' ? 'some fail' : 'all pass') : 'the tests', null, t ? (t.kind === 'fail' ? 'bad' : 'ok') : null),
      st('COMPARE', mark(1, at), 'with the last run'),
      st('REPORT', run && said ? 'active' : mark(2, at), last && !run ? cut(last.summary, 40) : 'what changed', null, last && !run ? (last.ok ? 'ok' : 'bad') : null),
      wait,
    ];
    if (ask) { const i = Math.min(2, at); s[i] = { ...s[i], state: 'ask', note: 'needs you' }; }
    return { steps: s, back, backTone };
  }
  if (l.kind === 'web') {
    const reads = steps.filter((x) => WEB.has(labelOf(x)));
    const asked = lines.some((x) => x.kind === 'ask' || x.kind === 'answer') || (l.allowed ?? []).some((a) => /^Web/.test(a));
    const at = !reads.length && !said ? (asked ? 1 : 0) : !said ? 1 : 2;
    const s = [
      st('ASK', run?.needs ? 'ask' : !run && !last ? 'todo' : 'done', run?.needs ? 'needs you' : (l.allowed ?? []).some((a) => /^Web/.test(a)) ? 'allowed: always' : asked ? 'you answered' : 'each site asks'),
      st('READ', mark(1, run?.needs ? 0 : Math.max(1, at)), reads.length ? `${reads.length} read` : 'the pages', null, reads.some((x) => x.kind === 'fail') ? 'bad' : null),
      st('REPORT', run && said ? 'active' : mark(2, run?.needs ? 0 : at), last && !run ? cut(last.summary, 40) : 'anything new?', null, last && !run ? (last.ok ? 'ok' : 'bad') : null),
      wait,
    ];
    return { steps: s, back, backTone };
  }
  const looks = steps.filter((x) => LOOKS.has(labelOf(x))).length;
  const work = steps.filter((x) => !LOOKS.has(labelOf(x)) && labelOf(x) !== 'Ask').length;
  const at = said ? 2 : work ? 1 : 0;
  const s = [
    st('LOOK', mark(0, at), looks ? `${looks} looked at` : 'reads first'),
    st('WORK', mark(1, at), work ? `${work} step${work === 1 ? '' : 's'}` : 'does the job'),
    st('REPORT', run && said ? 'active' : mark(2, at), last && !run ? cut(last.summary, 40) : 'says what it did', null, last && !run ? (last.ok ? 'ok' : 'bad') : null),
    wait,
  ];
  if (ask) { const i = Math.min(2, at); s[i] = { ...s[i], state: 'ask', note: 'needs you' }; }
  return { steps: s, back, backTone };
}
const stepGlyph = (s, now) => (s.state === 'done' ? p('●', s.tone === 'bad' ? 'bad' : 'ok') : s.state === 'active' ? p(half(now), 'accent') : s.state === 'ask' ? p('!', 'warn b') : p('○', 'faint'));
function stepBar(s, w, now) {
  if (s.state === 'done') return [p('▮'.repeat(w), s.tone === 'bad' ? 'badDim' : 'okDim')];
  if (s.state === 'ask') return [p('▯'.repeat(w), Math.floor(now / 500) % 2 ? 'warn' : 'faint')];
  if (s.state === 'todo') return [p('░'.repeat(w), 'faint')];
  if (s.frac === null) { const at = Math.floor(now / 140) % (w + 3); return Array.from({ length: w }, (_, i) => p(i <= at && i > at - 3 ? '▮' : '▯', i <= at && i > at - 3 ? 'accent' : 'faint')); }
  const k = Math.round(w * s.frac);
  return [p('▮'.repeat(k), 'accent'), p('▯'.repeat(w - k), 'faint')];
}
const noteStyle = (s) => (s.state === 'todo' ? 'faint' : s.tone === 'bad' ? 'bad' : s.tone === 'ok' ? 'ok' : s.state === 'ask' ? 'warn' : 'dim');

// ---- the lines every screen ends with ----
function logPieces(state, e, w) {
  const l = e.id ? state.loops.find((x) => x.id === e.id) : null;
  const head = [p(`${clock(e.at)} `, 'dim'), ...(e.kind === 'you' ? [p(' YOU ', 'white b on user')] : l ? [chip(l.kind)] : [p('  ·  ', 'faint')]), p(' ')];
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
export const askingOf = (state) => state.loops.filter((l) => l.current?.needs).sort((a, b) => a.current.needs.since - b.current.needs.since)[0] ?? null;
function chatBox(state, ui, cols, now) {
  const l = state.loops[ui.sel];
  const on = ui.chat?.on;
  const bs = on ? 'accent' : 'border';
  const w = cols - 2;
  const answers = l?.current?.needs?.kind === 'question';
  const title = l ? (answers ? ` your answer to ${cut(l.name, 30)} ` : ` to ${cut(l.name, 30)} `) : ' new loop ';
  const noteLeft = l?.note ? ` its next run starts with: “${cut(l.note.replace(/\s+/g, ' '), 40)}” ` : '';
  const top = [p(' ╭─', bs), p(title, on ? 'white b' : 'dim'), p(noteLeft, 'dim'), p('─'.repeat(Math.max(0, w - 3 - [...title].length - [...noteLeft].length)), bs), p('╮', bs)];
  const text = ui.chat?.text ?? '';
  const room = w - 6;
  const shown = [...text].length > room ? `…${[...text].slice(-(room - 1)).join('')}` : text;
  const hintText = !state.loops.length ? ' to type /loop 10m <message> and make the first loop' : ' to type a note to this loop · or /loop 5m <message> to make a new one';
  const inner = on ? [p(' › ', 'accent b'), p(shown, 'white'), p(Math.floor(now / 500) % 2 ? '▏' : ' ', 'accent')] : [p(' › ', 'faint'), p(text ? shown : 't', text ? 'dim' : 'white'), p(text ? '' : hintText, 'faint')];
  const hint = on ? ' enter send · esc leave the box ' : '';
  return [fit(top, cols), fit([p(' │', bs), ...fit(inner, w - 2), p('│', bs)], cols), fit([p(' ╰', bs), p('─'.repeat(Math.max(0, w - 3 - hint.length)), bs), p(hint, 'dim'), p('─╯', bs)], cols)];
}
function statusLine(state, cols) {
  const run = state.loops.filter((l) => l.current && !l.current.needs);
  const line = state.loops.filter((l) => l.queued).length;
  const need = state.loops.filter((l) => l.current?.needs || (l.stuck && !l.current)).length;
  const m = state.model;
  const b = (label, value, style = 'text') => [p(` ${label} `, 'faint'), p('[', 'faint'), p(value, style), p(']', 'faint'), p(' ')];
  const parts = [b('loops', String(state.loops.length)), b('running', run.length ? cut(run.map((l) => l.name).join(', '), 20) : '0', run.length ? 'accent' : 'dim'), b('needs you', String(need), need ? 'warn b' : 'dim'), b('in line', String(line), line ? 'text' : 'dim'), b('model', cut(m.on ? `${m.name} ${m.where === 'this Mac' ? 'loaded' : `on ${m.where}`}` : `${m.name} off`, 30), m.on ? 'accent' : 'faint'), b('end', `window closes · ${state.maxHours ?? 24} h`, 'dim')];
  // A part that would be cut is left out whole, the last first.
  const row = [];
  for (const part of parts) { if (rowWidth(row) + rowWidth(part) > cols) break; row.push(...part); }
  return fit(row, cols);
}
function bottomBlock(state, ui, cols, now, keys) {
  const out = [];
  const a = askingOf(state);
  if (a) {
    const q = a.current.needs;
    // A narrow window says the keys shortly, so the question itself is never the part cut.
    const wide = cols >= 110;
    const how = q.kind === 'question'
      ? [p('t', 'white b'), p(wide ? ' type an answer · ' : ' answer · ', 'dim'), p('y', 'white b'), p(' yes · ', 'dim'), p('n', 'white b'), p(wide ? ' no, stop' : ' no', 'dim')]
      : [p('y', 'white b'), p(wide ? ' yes, this time · ' : ' yes · ', 'dim'), ...(q.always ? [p('a', 'white b'), p(wide ? ' yes, always · ' : ' always · ', 'dim')] : []), p('n', 'white b'), p(' no', 'dim')];
    const howW = rowWidth(how) + 4;
    out.push(fit([p(' ! ', 'warn b'), chip(a.kind), p(` ${cut(a.name, 22)} asks: `, 'white'), p(cut(q.text, Math.max(10, cols - howW - 34 - chipW(a.kind))), 'white b'), p('    '), ...how], cols, 'needs'));
  } else if (stuckOf(state)) {
    const s = stuckOf(state);
    // The keys act on the picked loop, as everywhere on the board but y / a / n.
    const how = [p('pick it: ', 'dim'), p('t', 'white b'), p(' a hint · ', 'dim'), p('r', 'white b'), p(' try again · ', 'dim'), p('s', 'white b'), p(' stop', 'dim')];
    const head = [p(' ! ', 'warn b'), chip(s.kind), p(` ${cut(s.name, 22)} is stuck: `, 'white')];
    out.push(fit([...head, p(cut(s.stuck.split(':')[0], Math.max(10, cols - rowWidth(head) - rowWidth(how) - 4)), 'white b'), p('    '), ...how], cols, 'needs'));
  } else out.push(blank(cols));
  out.push(...chatBox(state, ui, cols, now));
  out.push(statusLine(state, cols));
  if (ui.view === 'confirm') out.push(fit([p(' '), p(ui.confirm.text, 'warn b'), p('   y', 'white b'), p(' yes  ', 'dim'), p('n', 'white b'), p(' no', 'dim')], cols));
  else out.push(keysLine(cols, ui.chat?.on ? [['enter', 'send'], ['esc', 'leave the box'], ['/loop 5m <message>', 'makes a loop'], ['anything else', 'is a note to the loop named on the box']] : keys, ui.toast, now));
  return out;
}
const KEYS_TAIL = [['t', 'type'], ['r', 'run now'], ['p', 'pause'], ['e', 'every'], ['s', 'stop'], ['+', 'new loop'], ['q', 'close']];

// ---- the tree ----
function loopBox(l, lines, sel, w, now) {
  const bs = l.current?.needs ? 'warn' : sel ? 'white' : 'border';
  const inner = w - 4;
  const side = (row) => fit([p('│ ', bs), ...fit(row, inner), p(' │', bs)], w);
  const dash = fit([p('├', bs), p('┄'.repeat(w - 2), 'faint'), p('┤', bs)], w);
  const out = [];
  out.push(fit([p('┌─ ', bs), chip(l.kind), p(' ', bs), p('─'.repeat(Math.max(0, w - 5 - chipW(l.kind))), bs), p('┐', bs)], w));
  out.push(side([p(cut(l.name, inner), sel ? 'white b' : 'text')]));
  const n = l.current ? l.current.n : l.runs.at(-1)?.n ?? 0;
  out.push(side([p(paceWord(l), 'dim'), p(` · run ${n || '—'} · `, 'faint'), ...marks(l, Math.max(2, Math.floor((inner - 26) / 2)), now)]));
  out.push(dash);
  const c = cycleOf(l, lines, now);
  // A narrow box has no room for the bars: the step's mark and its note stay.
  const barW = inner >= 44 ? 8 : inner >= 30 ? 6 : 0;
  c.steps.forEach((s, i) => out.push(side([p(`${i + 1} `, 'faint'), p(pad(s.name, 8), s.state === 'active' || s.state === 'ask' ? 'white b' : s.state === 'done' ? 'text' : 'faint'), ...(barW ? [...stepBar(s, barW, now), p(' ')] : []), stepGlyph(s, now), p(' '), p(cut(s.note, inner - 12 - barW - (barW ? 1 : 0)), noteStyle(s))])));
  out.push(side([p(l.until || over(l) ? '  ' : '↺ ', 'faint'), p(cut(c.back ?? '', inner - 2), c.backTone ?? 'faint')]));
  out.push(dash);
  const [sw, ss] = stateOf(l, now);
  out.push(side([p(cut(sw, inner), ss)]));
  const lw = lastWords(l);
  out.push(side([p(cut(lw[0], inner), lw[1])]));
  out.push(fit([p('└', bs), p('─'.repeat(w - 2), bs), p('┘', bs)], w));
  return out; // 13 rows
}
// A row from a map of column → [char, style]; the rest is spaces.
function plot(cols, cells) {
  const row = [];
  let x = 0;
  for (const c of [...cells.keys()].sort((a, b) => a - b)) {
    if (c < x || c >= cols) continue;
    if (c > x) row.push(p(' '.repeat(c - x)));
    row.push(p(cells.get(c)[0], cells.get(c)[1]));
    x = c + [...cells.get(c)[0]].length;
  }
  return fit(row, cols);
}
function drawTree(state, ui, { cols, rows, now, linesOf }) {
  const out = [header(state, now, cols, 'Loops')];
  out.push(rule(cols));
  const body = rows - out.length - BOTTOM;
  const lines = [];
  lines.push(fit([p('   '), p('■', 'white'), p(' this window   ', 'faint'), p('■', 'debug'), p(' debugging   ', 'faint'), p('■', 'test'), p(' testing   ', 'faint'), p('■', 'web'), p(' the web   ', 'faint'), p('■', 'task'), p(' any other job   ', 'faint'), p('■', 'warn'), p(' needs you   ', 'faint'), p('▮▮▯', 'accent'), p(' the step a run is on', 'faint')], cols));
  const ww = Math.min(64, cols - 8);
  const wx = Math.floor((cols - ww) / 2);
  const cx = wx + Math.floor(ww / 2);
  const m = state.model;
  const run = state.loops.filter((l) => l.current && !l.current.needs);
  const inLine = state.loops.filter((l) => l.queued);
  const wrow = (row) => fit([p(' '.repeat(wx)), p('│ ', 'white'), ...fit(row, ww - 4), p(' │', 'white')], cols);
  lines.push(fit([p(' '.repeat(wx)), p('┌─ ', 'white'), p('this window', 'white b'), p(` ${'─'.repeat(ww - 16)}┐`, 'white')], cols));
  lines.push(wrow([p(cut(`${state.name} · ${state.folder}`, ww - 4), 'text')]));
  lines.push(wrow([p(m.on ? '● ' : '○ ', m.on ? 'accent' : 'faint'), p(cut(m.on ? `${m.name} ${m.where === 'this Mac' ? 'loaded' : `on ${m.where}`}` : `${m.why || `${m.name} is off`}: the loops wait`, ww - 28), m.on ? 'dim' : 'faint'), p(m.on ? (m.limit > 1 ? ` · up to ${m.limit} runs at once` : ' · one run at a time') : '', 'faint')]));
  lines.push(wrow([p('now ', 'faint'), p(run.length ? cut(run.map((l) => l.name).join(', '), 24) : 'nothing runs', run.length ? 'accent' : 'dim'), p('   in line ', 'faint'), p(inLine.length ? cut(inLine.map((l) => l.name).join(', '), ww - 46) : 'nobody', inLine.length ? 'text' : 'dim')]));
  lines.push(fit([p(' '.repeat(wx)), p(`└${'─'.repeat(ww - 2)}┘`, 'white')], cols));
  const n = state.loops.length;
  if (!n) {
    lines.push(plot(cols, new Map([[cx, ['│', 'border']]])));
    lines.push(plot(cols, new Map([[cx, ['▼', 'border']]])));
    const w = Math.min(70, cols - 8);
    const x = Math.floor((cols - w) / 2);
    const boxRow = (row) => fit([p(' '.repeat(x)), p('│ ', 'border'), ...fit(row, w - 4), p(' │', 'border')], cols);
    lines.push(fit([p(' '.repeat(x)), p(`┌${'─'.repeat(w - 2)}┐`, 'border')], cols));
    lines.push(boxRow([p('No loop yet in this window.', 'text')]));
    lines.push(boxRow([p('Press ', 'dim'), p('+', 'white b'), p(' or ', 'dim'), p('t', 'white b'), p(' and type one of these, then enter:', 'dim')]));
    lines.push(boxRow([p('  /loop test 5m', 'white'), p('                 runs the tests every 5 minutes', 'faint')]));
    lines.push(boxRow([p('  /loop debug', 'white'), p('                   fixes failing tests until they pass', 'faint')]));
    lines.push(boxRow([p('  /loop web 30m <what to read>', 'white'), p('  reads pages and says what is new', 'faint')]));
    lines.push(boxRow([p('  /loop 10m <any message>', 'white'), p('       sends your message every 10 minutes', 'faint')]));
    lines.push(fit([p(' '.repeat(x)), p(`└${'─'.repeat(w - 2)}┘`, 'border')], cols));
  } else {
    // Up to four boxes across, the picked one among them.
    const show = Math.min(n, cols >= 150 ? 5 : cols >= 110 ? 4 : 3);
    const first = Math.max(0, Math.min(ui.sel - Math.floor(show / 2), n - show));
    const vis = state.loops.slice(first, first + show);
    const gap = 2;
    const bw = Math.min(40, Math.floor((cols - 4 - (show - 1) * gap) / show));
    const x0 = Math.floor((cols - (show * bw + (show - 1) * gap)) / 2);
    const centres = vis.map((_, i) => x0 + i * (bw + gap) + Math.floor(bw / 2));
    const lo = Math.min(cx, ...centres), hi = Math.max(cx, ...centres);
    const branch = (up) => {
      const cells = new Map();
      for (let c = lo; c <= hi; c++) cells.set(c, ['─', 'border']);
      centres.forEach((c) => cells.set(c, [c === lo ? (up ? '└' : '┌') : c === hi ? (up ? '┘' : '┐') : (up ? '┴' : '┬'), 'border']));
      const at = cells.get(cx)?.[0];
      cells.set(cx, [lo === hi ? '│' : at === '─' ? (up ? '┬' : '┴') : '┼', 'border']);
      if (!up && first > 0) { const t = `‹ ${first} more `; if (lo - t.length - 1 > 0) cells.set(lo - t.length - 1, [t, 'faint']); }
      if (!up && first + show < n) cells.set(hi + 2, [`${n - first - show} more ›`, 'faint']);
      return plot(cols, cells);
    };
    lines.push(branch(false));
    lines.push(plot(cols, new Map(centres.map((c, i) => [c, ['▼', vis[i].current?.needs ? 'warn' : vis[i].current ? 'accent' : 'border']]))));
    const boxes = vis.map((l, i) => loopBox(l, linesOf(l, l.current?.n ?? l.runs.at(-1)?.n ?? 0), first + i === ui.sel, bw, now));
    for (let y = 0; y < 13; y++) lines.push(fit([p(' '.repeat(x0)), ...boxes.flatMap((b, i) => [...(i ? [p(' '.repeat(gap))] : []), ...b[y]])], cols));
    lines.push(branch(true));
  }
  // What the loops said, newest last: it takes the rows that are left.
  const logH = body - lines.length;
  if (logH >= 3) {
    const events = state.log.filter((e) => e.kind !== 'start').slice(-(logH - 2));
    lines.push(fit([p('  ┌── ', 'border'), p('loop log', 'dim'), p(` ${'─'.repeat(cols - 18)}┐`, 'border')], cols));
    for (let i = 0; i < logH - 2; i++) lines.push(fit([p('  │ ', 'border'), ...fit(events[i] ? logPieces(state, events[i], cols - 8) : (i === 0 && !events.length ? [p('nothing yet', 'faint')] : []), cols - 8), p(' │', 'border')], cols));
    lines.push(fit([p(`  └${'─'.repeat(cols - 6)}┘`, 'border')], cols));
  }
  for (let i = 0; i < body; i++) out.push(lines[i] ?? blank(cols));
  out.push(...bottomBlock(state, ui, cols, now, [['←→', 'pick'], ['enter', 'watch'], ...KEYS_TAIL]));
  return out;
}

// ---- one run full size (enter), the chat box under it ----
function drawWatch(state, ui, { cols, rows, now, linesOf }) {
  const l = state.loops.find((x) => x.id === ui.watch.id) ?? state.loops[ui.sel];
  const out = [header(state, now, cols, 'Loops')];
  if (!l) { while (out.length < rows) out.push(blank(cols)); return out; }
  const run = ui.watch.n ? [...l.runs, ...(l.current ? [l.current] : [])].find((r) => r.n === ui.watch.n) : (l.current ?? l.runs.at(-1));
  const live = run && l.current && run.n === l.current.n;
  out.push(fit([p('  '), chip(l.kind), p(' '), p(l.name, 'white b'), p(run ? `  ·  run ${run.n}  ·  ${live ? `live, ${dur(now - run.startedAt)}` : `${hm(run.startedAt)}, took ${dur(run.endedAt - run.startedAt)}  ·  `}` : '  ·  no run yet', 'dim'), ...(run && !live ? [p(cut(`${run.ok ? '✓' : '✗'} ${run.summary}`, 60), run.ok ? 'ok' : 'bad')] : [])], cols));
  out.push(rule(cols));
  const body = rows - out.length - BOTTOM;
  const lines = runLines(l, run, run ? linesOf(l, run.n) : [], cols - 2, now, { full: true });
  const scroll = Math.max(0, Math.min(ui.watch.scroll ?? 0, lines.length - body));
  const start = Math.max(0, lines.length - body - scroll);
  for (let i = 0; i < body; i++) out.push(fit([p(' '), ...(lines[start + i] ?? [])], cols));
  out.push(...bottomBlock(state, ui, cols, now, [['esc', 'back to the loops'], ['↑↓', 'scroll'], ['←→', 'older / newer run'], ['t', 'type'], ['r', 'run now'], ['p', 'pause'], ['s', 'stop']]));
  return out;
}

export function drawBoard(state, ui, size) {
  const { cols, rows } = size;
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    const out = [fit([p(`  This window is ${cols} × ${rows}. The loop board needs ${MIN_COLS} × ${MIN_ROWS} or more: make it bigger.`, 'warn')], cols)];
    while (out.length < rows) out.push(blank(cols));
    return out;
  }
  const watching = ui.view === 'watch' || (ui.view === 'confirm' && ui.confirm?.back === 'watch');
  return (watching ? drawWatch(state, ui, size) : drawTree(state, ui, size)).slice(0, rows);
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
