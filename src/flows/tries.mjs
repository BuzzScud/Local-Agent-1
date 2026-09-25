// Tries until one passes: ask the model for a new version, put it in the
// scratch copy, check it, keep the first that passes (at most `max`). The
// screen shows each try as it happens: ✗ ✗ ✓.
import { complete, extractCode } from './llm.mjs';
import { syntaxError } from '../agent/tools.mjs';

export async function tryUntilPass(ctx, { label, max, want = 1, system, prompt, apply, check, temperature = 0.7, maxTokens = 2500 }) {
  let passes = 0;
  let first = null;
  let last = null; // the latest wrong try and why, shown to the next one
  const marks = [];
  const t0 = Date.now();
  let best = null;
  const show = (tokens = 0) => ctx.emit('tries', { label, n: marks.length + 1, max, marks: [...marks], tokens });
  for (let i = 1; i <= max; i++) {
    if (ctx.signal?.aborted) break;
    show();
    // Earlier failures go into the next prompt, so tries learn a little.
    const p = typeof prompt === 'function' ? prompt({ attempt: i, best, last }) : prompt;
    // First try careful; later tries a little bolder each time, so they differ.
    const temp = i === 1 ? Math.min(temperature, 0.3) : Math.min(1, temperature + 0.05 * (i - 2));
    let r;
    try {
      r = await complete({ url: ctx.url, model: ctx.model, slot: ctx.slot, system, user: p, temperature: temp, maxTokens, signal: ctx.signal, onToken: (n) => show(n) });
    } catch (e) {
      if (ctx.signal?.aborted) break;
      throw e;
    }
    const code = extractCode(r.text);
    if (process.env.BONSAI_DEBUG_TRIES) (await import('node:fs')).appendFileSync(process.env.BONSAI_DEBUG_TRIES, `\n===== ${label} #${i}\n${r.text}\n`);
    if (!code) { marks.push('✗'); continue; }
    const applied = apply(code);
    if (applied?.error) { marks.push('✗'); applied.undo?.(); if (!best) best = { code, why: applied.error }; continue; }
    const broken = applied.files?.map((f) => syntaxError(f.abs, f.text)).find(Boolean);
    if (broken) { marks.push('✗'); applied.undo?.(); if (!best) best = { code, why: `does not parse: ${broken}` }; continue; }
    const res = await check(applied);
    if (res.ok) {
      marks.push('✓');
      passes++;
      first ??= { ok: true, code, attempt: i, res, marks, applied };
      ctx.emit('tries', { label, n: i, max, marks: [...marks], tokens: 0 });
      if (passes >= want) {
        ctx.emit('tries-done', { label, marks, summary: want > 1 ? `${passes} good` : res.summary ?? `try ${i} passed`, secs: (Date.now() - t0) / 1000 });
        return first;
      }
      continue;
    }
    marks.push('✗');
    if (!best || (res.score ?? 0) > (best.score ?? -1)) best = { code, why: res.why, score: res.score, out: res.out };
    last = { code, why: res.why, detail: res.detail };
    applied.undo?.();
  }
  if (first) {
    ctx.emit('tries-done', { label, marks, summary: `${passes} good of ${marks.length}`, secs: (Date.now() - t0) / 1000 });
    return first;
  }
  ctx.emit('tries-done', { label, marks, summary: ctx.signal?.aborted ? 'stopped' : `none of ${marks.length} tries passed`, secs: (Date.now() - t0) / 1000, failed: true });
  return { ok: false, marks, best };
}
