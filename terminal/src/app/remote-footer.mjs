// The footer on a remote model: design 2 of docs/design rounds/remote-footer-2-designs-2026-10-02.html
// (the owner's pick, 2 Oct 2026: "build 2"). The Mac's memory leaves the footer, since the Mac
// holds no model then, and the cost meter moves to /meters. Once the first answer has a speed,
// the left side, which only said "? for shortcuts" by then, becomes gauges: the speed with the
// last 8 answers drawn small, the time to the first token, the context, and the share of the
// model in the service's GPU memory (Ollama's /api/ps; under 100% the rest runs on the CPU). The
// right keeps the model, where it runs and the mode.
// A narrow window drops, in this order: the "(shift+tab to cycle)" hint, where it runs, the
// first-token time, "of 128k", the small chart, the bars' length, the bars, then the gauges from
// the end of the list (settings.json "footer": { "remote": [...] }); while the model spills onto
// the CPU, GPU goes last of all. Pure: screen.jsx draws what this returns, and the tests read it.
import { ctxWord, gbWord } from './remote-models.mjs';

const GAUGES = ['speed', 'ttft', 'ctx', 'gpu'];

// The gauges to show, in their order: settings.json footer.remote, else all four. A name not
// known is skipped; an empty list shows none ("? for shortcuts" stays).
export function gaugesOf(setting) {
  if (!Array.isArray(setting)) return GAUGES;
  return [...new Set(setting.map((x) => String(x).toLowerCase()))].filter((x) => GAUGES.includes(x));
}

// A piece of the line: its text and its tone (screen.jsx gives each tone its colour):
// dim, value (white), live (the app's blue, while it writes), bar, warn, bad.
const t = (text, tone = 'dim') => ({ text, tone });
export const widthOf = (segs) => segs.reduce((n, s) => n + s.text.length, 0);
export const textOf = (segs) => segs.map((s) => s.text).join('');

const SPARK = '▁▂▃▄▅▆▇█';
// The last 8 speeds as a small chart, scaled from a little under the slowest so small changes show.
export function spark(speeds) {
  const h = speeds.slice(-8);
  if (!h.length) return '';
  const max = Math.max(...h);
  const lo = Math.min(...h) * 0.6;
  return h.map((v) => SPARK[Math.max(0, Math.min(7, Math.round(((v - lo) / Math.max(1, max - lo)) * 7)))]).join('');
}
export const bar = (frac, n) => {
  const k = Math.min(n, Math.max(frac > 0 ? 1 : 0, Math.round(frac * n)));
  return '▰'.repeat(k) + '▱'.repeat(n - k);
};
// Amber at 70% of the context and red at 85%: the points of the memory warning (screen.jsx).
const ctxTone = (pct, fine) => (pct >= 85 ? 'bad' : pct >= 70 ? 'warn' : fine);
export const ctxPct = (g) => (g.ctx ? Math.min(100, Math.max(1, Math.round((g.ctxUsed / g.ctx) * 100))) : 0);
export const spills = (g) => g?.gpuPct != null && g.gpuPct < 100;

// One gauge as pieces, or [] when it has nothing to show yet.
// g: { tps, live, speeds, ttft, ctxUsed, ctx, gpuPct }; drop: the details left out.
function gauge(id, g, drop) {
  const n = drop.has('short') ? 4 : 8;
  if (id === 'speed') {
    if (!g.tps) return [];
    const chart = drop.has('spark') ? '' : spark(g.speeds ?? []);
    return [t('↓'), t(String(Math.round(g.tps)), g.live ? 'live' : 'value'), t(' tok/s'), ...(chart ? [t(' '), t(chart, spills(g) ? 'warn' : 'bar')] : [])];
  }
  if (id === 'ttft') return g.ttft ? [t(`${g.ttft.toFixed(1)} s`, 'value'), t(' to first')] : [];
  if (id === 'ctx') {
    if (!g.ctx) return [];
    const pct = ctxPct(g);
    return [t('ctx '), ...(drop.has('bars') ? [] : [t(bar(pct / 100, n), ctxTone(pct, 'bar')), t(' ')]), t(`${pct}%`, ctxTone(pct, 'value')), ...(drop.has('ctxOf') ? [] : [t(` of ${ctxWord(g.ctx)}`)])];
  }
  if (id === 'gpu') {
    if (g.gpuPct == null) return [];
    const k = Math.round((g.gpuPct / 100) * n);
    // In a spill the bar's amber end is the share running on the CPU.
    const cells = drop.has('bars') ? [] : [t('▰'.repeat(k), 'bar'), ...(n - k ? [t('▰'.repeat(n - k), 'warn')] : []), t(' ')];
    return [t('GPU '), ...cells, t(`${g.gpuPct}%`, spills(g) ? 'warn' : 'value'), ...(spills(g) && !drop.has('short') ? [t(' rest on CPU', 'warn')] : [])];
  }
  return [];
}

