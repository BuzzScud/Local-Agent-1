// Applying a finished change to your real files: show the diff and ask (as
// in the tool loop: yes / yes for this session / no), unless edits are on
// auto-accept. A protected file (.env, .git/…, yours from /permissions) asks
// even then, with no "allow all edits".
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { diffLines } from '../tools/edit.mjs';

export async function applyChange(ctx, changes) {
  // On auto-accept, the plan is shown once first (yes, or what to do instead).
  if (ctx.mode() === 'edits' && ctx.confirm && changes.length) {
    const plan = `change ${changes.map((c) => { const d = diffLines(c.before ?? '', c.after); return `${c.rel} (+${d.additions} −${d.removals})`; }).join(', ')}`;
    const r = await ctx.confirm(plan);
    if (!r.ok) return { ok: false, feedback: r.feedback };
  }
  const guard = (c) => ctx.protectedBy?.(c.rel) ?? null;
  const prep = (c) => { const d = diffLines(c.before ?? '', c.after); return { d, prepared: { abs: join(ctx.cwd, c.rel), rel: c.rel, before: c.before ?? '', after: c.after, ...d, created: c.before === null || c.before === undefined } }; };
  // The question for one file; false when you said no.
  const ask = async (c, prepared, g) => {
    const answer = await ctx.ask({ id: `flow_${Date.now()}`, name: prepared.created ? 'Write' : 'Edit', args: { path: c.rel }, prepared, label: prepared.created ? 'Write' : 'Update', arg: c.rel, ...(g ? { once: true, protectedBy: g } : {}) });
    if (answer.choice === 'no') {
      ctx.tool(prepared.created ? 'Write' : 'Update', c.rel, { kind: 'declined', feedback: answer.feedback }, true);
      return false;
    }
    if (answer.choice === 'always' && !g) ctx.setMode('edits');
    return true;
  };
  // On auto-accept the protected files are asked about first, before anything
  // is written, so a no leaves every file as it was.
  const asked = new Set();
  if (ctx.mode() === 'edits') {
    for (const c of changes) {
      const g = guard(c);
      if (!g) continue;
      if (!(await ask(c, prep(c).prepared, g))) return { ok: false };
      asked.add(c.rel);
    }
  }
  for (const c of changes) {
    const { d, prepared } = prep(c);
    if (!asked.has(c.rel) && (ctx.mode() !== 'edits' || guard(c)) && !(await ask(c, prepared, guard(c)))) return { ok: false };
    mkdirSync(dirname(prepared.abs), { recursive: true });
    writeFileSync(prepared.abs, c.after);
    ctx.tool(prepared.created ? 'Write' : 'Update', c.rel, { kind: 'diff', path: c.rel, created: prepared.created, hunk: d.hunk, additions: d.additions, removals: d.removals, lines: c.after.split('\n').length });
  }
  return { ok: true };
}
