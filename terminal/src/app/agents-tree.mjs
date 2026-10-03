// The /agents screen: the agent tree (2 Oct 2026, the owner's pick, after the agent-tree screen of
// Claude Code's /advisor; the design round is docs/design rounds/agents-tree-design-2026-10-02.html).
// One tree from the main model down to its helpers and back: the main session (orange), the stage's
// four steps as bars (green), three helpers (blue), back to the main session, the second opinion on
// call down the left (purple), then the session log, the prompt and one status line.
// drawTree(state, { cols, rows, now }) → rows of { t, s } pieces, each row exactly `cols` wide;
// s is a style: 'c-<colour>' words, 'b' for bold, 'hl' for the highlighted rail row
// (agents-view.jsx turns them into Ink's colours). Plain data in, rows out: tested on its own.
import { STAGES } from '../agent/agents-run.mjs';

const g = (t, s = '') => ({ t: String(t), s });
const len = (s) => [...s].length;
const width = (segs) => segs.reduce((n, p) => n + len(p.t), 0);
function cut(segs, w) {
  if (width(segs) <= w) return segs;
  if (w <= 0) return [];
  const out = []; let n = 0;
  for (const p of segs) {
    const cs = [...p.t];
    if (n + cs.length <= w - 1) { out.push(p); n += cs.length; continue; }
    out.push(g(cs.slice(0, w - 1 - n).join('') + '…', p.s)); break;
  }
  return out;
}
function fit(parts, w, gap = '  ') {
  for (let k = parts.length; k > 0; k--) {
    const segs = parts.slice(0, k).flatMap((p, i) => (i ? [g(gap), ...p] : p));
    if (width(segs) <= w) return segs;
  }
  return cut(parts[0] ?? [], w);
}
function wrap(text, w) {
  const out = []; let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (len(line) + 1 + len(word) <= w) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.map((l) => (len(l) > w ? `${[...l].slice(0, w - 1).join('')}…` : l));
}
const bar = (frac, n, on = 'c-accent', off = 'c-faint') => { const k = Math.max(0, Math.min(n, Math.round(frac * n))); return [g('█'.repeat(k), on), g('░'.repeat(n - k), off)]; };
const clock = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'); };
const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
const ORANGE = 'c-orange', BLUE = 'c-blue', PURPLE = 'c-edits';
const SPIN4 = ['◐', '◓', '◑', '◒'];

// The names the tree uses for the run as it is now.
export const nodesOf = (s, k = s.stage) => (k === 3 && !s.math ? ['SUITE', 'RUN', 'EDGES', 'PROOF'] : STAGES[k].nodes);
export const advisorOf = (s) => s.reviewer ?? `${s.model} · fresh`;
export function titleOf(s) {
  if (s.verdict) return { go: 'done · GO', nogo: 'done · NO-GO', stopped: 'stopped', failed: 'stopped: an error' }[s.verdict.kind] ?? 'done';
  const k = s.stage, list = s.items?.[k] ?? [], it = list[s.item], n = list.length, i = s.item + 1;
  if (!it) return STAGES[k].name;
  return [`question ${i}/${n}`, `part ${i}/${n}`, `task ${i}/${n}`, `check ${i}/${n}`, `${String(it.title).toLowerCase()} ${i}/${n}`, 'three reviewers'][k];
}
export const nodeNow = (s) => (s.gate ? 'waiting for you' : (s.active ?? []).map((n) => nodesOf(s)[n]).join(' + '));
const findingsLine = (s) => { const f = s.findings ?? {}; return [g('Critical ', 'c-bad'), g(`${f.critical ?? 0}${f.fixed ? ' (fixed)' : ''}`, 'c-fg'), g(' · Important ', 'c-warn'), g(`${f.important ?? 0}`, 'c-fg'), g(' · Suggestion ', 'c-dim'), g(`${f.suggestion ?? 0}`, 'c-fg')]; };