// The gauges side by side, two spaces apart.
export function gaugeLine(g, list = GAUGES, drop = new Set()) {
  return list.filter((id) => !drop.has(id)).map((id) => gauge(id, g, drop)).filter((x) => x.length).flatMap((x, i) => (i ? [t('  '), ...x] : x));
}

// What a narrow window leaves out, first to last (see the top of this file).
export function dropOrder(list = GAUGES, spill = false) {
  const fromEnd = [...list].reverse().filter((id) => id !== 'ttft');
  const ends = spill && fromEnd.includes('gpu') ? [...fromEnd.filter((id) => id !== 'gpu'), 'gpu'] : fromEnd;
  return ['cycle', 'where', 'ttft', 'ctxOf', 'spark', 'short', 'bars', ...ends, 'label'];
}

// The row laid out in `avail` cells (the window less its margins). right({ where, cycle, bare })
// gives the right side's text for a try (bare: the shortest label). The first try whose two
// sides fit with two cells between them wins; past the last, the gauges are cut.
export function fitRemote({ avail, g, list = GAUGES, right }) {
  const order = dropOrder(list, spills(g));
  let out = null;
  for (let k = 0; k <= order.length; k++) {
    const drop = new Set(order.slice(0, k));
    const opts = { where: !drop.has('where'), cycle: !drop.has('cycle'), bare: drop.has('label') };
    const r = right(opts);
    const gauges = gaugeLine(g, list, drop);
    out = { ...opts, right: r, gauges };
    if (widthOf(gauges) + (gauges.length ? 2 : 0) + r.length <= avail) return out;
  }
  return { ...out, gauges: cutSegs(out.gauges, Math.max(0, avail - out.right.length - 2)) };
}

// Cut to n cells, ending in … as Ink's truncate-end does.
function cutSegs(segs, n) {
  if (widthOf(segs) <= n) return segs;
  if (n <= 0) return [];
  const out = [];
  let left = n - 1;
  for (const s of segs) {
    if (s.text.length <= left) { out.push(s); left -= s.text.length; continue; }
    if (left > 0) out.push({ ...s, text: s.text.slice(0, left) });
    break;
  }
  return [...out, t('…')];
}

// /meters on a remote: the words after the speed and the context, in place of this Mac's RAM.
// server: Ollama's /api/ps for the model ({ loaded, ms, size, vram, gpuPct, until }), or null.
// pps: the reading speed; spend: the cost meter's words (spend.mjs), '' when free.
export function meterWords({ g = null, pps = null, server = null, spend = '', now = Date.now() } = {}) {
  const out = [];
  if (g?.tps) out.push(`↓${Math.round(g.tps)}${pps ? ` ↑${pps >= 1000 ? `${(pps / 1000).toFixed(1)}k` : Math.round(pps)}` : ''} tok/s`);
  if (g?.ttft) out.push(`1st token ${g.ttft.toFixed(1)} s`);
  if (server?.loaded && server.size) {
    const left = server.until ? Date.parse(server.until) - now : NaN;
    const stay = !Number.isFinite(left) ? '' : left > 86_400_000 ? ' · kept loaded' : left > 0 ? ` · unloads in ${Math.max(1, Math.round(left / 60_000))} min` : '';
    out.push(`GPU ${server.vram != null ? `${(server.vram / 1e9).toFixed(1)}/` : ''}${gbWord(server.size)}${stay}`);
  }
  if (spend) out.push(spend);
  if (server?.ms != null) out.push(`ping ${server.ms} ms`);
  return out;
}
