// The hub's Flow tab: how Agentic Coder works, as eight drawings, with every
// model in /model drawn into them. Nothing on it is typed in by hand any more:
// each time the tab opens it reads what the Harness tab reads (the model list
// and each settings card, the limits in use, the newest test the models have in
// common) and, from that test, which path each task took and one task's real
// steps on each model. A model added to the list shows up here by itself.
//   /flow        the page, drawn here (flow.html holds its styles and its tab keys)
//   /flow.json   the same facts as data
// Every model gets the same parts: its own box in the big picture, and the same
// small row ("twin") wherever the model is used. A click on a model's name at the
// top draws the flow with that model alone. The steps are the hub's one list
// (steps.mjs), the same the Harness tab tells as its five.
//   scripts/flow-page.mjs saves a dated copy of the page into docs/diagrams/.
import shell from './flow.html' with { type: 'text' };
import { MODELS, sideByMost } from '../../../models/index.mjs';
import { harnessData } from './harness-hub.mjs';
import { STEPS, STAGES, stepsOf, stagesInWords } from './steps.mjs';

// The paths a request can take, as the drawings name them. The run's raw results say which one each task took.
export const PATHS = ['rename', 'fix', 'change', 'multi', 'loop'];

// What the tab shows, as data: the Harness tab's facts, plus the paths and the example task.
// `models`, `settings` and `record` can be given (a test's own).
export function flowData(cwd, { models = Object.values(MODELS), settings, record } = {}) {
  // The newest run every model shares, else the one the most of them share (the rest show "not run yet").
  const side = record ?? sideByMost(models.map((m) => m.id));
  const h = harnessData(cwd, { models, settings, record: side });
  const M = h.models, run = h.run;
  const of = (m, t) => m.run?.tasks?.[t.id ?? t];
  // The paths are drawn only when the run says which one every task took, on every model.
  const known = Boolean(run) && M.every((m) => m.run) && run.tasks.every((t) => M.every((m) => of(m, t)?.path));
  const paths = known ? PATHS.map((id) => ({ id, models: Object.fromEntries(M.map((m) => { const ts = run.tasks.map((t) => of(m, t)).filter((x) => x.path === id); return [m.id, { n: ts.length, passed: ts.filter((x) => x.pass).length, secs: ts.reduce((n, x) => n + x.secs, 0), thenLoop: ts.filter((x) => x.thenLoop).length }]; })) })) : null;
  const ex = side.run?.example;
  const example = ex && M.every((m) => ex.models?.[m.id] && of(m, ex.task)) ? {
    task: ex.task, n: parseInt(ex.task, 10) || 0, request: ex.request, memory: Boolean(ex.memory),
    models: Object.fromEntries(M.map((m) => { const r = of(m, ex.task); return [m.id, { ...ex.models[m.id], request: undefined, pass: r.pass, secs: r.secs, calls: r.calls }]; })),
  } : null;
  return {
    ...h,
    folders: Object.fromEntries(models.map((m) => [m.id, m.folder ?? m.id])),
    paths,
    // On how many of the tasks every model took the same path.
    samePath: known ? run.tasks.filter((t) => new Set(M.map((m) => of(m, t).path)).size === 1).length : null,
    example,
  };
}

// ── the page ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const mins = (s) => `${Math.round(s / 60)} min`;
// The time a path's tasks took: seconds while it is under a minute, so a quick path never reads "0 min".
const took = (s) => (s < 60 ? `${Math.round(s)} s` : mins(s));
const dur = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const k = (n) => `${Math.round(n / 1024)}k`;
const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a.join(''));
// Words that change when one model is picked at the top (the Harness tab's way): `both` with every model, `one` with the picked one.
const sw = (both, one) => `<span class="sw" data-both="${esc(both)}" data-one="${esc(one)}">${esc(both)}</span>`;