// What each step does, per stage, on the loop's bars.
const DESC = [
  ['one question', 'from you', 'SPEC.md', 'against the goal'],
  ['SPEC.md', 'into tasks', 'a test for each', 'tasks/plan.md'],
  ['the test fails first', 'just enough code', null, 'a rewind point'],
  ['the whole suite', 'run it as you would', null, 'before and after'],
  ['the diff', 'try to break it', 'an input that shows it', 'with its fix'],
  ['quality + perf', 'OWASP + secrets', 'tests + coverage', 'one report'],
];
const descOf = (s, k, i) => DESC[k][i] ?? (k === 2 ? (s.math ? 'suite + math check' : 'suite + build') : s.math ? 'the same, two ways' : 'the edge cases');
function noteSegs(k) {
  const a = (t) => g(t, 'c-accent'), o = (t) => g(t, ORANGE), d = (t) => g(t, 'c-dim');
  return [
    [a('answered'), d(' → SPEC.md     '), o('vague'), d(' → ask again')],
    [a('yes'), d(' → Build     '), o('change'), d(' → plan again')],
    [a('pass'), d(' → next task     '), o('miss'), d(' → try again')],
    [a('shown'), d(' → Review     '), o('not shown'), d(' → back to Build')],
    [a('clean'), d(' → next area     '), o('critical'), d(' → back to Build')],
    [a('GO'), d(' → done     '), o('NO-GO'), d(' → fix, then Ship again')],
  ][k];
}
const BACK = ['SPEC.md, then the plan', 'your yes, then Build', 'a rewind point, then the next task', 'the proof, then Review', 'the findings, then Ship', 'one report: GO or NO-GO'];

// When the second opinion is lit: just asked (4 s), the plan, a task on its second try, a doubt review.
export function railActive(s, now) {
  if (s.verdict) return null;
  if (s.adv?.at && now - (s.adv.atTime ?? 0) < 4000) return s.adv.at;
  if (s.stage === 1) return 'plan';
  if (s.stage === 2 && s.tries > 1) return 'miss';
  if ((s.items?.[2] ?? []).some((t) => t.doubt === 'wait') || s.stage === 5) return 'done';
  return null;
}

// ---- a canvas of cells ----
function canvas(w, h) {
  const G = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', c: '', bg: '' })));
  const ok = (x, y) => y >= 0 && y < h && x >= 0 && x < w;
  const put = (x, y, ch, c = '') => { if (ok(x, y)) G[y][x] = { ch, c, bg: G[y][x].bg }; };
  const text = (x, y, segs, max = w - x) => { let col = x; for (const p of cut(segs, Math.max(0, max))) for (const ch of p.t) put(col++, y, ch, p.s); return col; };
  const center = (x0, x1, y, segs) => { const c = cut(segs, x1 - x0); text(x0 + Math.max(0, Math.floor((x1 - x0 - width(c)) / 2)), y, c, x1 - x0); };
  const box = (x, y, bw, bh, c) => {
    for (let i = 1; i < bw - 1; i++) { put(x + i, y, '─', c); put(x + i, y + bh - 1, '─', c); }
    for (let j = 1; j < bh - 1; j++) { put(x, y + j, '│', c); put(x + bw - 1, y + j, '│', c); }
    put(x, y, '┌', c); put(x + bw - 1, y, '┐', c); put(x, y + bh - 1, '└', c); put(x + bw - 1, y + bh - 1, '┘', c);
  };
  const blank = (x0, y0, bw, bh) => { for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) put(x, y, ' '); };
  const shade = (x0, x1, y, bg) => { for (let x = x0; x < x1; x++) if (ok(x, y)) G[y][x].bg = bg; };
  const rows = () => G.map((row) => {
    const segs = [];
    for (const cell of row) { const st = [cell.c, cell.bg].filter(Boolean).join(' '); const last = segs[segs.length - 1]; if (last && last.s === st) last.t += cell.ch; else segs.push(g(cell.ch, st)); }
    return segs;
  });
  return { put, text, center, box, blank, shade, rows };
}

