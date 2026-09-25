// Applying a finished change to your real files: show the diff and ask (as
// in the tool loop: yes / yes for this session / no), unless edits are on
// auto-accept.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { diffLines } from '../tools/edit.mjs';

export async function applyChange(ctx, changes) {
  for (const c of changes) {
    const d = diffLines(c.before ?? '', c.after);
    const prepared = { abs: join(ctx.cwd, c.rel), rel: c.rel, before: c.before ?? '', after: c.after, ...d, created: c.before === null || c.before === undefined };
    if (ctx.mode() !== 'edits') {
      const answer = await ctx.ask({ id: `flow_${Date.now()}`, name: prepared.created ? 'Write' : 'Edit', args: { path: c.rel }, prepared, label: prepared.created ? 'Write' : 'Update', arg: c.rel });
      if (answer.choice === 'no') {
        ctx.tool(prepared.created ? 'Write' : 'Update', c.rel, { kind: 'declined', feedback: answer.feedback }, true);
        return { ok: false };
      }
      if (answer.choice === 'always') ctx.setMode('edits');
    }
    mkdirSync(dirname(prepared.abs), { recursive: true });
    writeFileSync(prepared.abs, c.after);
    ctx.tool(prepared.created ? 'Write' : 'Update', c.rel, { kind: 'diff', path: c.rel, created: prepared.created, hunk: d.hunk, additions: d.additions, removals: d.removals, lines: c.after.split('\n').length });
  }
  return { ok: true };
}
