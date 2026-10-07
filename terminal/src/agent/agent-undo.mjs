// The Agent's safety net (agent.mjs): errors kept, files kept as they were, a failed message's changes
// put back (or kept when it got closer), and a check run aside.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Scratch } from '../flows/scratch.mjs';
import { failsOf } from './agent-said.mjs';

export class UndoPart {
  // The last tool error, kept out of the trim (fitContext skips a message with keep).
  // Only the latest one: every error kept would fill the memory.
  noteError(text, msg) {
    if (!this.turn) return;
    for (const m of this.messages) if (m.keep === 'error') delete m.keep;
    if (msg) msg.keep = 'error';
    this.turn.lastError = String(text ?? '').slice(0, 2500);
  }

  // Edits land in the project, so commands see them and keep what they write. The text
  // each file had before this message first changed it is kept, with what the last edit
  // wrote; a failed check puts the first back (putBack). A helper's edits go in its
  // parent's book, so the parent's check covers them too.
  keepOriginal(prepared) {
    const t = this.parentTurn?.() ?? this.turn;
    if (!t || t.question || !prepared?.rel) return;
    t.originals ??= new Map();
    t.wrote ??= new Map();
    if (!t.originals.has(prepared.rel)) t.originals.set(prepared.rel, prepared.created ? null : prepared.before);
    t.wrote.set(prepared.rel, prepared.after);
  }

  // Why this message's changes go back, or null: a skill's check fence ran no command,
  // or the last check ran and failed. A check that never ran holds nothing back (the
  // tests hook off, or nothing to run). A stop or a no keeps the rest, as before: a no
  // refuses that one change, and /rewind undoes the message.
  putBackWhy(reason) {
    const t = this.turn;
    if (this.isHelper || this.lean || !t?.originals?.size || reason === 'interrupted' || reason === 'declined') return null;
    if (t.fence?.has('check') && !t.ranCommand) return "The skill's check never ran";
    if (t.checkFailed && this.keepProgress && this.madeProgress()) return null;
    if (t.checkFailed) return 'The check failed';
    return null;
  }

  // A loop's run: its last check failed, but fewer tests fail than before this message and none
  // fails that passed before (the owner's pick, 3 Oct 2026). Unknown either way counts as no progress.
  madeProgress() {
    const t = this.turn;
    const before = t.failsBefore ?? (this.happened?.testRun ? failsOf(this.happened.testRun.out, this.happened.testRun.code !== 0) : null);
    const after = t.failsAfter;
    if (!before || !after || before.failed == null || after.failed == null) return false;
    if (after.failed >= before.failed) return false;
    const was = new Set(before.failing);
    // Runners name at most ten failing tests: with more than that the names cannot show "none newly".
    if (before.failed > before.failing.length || after.failed > after.failing.length) return false;
    if (after.failing.some((n) => !was.has(n))) return false;
    this.emit('note', { text: `Kept: ${after.failed} of the ${before.failed} failing tests still fail and none fails newly, so this run's changes stay for the next run.`, tone: 'dim' });
    return true;
  }

  // Each changed file back to its text before this message. A file that changed after
  // the model's last edit (you, a formatter, a command) is left as it is.
  putBack() {
    const t = this.turn;
    const back = [];
    const left = [];
    for (const [rel, before] of t.originals) {
      const abs = join(this.cwd, rel);
      let now = null;
      try { now = readFileSync(abs, 'utf8'); } catch {}
      if (now !== t.wrote.get(rel)) { left.push(rel); continue; }
      if (before === null) rmSync(abs, { force: true });
      else writeFileSync(abs, before);
      back.push(rel);
    }
    t.originals = new Map();
    t.wrote = new Map();
    return { back, left };
  }

  // A command in a question turn that may write: it runs in a throwaway copy
  // of the project (made once per message), so whatever it writes, your files
  // stay as they are.
  async runAside(command, signal) {
    this.turn.scratch ??= new Scratch(this.cwd);
    const r = await this.turn.scratch.run(command, { timeoutMs: 120_000, signal });
    const all = r.out.replace(/\n$/, '').split('\n');
    const lines = all.length > 80 ? [...all.slice(0, 40), `… ${all.length - 80} lines cut …`, ...all.slice(-40)] : all;
    const status = r.timedOut ? '\n(stopped after 2 minutes)' : r.code === 0 ? '' : `\n(exit code ${r.code})`;
    const text = `(This ran in a throwaway copy of the project: a question changes no files.)\n${(lines.join('\n') || '(no output)').slice(0, this.maxResultChars)}${status}`;
    return { text, error: r.code !== 0, view: { kind: 'bash', code: r.code, lines, ms: r.ms, timedOut: r.timedOut } };
  }

  // Problems the layout check still found after the model's fix get the last
  // word: its answer may say "fixed" (Qwen, 30 Sep: "meets the 4.5:1 contrast"
  // at 4.1:1; "fixed the horizontal scroll" at 401 px in a 390 px window), so
  // the turn ends with the check's own line. Changed again since that look:
  // looked at once more, quietly, so the line is never stale.
  async stillBroken(reason) {
    const t = this.turn;
    if (!t?.layoutLeft || reason === 'interrupted') return;
    if ((t.edits ?? 0) !== t.editsAtLook) { try { await this.checkLayout(true, { quiet: true }); } catch { return; } }
    for (const { page, problems } of t.layoutLeft ?? []) {
      this.emit('note', { text: `Still broken: ${problems[0].replace(/\.$/, '')}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}. The page check looked at ${page} again after the fix.`, tone: 'warn', stillBroken: { page, problems } });
    }
  }
}