// Under 38 rows (a window that cannot grow: VS Code, tmux, a small screen) the tree is too tall:
// the same run as lines, the loop's bars kept, the helpers and the second opinion one line each.
function drawCompact(s, { cols: W, rows: H, now, reduced }) {
  const C = canvas(W, H), k = s.stage;
  const moving = !s.verdict && !s.paused && !s.gate && !reduced;
  const spin = () => (moving ? SPIN4[Math.floor(now / 170) % 4] : '◐');
  const advisor = advisorOf(s);
  C.text(1, 0, fit([[g('/agents', 'c-accent b'), g(' · ', 'c-faint'), g(String(s.model), `${ORANGE} b`), g(' works', 'c-dim')], [g(advisor, `${PURPLE} b`), g(' on call', 'c-dim')]], W - 2, ' · '), W - 2);
  const go = s.verdict?.kind === 'go';
  C.text(1, 1, fit(STAGES.map((st, i) => [g(st.name, i < k || go ? 'c-fg' : i === k ? 'c-white b' : 'c-dim'), g(' '), g(i < k || go ? '✓' : i === k ? '●' : '○', i < k || go ? 'c-accent' : i === k ? 'c-accent' : 'c-faint')]), W - 2, ' ─ '), W - 2);
  const lbh = 7, lbw = W - 2;
  C.box(1, 2, lbw, lbh, 'c-accent');
  C.text(3, 3, [g(`${STAGES[k].name.toUpperCase()} · ${s.verdict ? 'done' : titleOf(s)}`, 'c-accent b'), ...(k === 2 && (s.tries ?? 1) > 1 ? [g(`  try ${s.tries}`, `${ORANGE} b`)] : [])], lbw - 4);
  const barW = 12;
  for (let i = 0; i < 4; i++) {
    const st = s.verdict ? 'done' : s.nodes?.[i] ?? 'todo';
    const p = (s.active ?? []).includes(i) ? Math.max(0.04, Math.min(0.95, (now - (s.stepAt ?? now)) / Math.max(1000, s.stepEta ?? 20_000))) : 0;
    const segs = st === 'done' ? [g('█'.repeat(barW), 'c-accentDim'), g('  ✓ ', 'c-accent'), g(descOf(s, k, i), 'c-dim')]
      : st === 'now' ? [...bar(p, barW), g(`  ${spin()} `, 'c-accent'), g(descOf(s, k, i), 'c-white')]
      : st === 'miss' ? [g('█'.repeat(barW), ORANGE), g('  ✗ ', ORANGE), g(s.miss || 'a miss', ORANGE)]
      : st === 'stop' ? [g('█'.repeat(barW), 'c-warn'), g('  ■ asks you', 'c-warn')]
      : [g('░'.repeat(barW), 'c-faint'), g('  ○ ', 'c-faint'), g(descOf(s, k, i), 'c-faint')];
    C.text(3, 4 + i, [g(nodesOf(s)[i].toLowerCase().padEnd(9), st === 'now' ? 'c-white' : 'c-dim'), ...segs], lbw - 4);
  }
  const lanes = (s.lanes?.length ? s.lanes : []).slice(0, 3);
  C.text(1, 2 + lbh, fit(lanes.map((l) => { const st = s.verdict ? 'done' : l.status ?? 'wait'; return [g(l.name, st === 'wait' ? 'c-dim' : `${BLUE} b`), g(' '), st === 'run' ? g(`${spin()} ${l.does}`, BLUE) : st === 'done' ? g('✓ done', 'c-accent') : st === 'bad' ? g('✗ a miss', ORANGE) : g('○ waits', 'c-faint')]; }), W - 2, '  ·  '), W - 2);
  const act = railActive(s, now);
  C.text(1, 3 + lbh, [g(act ? '◆ ' : '◇ ', act ? PURPLE : 'c-dim'), g('2nd opinion', `${PURPLE} b`), g(` · ${s.adv?.calls ?? 0} calls · `, 'c-dim'), g(`» ${s.adv?.last || 'nothing yet'}`, PURPLE)], W - 2);
  const v = s.verdict;
  C.text(1, 4 + lbh, v ? [g(v.kind === 'go' ? 'GO' : v.kind === 'nogo' ? 'NO-GO' : 'STOPPED', `${v.kind === 'go' ? 'c-accent' : 'c-warn'} b`), g(' · ', 'c-faint'), ...(v.kind === 'go' ? findingsLine(s) : [g(v.why ?? '', 'c-fg')])] : [g('▼ back to main session · ', ORANGE), g(BACK[k], 'c-white')], W - 2);
  return { C, logTop: 5 + lbh, H, W };
}