export function flowPage(d, { dated = '' } = {}) {
  const M = d.models, S = d.settings, run = d.run, T = run?.tasks.length ?? 0;
  const many = M.length > 1;
  const two = M.length === 2 ? 'both' : 'every model';
  // A model's name where there is little room: its first word, unless another model shares it or it is too short to tell.
  const short = (m) => { const w = m.name.split(' ')[0]; return w.length > 2 && M.filter((o) => o.name.split(' ')[0] === w).length === 1 ? w : m.name; };
  // A run only some models share (the most of them; sideByMost): who is in it, by name.
  const inRun = M.filter((m) => m.run), part = Boolean(run) && inRun.length < M.length;
  const runWho = part ? list(inRun.map(short)) : two;
  const tags = (m) => m.tags.map((t) => `<span class="tag${t === 'in use now' ? ' live' : ''}">${t}</span>`).join('');
  const live = (m) => m.tags.includes('in use now');
  const runDay = run ? new Date(run.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const runLine = run ? `${run.name}, ${runDay}: thinking ${run.thinking ? 'on' : 'off'}${run.effort ? ` (${String(run.effort)[0].toUpperCase() + String(run.effort).slice(1)})` : ''}${run.ctx ? `, ${k(run.ctx)}` : ''}${run.limitMins ? `, ${run.limitMins} minutes a task at most` : ''}, each task run ${run.reps > 1 ? `${run.reps} times` : 'once'}` : '';
  const noRun = `No test yet that ${many ? (M.length === 2 ? 'both models' : 'every model') : 'this model'} ran. Run ${many ? 'the same test on each model' : 'a test'} from the Arena${many ? ', with the same settings' : ''}.`;
  // The one that is strictly best gets the bold; a tie, or a model with no number, marks no one.
  const bestOf = (dir, val) => { if (!many) return null; const v = M.map(val); if (v.some((x) => x == null)) return null; const top = dir === 'low' ? Math.min(...v) : Math.max(...v); return v.filter((x) => x === top).length === 1 ? M[v.indexOf(top)].id : null; };
  const P = d.paths ? Object.fromEntries(d.paths.map((p) => [p.id, p])) : null;
  // The better model on a path: the one that passed more; level on that, the one that took less time.
  const betterOn = (p) => { if (!p || !many) return null; const top = Math.max(...M.map((m) => p.models[m.id].passed)), lead = M.filter((m) => p.models[m.id].passed === top && p.models[m.id].n); if (lead.length === 1) return lead[0].id; const t = Math.min(...lead.map((m) => p.models[m.id].secs)), f = lead.filter((m) => p.models[m.id].secs === t); return f.length === 1 ? f[0].id : null; };
  // How many tasks went down a path, when every model agrees on it.
  const countOf = (p) => { const ns = new Set(M.map((m) => p.models[m.id].n)); return ns.size === 1 ? [...ns][0] : null; };
  // Twin rows stay readable up to four models; more than that, they get smaller.
  const TW = M.length <= 3 ? { h: 17, gap: 3, cls: '', per: 1 } : { h: 14, gap: 2, cls: ' sm', per: 0.86 };
  const twinH = M.length * (TW.h + TW.gap) - TW.gap;

  class Fig {
    constructor(id, W, H, top = 0) { this.id = id; this.W = W; this.H = H; this.top = top; this.p = []; }
    // Words wider than their room are pressed into it, never drawn past the box.
    fit(text, room, per) { return String(text).length * per > room ? ` textLength="${Math.max(20, room).toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : ''; }
    // A box: bold title + muted sub lines, centred. dot = "can call the model". A sub line may be { t, k } for its own look.
    box(x, y, w, h, { k = '', t, s = [], dot = false, mono = false, attr = '' } = {}) {
      const subs = arr(s), total = (t ? 15 : 0) + 13.5 * subs.length, y0 = y + (h - total) / 2;
      let o = `<g class="node ${k}"${attr ? ` ${attr}` : ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/>`;
      if (t) o += `<text class="h${mono ? ' m' : ''}" x="${x + w / 2}" y="${(y0 + 11).toFixed(1)}" text-anchor="middle"${this.fit(t, w - 14, mono ? 8.2 : 7.6)}>${esc(t)}</text>`;
      subs.forEach((l, i) => { const L = typeof l === 'string' ? { t: l, k: '' } : l; o += `<text class="s ${L.k}" x="${x + w / 2}" y="${(y0 + (t ? 15 : 0) + 13.5 * i + 10).toFixed(1)}" text-anchor="middle"${this.fit(L.t, w - 10, 6)}>${esc(L.t)}</text>`; });
      if (dot) o += `<circle class="dotm" cx="${x + w - 11}" cy="${y + 11}" r="4.6"/>`;
      this.p.push(o + '</g>');
    }
    group(x, y, w, h, label, k = '') { this.p.push(`<g class="grp ${k}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/><text x="${x + 16}" y="${y + 22}">${esc(label)}</text></g>`); }
    arrow(pts, { label, lp, a = 'middle', m = false, d = false, both = false, line = false } = {}) {
      const dd = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ');
      const mk = m ? `am-${this.id}` : `ah-${this.id}`;
      let o = `<path class="ar${m ? ' m' : ''}${d ? ' d' : ''}" d="${dd}"${line ? '' : ` marker-end="url(#${mk})"`}${both ? ` marker-start="url(#${mk})"` : ''}/>`;
      if (label) o += arr(label).map((l, i) => `<text class="lab${m ? ' am' : ''}" x="${lp[0]}" y="${lp[1] + 13 * i}" text-anchor="${a}">${esc(l)}</text>`).join('');
      this.p.push(o);
    }
    text(x, y, text, { a = 'start', k = 's', lh = 15 } = {}) { this.p.push(arr(text).map((l, i) => `<text class="${k}" x="${x}" y="${y + lh * i}" text-anchor="${a}">${esc(l)}</text>`).join('')); }
    raw(s) { this.p.push(s); }
    // One small row for each model, the same for every model: its name on the left, its number on
    // the right. With one model picked at the top, that model's row alone, in the first row's place.
    twin(x, y, w, val, { best = null } = {}) {
      const row = (m, yy, cls, attr) => { const name = short(m), v = String(val(m)), nameW = Math.min(name.length * 6.6 * TW.per, w * 0.5); return `<g class="tw${TW.cls}${cls}" ${attr}><rect x="${x}" y="${yy}" width="${w}" height="${TW.h}" rx="5"/><text class="twn" x="${x + 7}" y="${yy + TW.h * 0.72}"${this.fit(name, w * 0.5, 6.6 * TW.per)}>${esc(name)}</text><text class="twv" x="${x + w - 7}" y="${yy + TW.h * 0.72}" text-anchor="end"${this.fit(v, w - nameW - 22, 5.9 * TW.per)}>${esc(v)}</text></g>`; };
      const all = M.map((m, i) => row(m, y + i * (TW.h + TW.gap), best === m.id ? ' best' : '', `data-model="${esc(m.id)}"`)).join('');
      this.p.push(many ? `<g class="when-all">${all}</g>${M.map((m) => row(m, y, '', `data-only="${esc(m.id)}" hidden`)).join('')}` : all);
      return y + twinH;
    }
    render(aria) {
      const i = this.id;
      return `<svg viewBox="0 ${this.top} ${this.W} ${this.H - this.top}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMin meet">` +
        `<defs><marker id="ah-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="mk" d="M0 1 L10 5 L0 9 z"/></marker>` +
        `<marker id="am-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="mk m" d="M0 1 L10 5 L0 9 z"/></marker></defs>` + this.p.join('') + '</svg>';
    }
  }
  // Parts drawn once for every model and once for each model alone: the pick at the top shows one or the other.
  const allOrOne = (all, one) => (many ? `<g class="when-all">${all}</g>${M.map((m) => `<g data-only="${esc(m.id)}" hidden>${one(m)}</g>`).join('')}` : all);
  const half = (a) => [a.slice(0, Math.ceil(a.length / 2)).join(' · '), a.slice(Math.ceil(a.length / 2)).join(' · ')].filter(Boolean);

  /* 1 · Big picture: every model in /model is a box of its own */
  const cols = many ? 2 : 1, gap = 14, mw = (290 - gap * (cols - 1)) / cols, mh = 112, mrows = Math.ceil(M.length / cols);
  const bgeY = 284 + mrows * (mh + gap) - gap + 30;
  const f1 = new Fig('f1', 1280, Math.max(560, bgeY + 80));
  {
    const f = f1;
    const speed = (m) => (m.read || m.write ? [`${m.read ? `reads ${m.read}` : ''}${m.read && m.write ? ' · ' : ''}${m.write ? `writes ${m.write}` : ''}`, 'tokens a second'] : ['speed not measured']);
    const mbox = (g, m, x, y, w) => g.box(x, y, w, mh, { k: `mdl${live(m) ? ' live' : ''}`, attr: `data-model="${esc(m.id)}"`, t: m.name, s: [{ t: m.tags.join(' · ') || 'in /model', k: live(m) ? 'live' : 'dim' }, `${m.fileGB} GB file`, ...speed(m)] });
    f.box(230, 6, 1030, 40, { k: 'ghost', t: `Test bench (models/evals): runs the terminal’s agent with no screen, on ${many ? 'each model in turn' : 'the model'}, and grades the result` });
    f.box(20, 110, 120, 72, { k: 'you', t: 'You', s: ['in Terminal, or via', 'Agentic Coder.app'] });
    f.box(20, 300, 120, 80, { t: 'coding', s: ['launcher: rebuilds', 'if the code changed'], mono: true });
    f.group(200, 64, 630, 370, 'PART 1 · THE TERMINAL  (terminal/)', 't1');
    f.box(216, 110, 120, 72, { k: 't1', t: 'Screen', s: ['Ink · keys', '/ commands'] });
    f.box(400, 110, 120, 72, { k: 't1', t: 'Sort & ask', s: ['rules first', 'then a question'], dot: true });
    f.box(596, 98, 218, 72, { k: 't1', t: 'Focused paths', s: ['rename · fix · change', 'several files'], dot: true });
    f.box(596, 196, 218, 72, { k: 't1', t: 'Step-by-step loop', s: ['send → run one tool →', 'result back → repeat'], dot: true });
    f.box(596, 318, 218, 72, { k: 't1', t: `${d.tools.length} tools`, s: half(d.tools) });
    f.box(216, 318, 304, 72, { k: 't1', t: 'Memory', s: ['facts about you and the project', 'saved after a task, found by meaning'], dot: true });
    f.box(596, 470, 218, 64, { k: 'you', t: 'Your project folder', s: ['the only place it works'] });
    f.group(930, 64, 330, bgeY + 68 - 64, 'PART 2 · THE MODELS  (models/)', 't2');
    f.box(950, 98, 290, 56, { k: 't2', t: 'models/index.mjs', s: ['the one door between the parts'], mono: true });
    f.box(950, 184, 290, 64, { k: 't2', t: 'llama-server', s: ['starts, shares and stops it;', many ? 'one model loaded at a time · /model swaps' : 'keeps the model loaded between requests'] });
    // The models: each one the same box. With one picked at the top, its box alone takes the row.
    const sub = (fn) => { const g = new Fig(f.id, 0, 0); fn(g); return g.p.join(''); };
    f.raw(allOrOne(
      sub((g) => M.forEach((m, i) => { const x = 950 + (i % cols) * (mw + gap), y = 284 + Math.floor(i / cols) * (mh + gap); mbox(g, m, x, y, mw); if (i < cols) g.arrow([[x + mw / 2, 248], [x + mw / 2, 284]], { m: true, ...(i === 0 ? { label: 'chat', lp: [x + mw / 2 + 8, 272], a: 'start' } : {}) }); })),
      (m) => sub((g) => { mbox(g, m, 950, 284, 290); g.arrow([[1095, 248], [1095, 284]], { m: true, label: 'chat', lp: [1103, 272], a: 'start' }); }),
    ));
    f.box(950, bgeY, 290, 50, { k: 't2', t: 'BGE-M3', s: ['finds memory facts and code by meaning'] });
    f.arrow([[1240, 216], [1250, 216], [1250, bgeY + 25], [1240, bgeY + 25]], { m: true, label: 'embeddings', lp: [1240, bgeY - 7], a: 'end' });
    f.arrow([[140, 136], [216, 136]], { label: 'prompt', lp: [178, 128] });
    f.arrow([[216, 158], [140, 158]], { label: 'answer', lp: [178, 173] });
    f.arrow([[336, 146], [400, 146]], { label: 'request', lp: [368, 138] });
    f.arrow([[520, 126], [596, 126]], { label: 'most', lp: [558, 118] });
    f.arrow([[490, 182], [490, 232], [596, 232]], { label: 'the rest', lp: [482, 208], a: 'end' });
    f.arrow([[705, 170], [705, 196]], { d: true, label: 'can’t finish', lp: [713, 187], a: 'start' });
    f.arrow([[705, 268], [705, 318]], { label: 'asks you first', lp: [713, 297], a: 'start' });
    f.arrow([[705, 390], [705, 470]], { both: true, label: 'reads · edits · runs', lp: [713, 448], a: 'start' });
    f.arrow([[276, 182], [276, 318]], { d: true, label: 'saves after a task', lp: [284, 256], a: 'start' });
    f.arrow([[430, 318], [430, 182]], { label: 'facts that fit', lp: [438, 290], a: 'start' });
    f.arrow([[814, 122], [950, 122]], { m: true, label: ['asks the', 'model; reply', 'streams back'], lp: [882, 84] });
    f.arrow([[814, 232], [880, 232], [880, 142], [950, 142]], { m: true });
    f.arrow([[1095, 154], [1095, 184]], { m: true });
    f.arrow([[140, 326], [200, 326]], { label: 'starts', lp: [170, 318] });
    f.arrow([[200, 356], [140, 356]], { d: true, label: '/update', lp: [170, 372] });
  }

  /* 2 · One request: the hub's one list of steps, the Harness tab's stages over them, and one real task on each model under them */
  const EX = d.example;
  const f2 = new Fig('f2', 1280, EX ? 322 + M.length * 54 : 300, 0);
  {
    const f = f2, n = STEPS.length, pitch = Math.floor(1156 / n), W = pitch - 17, X = (i) => 124 + i * pitch, at = (id) => STEPS.findIndex((s) => s.id === id);
    // The stages: each over the steps it is made of.
    STAGES.forEach((g) => { const ix = stepsOf(g.id).map((s) => STEPS.indexOf(s)); if (!ix.length) return; const x1 = X(Math.min(...ix)) + 4, x2 = X(Math.max(...ix)) + W - 4; f.raw(`<g class="stage"><path d="M${x1} 30 v-6 H${x2} v6"/><text x="${(x1 + x2) / 2}" y="16" text-anchor="middle">${esc(g.name)}</text></g>`); });
    STEPS.forEach((s, i) => f.box(X(i), 40, W, 92, { k: s.kind, t: `${i + 1} · ${s.name}`, s: s.lines, dot: s.model }));
    for (let i = 0; i < n - 1; i++) f.arrow([[X(i) + W, 86], [X(i + 1), 86]]);
    if (at('work') > at('ask') && at('ask') >= 0) f.arrow([[X(at('work')) + 60, 132], [X(at('work')) + 60, 166], [X(at('ask')) + W / 2, 166], [X(at('ask')) + W / 2, 132]], { d: true, label: 'the model can ask again mid-task', lp: [(X(at('work')) + 60 + X(at('ask')) + W / 2) / 2, 184] });
    if (at('check') > at('work') && at('work') >= 0) f.arrow([[X(at('check')) + W / 2, 132], [X(at('check')) + W / 2, 204], [X(at('work')) + 100, 204], [X(at('work')) + 100, 132]], { d: true, label: 'sent back once', lp: [(X(at('check')) + W / 2 + X(at('work')) + 100) / 2, 222] });
    if (EX) {
      f.text(20, 270, `A REAL REQUEST · TASK ${EX.n} OF THE ${T}${many ? ` ${two.toUpperCase()} RAN` : ''} ON ${runDay.toUpperCase()}`, { k: 'gl' });
      f.raw(`<text class="gq" x="1260" y="270" text-anchor="end"${f.fit(`“${EX.request}”`, 700, 6.6)}>${esc(`“${EX.request}”`)}</text>`);
      // What one model did at a step: two short lines, by the step's id.
      const cell = (m, s) => {
        const e = EX.models[m.id], [kind, how] = String(e.sorted).split(' · ');
        const okAsk = e.asked.find((a) => /^Before I change anything/.test(a.question)), first = e.asked.find((a) => a !== okAsk);
        const ch = e.changed.find((c) => !c.test) ?? e.changed[0], secs = e.tries.reduce((x, t) => x + t.secs, 0);
        return ({
          type: ['the same request', 'as it was typed'],
          sort: [`sorted as: ${kind || '—'}`, how === 'shortcut' ? 'takes the shortcut' : how ? `goes ${how}` : ''],
          ask: first ? ['asked you first:', first.question.slice(0, 40)] : ['skipped: the request', 'is clear enough'],
          recall: EX.memory ? ['facts that fit were', 'written into it'] : ['off in a test run, so', 'each run starts alike'],
          work: e.tries.length === 1 ? [`${e.tries[0].label} ${e.tries[0].marks}`, `${dur(secs)}, in a scratch copy`] : e.tries.length ? [`${e.tries.length} rounds of tries`, `${dur(secs)}, in a scratch copy`] : ['step by step', ''],
          check: [ch ? `your OK: ${ch.path}${ch.add == null ? '' : ` +${ch.add} −${ch.del}`}` : 'nothing to change', e.check ? `${e.check.cmd} ${e.check.ok ? 'passes' : 'fails'}` : 'no tests to run'],
          show: [`${e.pass ? 'passed' : 'failed'} in ${dur(e.secs)}`, `${e.calls} model ${e.calls === 1 ? 'call' : 'calls'}`],
        })[s.id] ?? ['', ''];
      };
      const rowOf = (g, m, y) => { g.box(20, y, 92, 46, { k: `mdl${live(m) ? ' live' : ''}`, attr: `data-model="${esc(m.id)}"`, t: short(m), s: [{ t: m.tags[0] ?? 'in /model', k: live(m) ? 'live' : 'dim' }] }); STEPS.forEach((s, i) => { const c = cell(m, s); g.box(X(i), y, W, 46, { k: 'ghost', s: [{ t: c[0], k: 'hi' }, ...(c[1] ? [c[1]] : [])] }); }); };
      const sub = (fn) => { const g = new Fig(f.id, 0, 0); fn(g); return g.p.join(''); };
      f.raw(allOrOne(sub((g) => M.forEach((m, r) => rowOf(g, m, 286 + r * 54))), (m) => sub((g) => rowOf(g, m, 286))));
    } else {
      f.text(20, 270, run ? `No task of the run of ${runDay} fits as an example here (one ${part ? 'each model in it' : 'every model'} passed on a focused path).` : `${noRun} One real request then shows here, step by step${many ? ' on each model' : ''}.`, { k: 's' });
    }
  }

  /* 3 · Sorting */
  const f2b = new Fig('f2b', 1280, 500);
  {
    const f = f2b, dy = (i) => 20 + i * 68;
    const dest = [
      ['Short reply, no tools', 'thanks · praise · “I need help with something”'],
      ['Carries on the last turn', 'a short line that continues it: “why”, “can you add it to my desktop?”'],
      ['Question', 'answered from code already read; Edit and Write are turned away'],
      ['Rename', 'every whole-word use, one diff, one question · no model'],
      ['Fix · Change · Several files', 'the focused paths (tab 5)'],
      ['Step by step (the loop)', 'plain commands (“run the tests”, “commit and push”), a page or file with no code named'],
      ['Ask first', 'a bare “fix the bug” with nothing failing, or a lone word like “api” → a question before anything runs'],
    ];
    dest.forEach(([t, s], i) => f.box(660, dy(i), 600, 56, { k: i === 5 ? 't1' : i === 6 ? 'ghost' : '', t, s }));
    f.box(20, 200, 150, 64, { k: 'you', t: 'Your request' });
    f.box(250, 200, 190, 64, { k: 't1', t: 'Rules first', s: ['words and shortcuts', '101 test requests guard them'] });
    f.box(250, 340, 190, 64, { k: 't1', t: 'The model', s: ['a forced-JSON reply,', 'only when no rule fits'], dot: true });
    f.arrow([[170, 232], [250, 232]]);
    f.arrow([[345, 264], [345, 340]], { label: 'no rule fits', lp: [353, 306], a: 'start' });
    f.arrow([[440, 232], [600, 232]], { line: true, label: 'a rule fits', lp: [520, 224] });
    f.arrow([[440, 372], [600, 372], [600, 232]], { line: true });
    f.raw(`<path class="ar" d="M600 48 L600 ${dy(6) + 28}"/>`);
    dest.forEach((_, i) => f.arrow([[600, dy(i) + 28], [660, dy(i) + 28]]));
    let y = 414;
    if (M.some((m) => m.sort)) {
      f.text(20, 426, 'SORTING CHECK', { k: 'gl' });
      y = f.twin(230, 414, 230, (m) => (m.sort ? `${m.sort.right} of ${m.sort.total} sorted right` : 'not run yet'), { best: bestOf('high', (m) => m.sort?.right) });
    }
    if (many && d.samePath != null) f.text(20, Math.min(490, Math.max(478, y + 24)), d.samePath === T ? `In the run of ${runDay}, ${two} went down the same path on all ${T} tasks.` : `In the run of ${runDay}, the models took the same path on ${d.samePath} of the ${T} tasks.`, { k: 's' });
  }

  /* 4 · The loop */
  const f3 = new Fig('f3', 1280, 560, 34);
  {
    const f = f3;
    f.box(20, 50, 230, 72, { k: 't1', t: 'Send', s: ['conversation + tool list +', 'recalled facts → model'], dot: true });
    f.box(310, 50, 230, 72, { k: 't1', t: 'Stream the reply', s: ['thinking, text or a tool call,', 'shown live on the Screen'] });
    f.box(600, 50, 230, 72, { k: 't1', t: 'Wants a tool?', s: ['one tool at a time,', `up to ${S.steps} steps a request`] });
    f.box(890, 50, 230, 72, { k: 'you', t: 'Final answer', s: ['then the check before', '“done” (step 6, tab 2)'] });
    f.box(600, 210, 230, 72, { k: 't1', t: 'Permission gate', s: ['edit or command: Yes · Yes for', 'this session · No, and say what'] });
    f.box(310, 210, 230, 72, { k: 't1', t: 'Run the tool', s: half(d.tools) });
    f.box(20, 210, 230, 72, { k: 't1', t: 'Result comes back', s: ['folded on screen (ctrl+o opens it)', 'and added to the conversation'] });
    f.box(600, 340, 230, 84, { k: 'bad', t: 'Refused', s: ['rm -rf · sudo · git push · reset --hard', 'kill · pipe-to-shell · outside project'] });
    f.arrow([[250, 86], [310, 86]], { m: true, label: 'streams', lp: [280, 78] });
    f.arrow([[540, 86], [600, 86]]);
    f.arrow([[830, 86], [890, 86]], { label: 'no', lp: [860, 78] });
    f.arrow([[715, 122], [715, 210]], { label: 'yes', lp: [723, 170], a: 'start' });
    f.arrow([[600, 246], [540, 246]], { label: 'allowed', lp: [570, 238] });
    f.arrow([[310, 246], [250, 246]]);
    f.arrow([[135, 210], [135, 122]], { d: true, label: 'next step', lp: [143, 170], a: 'start' });
    f.arrow([[715, 282], [715, 340]], { label: 'blocked', lp: [723, 316], a: 'start' });
    f.arrow([[600, 382], [135, 382], [135, 282]], { d: true, label: 'the refusal comes back as the result', lp: [370, 374] });
    if (M.some((m) => m.write) && twinH <= 76) f.twin(310, 128, 230, (m) => (m.write ? `writes ${m.write} tokens a second` : 'not measured'), { best: bestOf('high', (m) => m.write) });
    f.group(880, 170, 380, 250, 'GUARDS INSIDE THE LOOP', 't1');
    f.text(898, 214, ['Repeated steps and looping output are stopped.', 'A tool call written as text, or inside the', 'thinking, is caught and run properly.', '“Announce, then stop” gets a nudge to act.', 'An edit that would break a file that parsed', 'before is refused.', 'Edits match despite indent slips and one-', 'character typos (one clear place only).', 'Read: small files whole; long ones as an', 'outline plus the lines that match.', 'A question changes nothing; commands run in', 'a throwaway copy of the project.']);
    f.group(20, 450, 800, 100, 'WHEN THE CONVERSATION FILLS THE MEMORY', '');
    f.box(36, 484, 230, 52, { t: 'Nearly full', s: ['from 70% a line says so'] });
    f.box(306, 484, 230, 52, { k: 't1', t: 'The model writes its notes', s: ['inside the conversation it holds'], dot: true });
    f.box(576, 484, 230, 52, { k: 't1', t: 'Carries on', s: ['from request + notes + files list'] });
    f.arrow([[266, 510], [306, 510]]);
    f.arrow([[536, 510], [576, 510]]);
  }

  /* 5 · Focused paths: each lane says how every model did on it */
  const laneH = P ? Math.max(76, 46 + twinH + 8) : 76, lanePitch = laneH + 12;
  const f4 = new Fig('f4', 1280, 28 + 5 * lanePitch + 4, 16);
  {
    const f = f4;
    const lanes = [
      ['Rename', 'e.g. “rename test to check”', 'rename', [['Find every use', ['whole word, in code', 'no model'], false], ['One diff', ['all the places at once'], false], ['One question', ['you say yes or no'], false]]],
      ['Fix', 'the tests fail', 'fix', [['Run the tests', ['see what fails'], false], ['Find the file', ['where the failure lives'], false], ['3 focused tries', ['on one function, in a', 'scratch copy; each told', 'what the last got wrong'], true], ['3 wider tries', ['as edit blocks'], true]]],
      ['Fix, check first', 'a page bug tests miss', null, [['Open the page', ['project’s own browser', '(Playwright)'], false], ['What covers what', ['model picks the steps;', 'browser finds the layers'], true], ['Check fails today', ['you approve it;', 'it stays in the project'], false], ['Tries scored by it', ['hiding the thing', 'doesn’t pass'], true]]],
      ['Change', 'add or change something', 'change', [['Test first', ['2 tests, 2 drafts, cross-', 'checked; you approve'], true], ['Tries', [`up to ${S.tries}, in a scratch copy`], true], ['Apply', ['the test passes'], false]]],
      ['Several files', 'a change that spans files', 'multi', [['Plan the files', ['from the project map'], true], ['One test', ['for the whole change'], false], ['Edit blocks', ['across all the files'], true], ['Guards', ['only planned files change;', 'nothing quietly removed'], false]]],
    ];
    const val = (p) => (m) => { if (!p) return 'counted under Fix'; const r = p.models[m.id]; return !r.n ? 'none in this run' : p.id === 'rename' ? `${r.passed} of ${r.n} · no model` : `${r.passed} of ${r.n} · ${took(r.secs)}`; };
    const stepY = (laneH - 64) / 2;
    lanes.forEach(([name, when, pid, steps], r) => {
      const y = 28 + r * lanePitch, p = P && pid ? P[pid] : null, cnt = p ? countOf(p) : null;
      f.raw(`<g class="node t1"><rect x="20" y="${y}" width="212" height="${laneH}" rx="9"/><text class="h" x="32" y="${y + (P ? 19 : laneH / 2 - 3)}">${esc(name)}${cnt ? `<tspan class="cn"> · ${cnt} of the ${T} tasks</tspan>` : ''}</text><text class="s" x="32" y="${y + (P ? 34 : laneH / 2 + 13)}">${esc(when)}</text></g>`);
      if (P) f.twin(30, y + 44, 192, val(p), { best: p && pid !== 'rename' ? betterOn(p) : null });
      steps.forEach(([t, s, dot], c) => f.box(264 + c * 182, y + stepY, 156, 64, { t, s, dot }));
      f.arrow([[232, y + laneH / 2], [264, y + laneH / 2]]);
      for (let c = 0; c < steps.length - 1; c++) f.arrow([[420 + c * 182, y + laneH / 2], [446 + c * 182, y + laneH / 2]]);
      const lastX = 264 + (steps.length - 1) * 182 + 156;
      f.arrow([[lastX, y + laneH / 2], [1096, y + laneH / 2]], { d: true, ...(r === 0 ? { label: 'can’t finish →', lp: [(lastX + 1096) / 2, y + laneH / 2 - 8] } : {}) });
    });
    const boxH = 5 * lanePitch - 12, mid = 28 + boxH / 2;
    f.box(1096, 28, 164, boxH, { k: 't1' });
    if (P) {
      const L = P.loop, from = ['fix', 'change', 'multi'].map((id) => P[id]), cnt = countOf(L);
      const top = mid - (84 + 2 * twinH + 76) / 2;
      f.text(1178, top + 12, 'Step by step', { a: 'middle', k: 'h' });
      f.text(1178, top + 30, ['the loop (tab 4)', 'anything a focused', 'path can’t finish', 'goes here'], { a: 'middle', lh: 14 });
      f.text(1178, top + 106, `sorted straight here${cnt ? ` · ${cnt}` : ''}`, { a: 'middle', k: 's dim' });
      const y2 = f.twin(1103, top + 114, 150, (m) => (L.models[m.id].n ? `${L.models[m.id].passed} of ${L.models[m.id].n} · ${took(L.models[m.id].secs)}` : 'none in this run'), { best: betterOn(L) });
      f.text(1178, y2 + 26, 'came here from a path', { a: 'middle', k: 's dim' });
      f.twin(1103, y2 + 34, 150, (m) => `${from.reduce((x, p) => x + p.models[m.id].thenLoop, 0)} of ${from.reduce((x, p) => x + p.models[m.id].n, 0)} tasks`);
    } else {
      f.text(1178, mid - 30, 'Step by step', { a: 'middle', k: 'h' });
      f.text(1178, mid - 12, ['the loop (tab 4)', 'anything a focused', 'path can’t finish', 'goes here', '--no-flows always', 'starts here'], { a: 'middle', lh: 14 });
    }
  }

  /* 6 · Memory */
  const f5 = new Fig('f5', 1280, 545, 30);
  {
    const f = f5;
    f.text(20, 88, 'SAVE', { k: 'gl' }); f.text(20, 268, 'STORE', { k: 'gl' }); f.text(20, 434, 'BRING BACK', { k: 'gl' });
    f.box(200, 50, 210, 80, { t: 'A task ends', s: ['or you quit, or you say', '“remember that …”'] });
    f.box(470, 50, 220, 80, { k: 't1', t: 'Pick up to 5 facts', s: ['in the background, on the', 'side slot; stops if you type'], dot: true });
    f.box(750, 50, 270, 80, { k: 'bad', t: 'Refuse the bad ones', s: ['not borne out by the turns,', 'names a file that isn’t there,', 'looks like a key or password'] });
    f.arrow([[410, 90], [470, 90]]); f.arrow([[690, 90], [750, 90]]);
    f.group(200, 190, 840, 132, 'MEMORY STORE  ·  one small file per fact, an index, a retired/ folder, a log', 't1');
    f.box(220, 226, 240, 80, { k: 'ghost', t: 'Claude Code’s notes', s: ['read where they are,', 'never changed'] });
    f.box(486, 226, 260, 80, { k: 't1', t: 'About you', s: ['~/.agentic/memory', 'follows you into every project'] });
    f.box(772, 226, 250, 80, { k: 't1', t: 'About the project', s: ['<project>/.agentic/memory', 'kept out of git'] });
    f.arrow([[885, 130], [885, 190]], { label: 'facts', lp: [893, 164], a: 'start' });
    f.box(1080, 226, 180, 80, { k: 'ghost', t: 'Once a day', s: ['repeats merge; unused', '30 days → retired/'] });
    f.arrow([[1080, 266], [1040, 266]], { d: true });
    f.box(200, 388, 200, 84, { t: 'At every start', s: ['“always” rules and one', 'line per fact are read'] });
    f.box(450, 388, 240, 84, { k: 't1', t: 'With a request', s: ['facts that fit are found by', 'meaning (BGE-M3) or by', 'shared words'] });
    f.box(740, 388, 240, 84, { k: 't1', t: 'Written into the request', s: ['so nothing already read', 'is read again'] });
    f.box(1030, 388, 230, 84, { t: 'The result decides', s: ['passed +1 · failed/stuck −1', 'you corrected −2; at −3', 'the fact is taken out of use'] });
    f.arrow([[300, 322], [300, 388]], { label: 'read', lp: [308, 360], a: 'start' });
    f.arrow([[570, 322], [570, 388]], { label: 'fits', lp: [578, 360], a: 'start' });
    f.arrow([[400, 430], [450, 430]]); f.arrow([[690, 430], [740, 430]]); f.arrow([[980, 430], [1030, 430]]);
    f.arrow([[1130, 388], [1130, 322], [1040, 322]], { d: true, label: 'score', lp: [1138, 355], a: 'start' });
    f.text(20, 520, [`The memory belongs to the terminal, not to a model: ${many ? `${list(M.map(short))} read the same facts` : 'a model swapped in reads the same facts'}. Nothing is ever deleted: taken-out facts go to retired/.`, 'When a window closes the conversation is read again, and what is new is asked about at the next start; coding memory-review does the same at night, only if you schedule it.'], { k: 's' });
  }

  /* 7 · Test bench */
  const benchMore = run ? Math.max(0, twinH - 37) : 0;
  const f6 = new Fig('f6', 1280, 392 + benchMore, 40);
  {
    const f = f6, gy = 242 + benchMore;
    f.box(20, 60, 170, 90, { k: 'ghost', t: 'A practice task', s: ['28 of them: questions,', 'renames, fixes, features,', 'a real-sized project'] });
    f.box(240, 60, 170, 90, { t: 'Throwaway copy', s: ['of the project; the', 'real one is never touched'] });
    f.box(460, 60, 190, 90, { k: 't2', t: 'Own llama-server', s: ['starts with the model', 'under test'] });
    f.box(700, 60, 200, 90, { k: 't1', t: 'The agent, no screen', s: ['runs the task headless;', 'everything auto-approved;', 'questions get scripted answers'], dot: true });
    f.box(945, 60, 145, 90, { t: 'The check', s: ['each task has one;', 'passes or fails'] });
    f.box(1140, 60, 120, 90, { k: 'you', t: 'Report page', s: ['written to', 'the repo\'s', 'docs/'] });
    [[190, 240], [410, 460], [650, 700], [900, 945], [1090, 1140]].forEach(([a, b]) => f.arrow([[a, 105], [b, 105]]));
    if (run) {
      f.text(20, 176, many ? `NEWEST RUN ${runWho.toUpperCase()} DID` : 'THE NEWEST RUN', { k: 'gl' });
      f.text(20, 193, `${run.name}, ${runDay}`, { k: 's' });
      f.twin(945, 162, 315, (m) => (m.run ? `${m.run.passed} of ${T} passed · ${mins(m.run.secs)}` : 'not run yet'), { best: bestOf('high', (m) => m.run?.passed) });
      f.text(240, 193, 'Each check is proven first: it must fail on the untouched project and pass with the reference answer.', { k: 's' });
    } else {
      f.text(20, 186, 'Each check is proven first: it must fail on the untouched project and pass with the reference answer.', { k: 's' });
      f.text(20, 204, noRun, { k: 's' });
    }
    f.group(20, gy, 1240, 130, 'OTHER RUNS USE THE SAME RUNNER', '');
    f.box(40, gy + 36, 280, 76, { t: '28 real requests', s: ['trigger words and blocked commands,', 'in three kinds of folder'] });
    f.box(350, gy + 36, 280, 76, { t: 'Speed · soak · re-read', s: ['engine settings, long conversations,', 'cold starts, what is read again'] });
    f.box(660, gy + 36, 280, 76, { t: 'Overnight run', s: ['all of the above,', 'with a morning report'] });
    f.box(970, gy + 36, 270, 76, { k: 'ghost', t: 'One model at a time', s: ['a 16 GB Mac fits one,', 'so runs wait for each other'] });
  }

  /* 8 · Where it lives */
  const where = `<div class="cols">
 <div class="card"><h3>In the repo <code>~/Desktop/agentic-coder</code></h3>
<pre>agentic-coder/
├─ <b>terminal/</b>            part 1 · the agent you talk to
│  ├─ src/               cli · app (screen) · agent (loop) · flows · tools · ui · morning
│  ├─ test/  scripts/   unit tests, keys-in-a-real-terminal tests, report builders
│  └─ app/               Agentic Coder.app launcher, the <code>coding</code> script, icon
├─ <b>models/</b>              part 2 · the models and the bench
│  ├─ index.mjs          the one door
│  ├─ runtime/           llama-server, memory fit, warm-up, setup
${M.map((m) => `│  ├─ ${esc(`${d.folders[m.id]}/`.padEnd(19))}<em>${esc(m.name)}</em>${m.tags.length ? ` · ${m.tags.join(' · ')}` : ''}`).join('\n')}
│  ├─ bge-m3/            finds memory facts by meaning
│  └─ evals/             the test bench
├─ <b>docs/</b>                every diagram, report and test page · private/ stays on this Mac
└─ Agentic Coder.app     double-click: pick a folder, opens Terminal running coding</pre></div>
 <div class="card"><h3>On this Mac, outside the repo</h3>
<pre><b>~/.local/bin/coding</b>          the launcher you type
<b>~/.agentic-coder/</b>
├─ app/agentic-coder     the built one-file app
├─ models/  engine/      model files and the llama.cpp engine
├─ sessions/  history    saved conversations
├─ tests/record.jsonl    every test run: the numbers on this tab
├─ maps/                 project maps
├─ logs/  servers/       update log, running servers
└─ settings.json  trust.json
<b>~/.agentic/memory</b>         what it remembers about you
<b>&lt;project&gt;/.agentic/memory</b>  what it remembers about a project</pre>
 <p class="note">Model files are downloaded once with <code>coding setup</code>. Nothing here is sent anywhere: the model runs on this Mac. A model added to the list in <code>models/</code> shows up on this tab by itself.</p></div>
</div>`;

  const legend = `<p class="legend"><span><i class="dotm"></i>can call the model</span><span><i class="ln m"></i>talks to the model</span><span><i class="ln dash"></i>falls back, repeats or comes back</span><span><i class="twk"></i>${many ? 'a number for each model' : 'the model’s own number'}, from your runs${many ? '<span class="when-all">; bold = better</span>' : ''}</span></p>`;
  const cap = (s) => `<p class="cap">${esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`;
  const fig = (f, aria) => `<figure>${f.render(aria)}</figure>`;
  const ownBox = many ? `<b>${sw('Every model in /model has its own box', '{name} is the model drawn here')}</b><span class="when-all">; one is loaded at a time</span>.` : 'The model is the box on the right.';
  const TABS = [
    ['big', 'Big picture', 'Two parts joined by one door', `You type in a terminal. The terminal decides how to do the job and calls the model only when it has to. ${ownBox}`,
      fig(f1, `Agentic Coder: you talk to the terminal (part 1); the terminal reaches a local model only through models/index.mjs (part 2): ${M.map((m) => m.name).join(' or ')}${many ? ', one loaded at a time' : ''}.`) + legend + cap('The terminal never reads a model’s settings directly; it goes through one file, models/index.mjs. `/update` exits the app with code 75, and the launcher rebuilds and restarts it in the same window.')],
    ['req', 'One request', 'What happens to one request', `${STEPS.length} steps from your Enter key to “done”. The line over them is the Harness tab’s ${STAGES.length}: ${esc(stagesInWords())}.${EX ? ` Under them, <b>${many ? sw('the same real request on each model', 'one real request on {name}') : 'one real request'}</b>, step for step.` : ''}`,
      fig(f2, `The ${STEPS.length} steps a request takes, the ${STAGES.length} stages they group into${EX ? ', and one real task on each model under them' : ''}.`) + legend + cap(`Only some steps use the model (amber dot).${EX ? ` The ${many ? 'rows are' : 'row is'} task ${EX.n} of the newest run ${many ? `${runWho} did` : 'it did'}: what ${many ? 'each model' : 'it'} really did at each step.` : ''}`)],
    ['sort', 'Sorting', 'Step 2 in detail: where a request goes', 'Rules look at your words first. The model is asked only when no rule fits.',
      fig(f2b, 'Sorting: rules decide first; the model decides only when no rule fits; seven possible destinations; the sorting check for each model.') + legend + cap('Under your request a dim line says where it went, for example Sorted as: change · shortcut. A rule change that moves any of the 101 test requests to another path fails the sort test.')],
    ['loop', 'The loop', 'The step-by-step loop', 'When no shortcut fits, the model works one tool at a time, and you approve each edit or command.',
      fig(f3, 'The agent loop: send, stream, permission gate, run one tool, result back, repeat; guards and the memory-full path.') + legend + cap('Built for small local models: one tool at a time, plain-text reads, edits that forgive small slips. Always blocked in every mode: rm -rf, sudo, git push, git reset --hard, git clean -f, kill, stopping services, piping the internet into a shell.')],
    ['paths', 'Focused paths', 'Focused paths: fixed recipes for common jobs', `A recipe leaves the small model less to guess.${P ? ` <b>${many ? sw('Each lane says how every model did on it', 'Each lane says how {name} did on it') : 'Each lane says how the model did on it'}</b>: tasks passed and the time they took.` : ' Anything a recipe can’t finish drops to the loop.'}`,
      fig(f4, `Five focused paths, each a short chain of steps that falls back to the step-by-step loop${P ? ', with how each model did on it' : ''}.`) + legend + cap(`Tries happen in a scratch copy of the project, not in your own files.${P ? ` The numbers: ${runLine}.` : ` ${run ? 'The newest run is from before the paths were kept: run it again to see how each model did on each lane.' : noRun}`}`)],
    ['mem', 'Memory', 'Memory: the model stays the same, what it knows changes', 'Facts about you and each project are saved after tasks, brought back when they fit, and scored by how the next task went.',
      fig(f5, 'Memory lifecycle: save up to five facts after a task, keep them in two stores, bring back the ones that fit, score them by the result. The same for every model.') + legend + cap('Turn it off with `"memory": false` in settings.json, or stop only the auto-saving with `AGENTIC_MEMORY_SAVE=off`. `/memory` shows both memories; `/memory undo` takes the last save back.')],
    ['bench', 'Test bench', 'The test bench: how a model gets graded', `The same agent, run with no screen, on throwaway copies, then checked.${many ? ' Every model is graded the same way.' : ''}`,
      fig(f6, `Test bench: practice task, throwaway copy, own llama-server, headless agent, check, report page; the newest run ${many ? `${runWho} did` : 'it did'}.`) + legend + cap(`A new model is tested the same way: \`node models/evals/bench/run.mjs --model <id>\`. The numbers on this tab come from the newest test ${many ? 'every model ran with the same settings' : 'the model ran'}.`)],
    ['where', 'Where it lives', 'Where things live', 'The code is in one repo; what the app builds and remembers is in two hidden folders in your home.', where],
  ];
  // The models' names: with more than one, each is a button that draws the flow with that model alone, beside one that brings them all back.
  const chips = many
    ? `<span class="chips" role="group" aria-label="Draw the flow with"><button type="button" class="chip" data-pick="" aria-pressed="true">${M.length === 2 ? 'Both' : `All ${M.length}`}</button>${M.map((m) => `<button type="button" class="chip" data-pick="${esc(m.id)}" data-name="${esc(m.name)}" data-short="${esc(short(m))}" aria-pressed="false"><i class="dot"></i>${esc(m.name)}${tags(m)}</button>`).join('')}</span>`
    : `<span class="chips">${M.map((m) => `<span class="chip"><i class="dot"></i>${esc(m.name)}${tags(m)}</span>`).join('')}</span>`;
  const body = `<div class="top"><h1>Agentic Coder: how it works</h1><span class="dateline">${many ? sw('a coding agent in your terminal, running a model on this Mac', 'a coding agent in your terminal, with {name} as the model') : 'a coding agent in your terminal, running a model on this Mac'}${dated ? ` · saved ${esc(dated)}` : ''}</span><span class="grow"></span>${chips}</div>
  <nav role="tablist">${TABS.map(([id, name], i) => `<button role="tab" data-v="${id}" aria-selected="${i === 0}">${i + 1} · ${name}</button>`).join('')}</nav>
  ${TABS.map(([id, , h2, lead, html], i) => `<section class="view" data-v="${id}"${i ? ' hidden' : ''}><h2>${h2}</h2><p class="lead">${lead}</p>${html}</section>`).join('\n')}`;
  return shell.replace('<!--flow-->', () => body);
}

const noStore = { 'cache-control': 'no-store' };
export function flowRoute(url, cwd) {
  if (url.pathname === '/flow.json') return Response.json(flowData(cwd), { headers: noStore });
  if (url.pathname === '/flow') return new Response(flowPage(flowData(cwd)), { headers: { 'content-type': 'text/html; charset=utf-8', ...noStore } });
  return null;
}
