// Applying a finished change to your real files: show the diff and ask (as
// in the tool loop: yes / yes for this session / no), unless edits are on
// auto-accept. A protected file (.env, .git/…, yours from /permissions) asks
// even then, with no "allow all edits".
import { readFileSync, mkdirSync } from 'node:fs';
import { writeWhole } from '../agent/write-whole.mjs';
import { join, dirname } from 'node:path';
import { diffLines } from '../tools/edit.mjs';
import { changesSaid } from '../agent/questions.mjs';

// The files of a change that are no longer what the change was worked out on (18 Nov 2026, the audit: a fix read
// the file, spent minutes on tries or on your yes, and wrote over what you had saved meanwhile).
const nowText = (abs) => { try { return readFileSync(abs, 'utf8'); } catch { return null; } };
function changedSince(cwd, changes) {
  return changes.filter((c) => nowText(join(cwd, c.rel)) !== (c.before ?? null)).map((c) => c.rel);
}
// What a flow says when its change was not applied.
export function notApplied(applied, said = 'You said no to the change; nothing was changed.') {
  if (applied.stale?.length) return `${applied.stale.join(', ')} changed while it worked (saved in an editor, or by another program), so nothing was changed. Ask again to make the change on what the file holds now.`;
  return said;
}

export async function applyChange(ctx, changes) {
  const stale = (list) => {
    for (const rel of list) ctx.tool('Update', rel, { kind: 'error', message: `${rel} changed while it worked: nothing written` }, true);
    return { ok: false, stale: list };
  };
  const early = changedSince(ctx.cwd, changes);
  if (early.length) return stale(early);
  // On auto-accept, the plan is shown once first (yes, or what to do instead).
  if (ctx.mode() === 'edits' && ctx.confirm && changes.length) {
    const plan = changesSaid(changes.map((c) => ({ rel: c.rel, ...diffLines(c.before ?? '', c.after) })));
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
  // Every answer first, then one more look at the files, then the writes: a no or a file changed while it asked
  // leaves every file as it was.
  for (const c of changes) {
    const { prepared } = prep(c);
    if (!asked.has(c.rel) && (ctx.mode() !== 'edits' || guard(c)) && !(await ask(c, prepared, guard(c)))) return { ok: false };
  }
  const late = changedSince(ctx.cwd, changes);
  if (late.length) return stale(late);
  for (const c of changes) {
    const { d, prepared } = prep(c);
    mkdirSync(dirname(prepared.abs), { recursive: true });
    writeWhole(prepared.abs, c.after);
    ctx.tool(prepared.created ? 'Write' : 'Update', c.rel, { kind: 'diff', path: c.rel, created: prepared.created, hunk: d.hunk, additions: d.additions, removals: d.removals, lines: c.after.split('\n').length });
  }
  return { ok: true };
}