export function drawTree(s, { cols = 112, rows: H = 59, now = Date.now(), reduced = false } = {}) {
  if (H < 38) { const c = drawCompact(s, { cols, rows: H, now, reduced }); return finishBottom(s, c.C, { W: cols, H, logTop: c.logTop, now }); }
  const W = cols, C = canvas(W, H), k = s.stage;
  const roomy = H >= 57, tight = H < 44, rail = W >= 88;
  const moving = !s.verdict && !s.paused && !s.gate && !reduced;
  const tick = Math.floor(now / 120);
  const spin = () => (moving ? SPIN4[Math.floor(now / 170) % 4] : '◐');
  const pulse = () => (!moving || Math.floor(now / 450) % 2 ? 'c-accent' : 'c-accentDim');
  // Dots that travel along a connector while work moves along it (still at a pause or a question).
  const dotsOn = (path, color, speed = 1, off = 0) => {
    if (!path.length || !moving) return;
    const pos = Math.floor(tick * speed + off) % path.length;
    if (pos > 0) C.put(path[pos - 1][0], path[pos - 1][1], '•', color);
    C.put(path[pos][0], path[pos][1], '●', color);
  };
  const advisor = advisorOf(s);
  let y = roomy ? 1 : 0;
  C.center(0, W, y, [g('AGENTIC CODER · /agents', 'c-white b'), g('  ·  ', 'c-faint'), g(String(s.model).toUpperCase(), `${ORANGE} b`), g(' WORKS', 'c-white b'), g('  ·  ', 'c-faint'), g(advisor.toUpperCase(), `${PURPLE} b`), g(' ON CALL', 'c-white b')]); y++;
  if (!tight) {
    for (let i = 1; i < W - 1; i++) C.put(i, y, '─', 'c-faint');
    y++;
    C.center(0, W, y, [g('■ ', ORANGE), g('main · high', 'c-dim'), g('   '), g('■ ', BLUE), g('helpers · med', 'c-dim'), g('   '), g('■ ', 'c-accent'), g('loop · tests', 'c-dim'), g('   '), g('■ ', PURPLE), g('2nd opinion · doubt', 'c-dim')]);
    y++;
  }
  if (roomy) y++;
  const top = y;
  const RX = 1, RW = rail ? (W >= 100 ? 24 : 20) : 0;
  const CX0 = rail ? RX + RW + 3 : 1, CW = W - 1 - CX0, cm = CX0 + Math.floor(CW / 2);
  // 1 · the main session
  const go = s.verdict?.kind === 'go';
  const mw = Math.min(36, CW - 2), mx = cm - Math.floor(mw / 2), my = y;
  C.box(mx, my, mw, 6, ORANGE);
  [
    [g(`${s.model} · main session`, `${ORANGE} b`)],
    [g('plans + decides', 'c-white')],
    [g('effort ', 'c-dim'), g('▮▮▮▮', ORANGE), g(' high', ORANGE)],
    [g('stage ', 'c-dim'), ...STAGES.map((_, i) => g(i < k || go ? '▮' : i === k ? '▮' : '▯', i < k || go ? 'c-accentDim' : i === k ? pulse() : 'c-faint')), g(` ${String(k + 1).padStart(2, '0')} ${STAGES[k].name}`, 'c-white')],
  ].forEach((l, i) => C.center(mx + 1, mx + mw - 1, my + 1 + i, l));
  y += 6;
  const trunk = [];
  for (let i = 0; i < (roomy ? 2 : 1); i++) { C.put(cm, y, '│', 'c-faint'); trunk.push([cm, y]); y++; }
  // 2 · the loop of this stage, as bars
  const lbw = Math.min(52, CW - 2), lbx = cm - Math.floor(lbw / 2), lby = y, lbh = tight ? 7 : 8;
  C.box(lbx, lby, lbw, lbh, 'c-accent');
  const tl = [g(`${STAGES[k].name.toUpperCase()} · ${s.verdict ? 'done' : titleOf(s)}`, 'c-accent b')];
  const tr = k === 2 && !s.verdict ? [g('tries ', 'c-dim'), g(String(s.tries ?? 1), (s.tries ?? 1) > 1 ? `${ORANGE} b` : 'c-white b')] : [g('stops ', 'c-dim'), g(String(s.stops ?? 0), s.stops ? 'c-warn b' : 'c-white b')];
  C.text(lbx + 2, lby + 1, tl, lbw - 6 - width(tr)); C.text(lbx + lbw - 2 - width(tr), lby + 1, tr);
  const barW = Math.max(6, Math.min(12, lbw - 40));
  for (let i = 0; i < 4; i++) {
    const st = s.verdict ? 'done' : s.nodes?.[i] ?? 'todo', label = nodesOf(s)[i].toLowerCase();
    const p = (s.active ?? []).includes(i) ? Math.max(0.04, Math.min(0.95, (now - (s.stepAt ?? now)) / Math.max(1000, s.stepEta ?? 20_000))) : 0;
    const filled = Math.max(1, Math.round(p * barW));
    const barSegs = st === 'done' ? [g('█'.repeat(barW), 'c-accentDim')] : st === 'now' ? bar(p, barW, 'c-accent') : st === 'miss' ? [g('█'.repeat(barW), ORANGE)]
      : st === 'stop' ? [g('█'.repeat(filled), 'c-warn'), g('░'.repeat(barW - filled), 'c-faint')] : [g('░'.repeat(barW), 'c-faint')];
    const tail = st === 'done' ? [g('✓ ', 'c-accent'), g(descOf(s, k, i), 'c-dim')]
      : st === 'now' ? [g(`${spin()} `, 'c-accent'), g(k === 2 && i === 1 && (s.tries ?? 1) > 1 ? `try ${s.tries}: ${descOf(s, k, i)}` : descOf(s, k, i), 'c-white')]
      : st === 'miss' ? [g('✗ ', ORANGE), g(s.miss || 'a miss', ORANGE)]
      : st === 'stop' ? [g('■ ', 'c-warn'), g('asks you', 'c-warn')]
      : [g('○ ', 'c-faint'), g(descOf(s, k, i), 'c-faint')];
    C.text(lbx + 2, lby + 2 + i, [g(label.padEnd(9), st === 'now' ? 'c-white' : 'c-dim'), ...barSegs, g('  '), ...tail], lbw - 4);
  }
  if (!tight) C.text(lbx + 2, lby + 6, noteSegs(k), lbw - 4);
  y += lbh;
  // 3 · handed to the helpers
  const hand = [];
  if (roomy) { C.put(cm, y, '│', 'c-faint'); hand.push([cm, y]); y++; }
  C.center(CX0, W - 1, y, [g('hand off to helpers · ', 'c-white'), g('effort medium', `${BLUE} b`)]); y++;
  if (roomy) { C.put(cm, y, '│', 'c-faint'); hand.push([cm, y]); y++; }
  const lw = Math.min(24, Math.floor((CW - 4) / 3) - 2), d = lw + 3, lc = [cm - d, cm, cm + d], by = y;
  for (let xx = lc[0]; xx <= lc[2]; xx++) C.put(xx, by, '─', 'c-faint');
  C.put(lc[0], by, '┌', 'c-faint'); C.put(lc[2], by, '┐', 'c-faint'); C.put(cm, by, roomy ? '┼' : '┬', 'c-faint');
  y++;
  lc.forEach((c) => C.put(c, y, '▼', BLUE)); y++;
  const lanes = (s.lanes?.length ? s.lanes : [{ name: 'explorer', does: 'waits' }, { name: 'worker', does: 'waits' }, { name: 'checker', does: 'waits' }]).slice(0, 3);
  const states = lanes.map((l) => (s.verdict ? (l.status === 'bad' ? 'bad' : 'done') : l.status ?? 'wait'));
  const lh = roomy ? 7 : 6, ly = y;
  lanes.forEach((l, i) => {
    const lx = lc[i] - Math.floor(lw / 2), st = states[i], dim = st === 'wait';
    C.box(lx, ly, lw, lh, dim ? 'c-faint' : st === 'bad' ? ORANGE : BLUE);
    const status = st === 'run' ? [g(`${spin()} running`, BLUE)] : st === 'done' ? [g('✓ done', 'c-accent')] : st === 'bad' ? [g('✗ ', ORANGE), g(k === 5 ? 'critical' : 'a miss', ORANGE)] : [g('○ waits', 'c-faint')];
    [
      [g(l.name, dim ? 'c-dim b' : 'c-white b')],
      ...(roomy ? [[g(s.model, dim ? 'c-faint' : BLUE)]] : []),
      [g('effort ', 'c-faint'), g('▮▮', dim ? 'c-faint' : BLUE), g('▯', 'c-faint'), g(' med', dim ? 'c-faint' : BLUE)],
      [g(l.does ?? '', dim ? 'c-dim' : 'c-white')],
      status,
    ].forEach((segs, j) => C.center(lx + 1, lx + lw - 1, ly + 1 + j, segs));
  });
  y += lh;
  // 4 · back to the main session
  if (roomy) { lc.forEach((c) => C.put(c, y, '│', 'c-faint')); y++; }
  const my2 = y;
  for (let xx = lc[0]; xx <= lc[2]; xx++) C.put(xx, my2, '─', 'c-faint');
  C.put(lc[0], my2, '└', 'c-faint'); C.put(lc[2], my2, '┘', 'c-faint'); C.put(cm, my2, '┼', 'c-faint');
  y++;
  C.put(cm, y, '▼', ORANGE); y++;
  const bw = Math.min(42, CW - 2), bx = cm - Math.floor(bw / 2), byy = y, bh = tight ? 3 : 4;
  const v = s.verdict;
  C.box(bx, byy, bw, bh, v ? { go: 'c-accent', nogo: 'c-bad' }[v.kind] ?? 'c-warn' : ORANGE);
  const f = s.findings ?? {};
  const goLine = width([g('GO · '), ...findingsLine(s)]) <= bw - 2 ? findingsLine(s) : [g(`${f.critical ?? 0} critical · ${f.important ?? 0} important · ${f.suggestion ?? 0} sugg.`, 'c-fg')];
  const head = v ? (v.kind === 'go' ? [g('GO', 'c-accent b'), g(' · ', 'c-faint'), ...goLine] : v.kind === 'nogo' ? [g('NO-GO', 'c-bad b'), g(` · ${v.why}`, 'c-fg')] : [g(v.kind === 'failed' ? 'FAILED' : 'STOPPED', 'c-warn b'), g(` · ${v.why ?? ''}`, 'c-fg')])
    : [g('back to main session · ', ORANGE), g('high', `${ORANGE} b`)];
  const second = v ? [g('rollback: /rewind · nothing committed', 'c-dim')] : [g(BACK[k], 'c-white')];
  (tight ? [head] : [head, second]).forEach((segs, j) => C.center(bx + 1, bx + bw - 1, byy + 1 + j, segs));
  y += bh;
  const bottom = y;
  // The second opinion, down the left: the three moments it is asked, a dashed arrow to the box it advises.
  if (rail) {
    const x0 = RX, w = RW, moments = [{ id: 'plan', row: my + 3, tx: mx }, { id: 'miss', row: lby + 3, tx: lbx }, { id: 'done', row: byy + 1, tx: bx }];
    C.box(x0, top, w, bottom - top, PURPLE);
    C.center(x0 + 1, x0 + w - 1, top + 1, [g('SECOND OPINION', `${PURPLE} b`)]);
    C.center(x0 + 1, x0 + w - 1, top + 2, [g(w >= 24 ? `${advisor} · on call` : advisor, PURPLE)]);
    const act = railActive(s, now), LABEL = { plan: 'before the plan', miss: 'after a miss', done: 'before done' };
    const cx = x0 + 2, tw = w - 5;
    for (let r = moments[0].row + 1; r < moments[2].row; r++) C.put(cx, r, '┊', 'c-faint');
    for (const m of moments) {
      const on = act === m.id;
      if (on) C.shade(x0 + 1, x0 + w - 1, m.row, 'hl');
      C.put(cx, m.row, on ? '◆' : '◇', on ? PURPLE : 'c-dim');
      C.text(cx + 2, m.row, [g(LABEL[m.id], on ? `${PURPLE} b` : 'c-dim')], tw);
      const path = [];
      for (let xx = x0 + w + 1; xx < m.tx - 1; xx++) { C.put(xx, m.row, '┄', on ? PURPLE : 'c-faint'); path.push([xx, m.row]); }
      C.put(m.tx - 1, m.row, '▸', on ? PURPLE : 'c-faint');
      if (on) dotsOn(path, PURPLE, 1.3);
    }
    const adv = s.adv ?? {};
    const A = [[g('last advice:', 'c-dim')], ...wrap(`» ${adv.last || 'nothing yet'}`, tw).slice(0, 3).map((l) => [g(l, `${PURPLE} b`)])];
    const para = (t) => wrap(t, tw).map((l) => [g(l, 'c-fg')]);
    const B = [[g('calls', 'c-dim'), g(String(adv.calls ?? 0).padStart(tw - 5), 'c-white b')], [g('tokens', 'c-dim'), g(fmtK(adv.tokens ?? 0).padStart(tw - 6), 'c-white b')], [],
      ...para('reads the whole run: SPEC.md, the plan, each diff and each result'), [], ...para('silent on every routine step'), [], ...para('never edits code. the main model applies the advice.')];
    const fill = (ya, yb, lines) => {
      const room = yb - ya + 1;
      if (room <= 0) return;
      const L = lines.slice();
      while (L.length > room && L.some((l) => !l.length)) L.splice(L.findIndex((l) => !l.length), 1);
      L.slice(0, room).forEach((l, j) => C.text(cx + 2, ya + j, l, tw));
    };
    fill(moments[0].row + 2, moments[1].row - 2, A);
    fill(moments[1].row + 2, moments[2].row - 2, B);
  }
  // The dots: down the trunk while it works, out to each helper at work, back from each one done.
  dotsOn(trunk.length > 1 ? trunk : [[cm, my + 5], ...trunk], ORANGE, 0.6);
  if (hand.length) dotsOn(hand, 'c-white', 0.6, 1);
  states.forEach((st, i) => {
    const out = [], back = [], step = lc[i] >= cm ? 1 : -1;
    for (let xx = cm; xx !== lc[i] + step; xx += step) out.push([xx, by]);
    out.push([lc[i], by + 1]);
    for (let xx = lc[i]; xx !== cm - step; xx -= step) back.push([xx, my2]);
    back.push([cm, my2 + 1]);
    if (st === 'run') dotsOn(out, BLUE, 1, i * 3);
    if (st === 'done') dotsOn(back, 'c-white', 1, i * 5);
  });
  return finishBottom(s, C, { W, H, logTop: bottom + (roomy ? 1 : 0), now });
}

function finishBottom(s, C, { W, H, logTop, now }) {
  const k = s.stage;
  const states = (s.lanes ?? []).slice(0, 3).map((l) => (s.verdict ? (l.status === 'bad' ? 'bad' : 'done') : l.status ?? 'wait'));
  // 5 · the session log, or the question it waits on; then the prompt and the status line.
  const drawLog = (x0, y0, w, h) => {
    if (h < 3) return;
    C.box(x0, y0, w, h, 'c-faint');
    C.text(x0 + 3, y0, [g(' session log ', 'c-dim')]);
    (s.log ?? []).slice(-(h - 2)).forEach((e, j) => {
      const wc = e.who === 'main' ? ORANGE : e.who === 'you' ? 'c-white' : e.who === '2nd opinion' ? PURPLE : e.who === 'stop' ? 'c-warn' : BLUE;
      const tc = { bad: 'c-bad', warn: 'c-warn', good: 'c-accent', stage: 'c-plan' }[e.tone] ?? 'c-fg';
      C.text(x0 + 2, y0 + 1 + j, [g(clock(e.t), 'c-faint'), g('   '), g(String(e.who).padEnd(17), `${wc} b`), g(e.text, tc)], w - 4);
    });
  };
  if (s.gate) {
    const G = s.gate, inner = W - 6;
    const bc = G.kind === 'stop' ? 'c-warn' : G.kind === 'plan' ? 'c-accent' : 'c-plan';
    const lines = [[g(`${G.kind === 'stop' ? '■' : G.kind === 'plan' ? '▶' : '?'} ${G.title}`, `${bc} b`)], ...wrap(G.detail ?? '', inner).slice(0, 3).map((l) => [g(l, 'c-fg')]),
      ...(G.opts ?? []).map((o, i) => [g(i === G.sel ? '› ' : '  ', 'c-accent'), g(`${i + 1}. `, i === G.sel ? 'c-white' : 'c-dim'), g(o, i === G.sel ? 'c-white b' : 'c-dim')]),
      [g(G.kind === 'plan' ? '1–3 or ↑↓ enter · it waits for your yes · esc: the chat' : '1–3 or ↑↓ enter · it waits for you · esc: the chat', 'c-faint')]];
    const gh = lines.length + 2, gy = H - 1 - gh;
    C.blank(1, gy, W - 2, gh);
    C.box(1, gy, W - 2, gh, bc);
    lines.forEach((l, j) => C.text(3, gy + 1 + j, l, inner));
    if (gy - logTop >= 3) drawLog(1, logTop, W - 2, gy - logTop);
  } else {
    drawLog(1, logTop, W - 2, H - 2 - logTop);
    C.text(1, H - 2, [g('› ', 'c-accent'), g('/agents ', 'c-accent b'), g(s.request, 'c-white'), g('  '), g(s.verdict ? 'esc gives the window back' : 'esc: the chat · p: pause', 'c-faint')], W - 2);
  }
  const br = (label, val, c) => [g(`${label} `, 'c-dim'), g('[', 'c-faint'), g(val, c), g(']', 'c-faint')];
  const n = (s.items?.[k] ?? []).length;
  C.text(1, H - 1, fit([
    ...(s.paused ? [[g('paused', 'c-warn b')]] : []),
    br('stage', s.verdict ? titleOf(s) : `${STAGES[k].name} ${Math.min((s.item ?? 0) + 1, Math.max(1, n))}/${Math.max(1, n)}`, 'c-accent'),
    br('helpers', `${states.filter((x) => x === 'run').length}/3`, BLUE),
    br('2nd opinion', railActive(s, now) ? 'advising' : 'on call', PURPLE),
    br('guards', s.tripped ? 'asks you' : k === 2 && !s.verdict ? `diff ${s.diff ?? 0}/100 · tries ${Math.min(3, s.tries ?? 1)}/3` : 'clear', s.tripped ? 'c-warn' : 'c-accent'),
    br('rewind', String(s.rewind ?? 0), ORANGE),
  ], W - 2, '  '), W - 2);
  return C.rows();
}

// The one live line above the prompt box while /agents goes on behind the chat.
export function agentsLine(s, now = Date.now()) {
  if (!s) return null;
  const spin = s.verdict || s.paused || s.gate ? (s.verdict ? '✓' : '◐') : SPIN4[Math.floor(now / 170) % 4];
  const what = s.gate ? `waiting for you: ${s.gate.title}` : nodeNow(s);
  return [g('╰─ ', 'c-rail'), g(spin, s.verdict ? 'c-accent' : s.gate ? 'c-warn' : BLUE), g(' /agents', 'c-accent b'), g(` · ${STAGES[s.stage].name} · ${titleOf(s)}${what ? ` · ${what}` : ''}`, s.gate ? 'c-warn' : 'c-dim'), g(' · /agents opens it', 'c-faint')];
}
export { width as rowWidth };
