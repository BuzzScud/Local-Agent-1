// The steps that go before the others (earlyStep): MoreTools (tools on demand), and Claude Code's MultiEdit and
// NotebookEdit for the Agent (agent.mjs; the owner's picks, 19 Nov 2026). The two edits are worked
// out on the file's text first, then run as Edits through runStep, so every check and question of an Edit holds.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { readFileSync } from 'node:fs';
import { findEdit, resolvePath } from './tools.mjs';
import { notebookChange } from './tools-notebook.mjs';
import { MORE_TOOLS } from './tool-groups.mjs';

export class EditsPart {
  // Before a step is run (agent-step.mjs runStep): MoreTools adds a group (tool-groups.mjs); a tool of a group
  // not added yet still runs, and its group joins, so it is on the list from the next step; MultiEdit and
  // NotebookEdit run here. → the step's answer (a promise), or null when runStep goes on as before.
  earlyStep(call, signal) {
    if (call.name === MORE_TOOLS) return Promise.resolve(this.runMoreTools(call));
    if (this.onDemand()) this.joinGroupOf(call.name);
    if (call.name === 'MultiEdit') return this.multiEdit(call, signal);
    if (call.name === 'NotebookEdit') return this.notebookEdit(call, signal);
    return null;
  }

  // MultiEdit (tools-defs.mjs, Claude Code's tool): every change tried in order on the file's text first, so
  // one that does not fit changes nothing; then each runs as an Edit, with its checks and questions.
  async multiEdit(call, signal) {
    const fail = (text) => { this.emit('tool', { id: call.id, name: 'Edit', label: 'Update', arg: '', view: { kind: 'error', message: text.split('\n')[0].slice(0, 200) }, error: true }); return { text, error: true }; };
    let raw = {};
    try { raw = JSON.parse(call.args || '{}'); } catch { return fail('MultiEdit needs JSON: {"path": "…", "edits": [{"old_text": "…", "new_text": "…"}]}.'); }
    const edits = Array.isArray(raw.edits) ? raw.edits : [];
    if (typeof raw.path !== 'string' || !raw.path.trim()) return fail('MultiEdit needs path: the file to change.');
    if (!edits.length) return fail('MultiEdit needs edits: a list of {"old_text", "new_text"}, at least one.');
    let text;
    try { text = readFileSync(resolvePath(this.cwd, raw.path).abs, 'utf8'); } catch { return fail(`${raw.path} is not there to change. Make a new file with Write.`); }
    for (const [i, e] of edits.entries()) {
      if (typeof e?.old_text !== 'string' || typeof e?.new_text !== 'string') return fail(`Change ${i + 1} of ${edits.length} needs old_text and new_text. Nothing was changed.`);
      const r = findEdit(text, e.old_text, e.new_text, { replaceAll: Boolean(e.replace_all), line: e.line ?? null });
      if (!r.ok) return fail(`Change ${i + 1} of ${edits.length} does not fit, so nothing was changed: ${r.error}`);
      text = r.after;
    }
    const said = [];
    for (const [i, e] of edits.entries()) {
      const out = await this.runStep({ id: `${call.id}-${i}`, name: 'Edit', args: JSON.stringify({ path: raw.path, ...e }) }, signal);
      if (out.error || out.stop) return { ...out, text: `Change ${i + 1} of ${edits.length}: ${out.text}${i ? ` The ${i} before it went in.` : ''}` };
      said.push(out.text);
    }
    return { text: edits.length === 1 ? said[0] : `All ${edits.length} changes went in.\n${said.join('\n')}` };
  }

  // NotebookEdit (tools-defs.mjs, Claude Code's tool): the cell changed on the file's text (tools-notebook.mjs),
  // then run as one Edit of the whole file, with its checks and questions. Only path: the cells, nothing changed.
  async notebookEdit(call, signal) {
    const fail = (text) => { this.emit('tool', { id: call.id, name: 'Edit', label: 'Update', arg: '', view: { kind: 'error', message: text.split('\n')[0].slice(0, 200) }, error: true }); return { text, error: true }; };
    let raw = {};
    try { raw = JSON.parse(call.args || '{}'); } catch { return fail('NotebookEdit needs JSON: {"path": "x.ipynb", "cell": 0, "source": "…"}.'); }
    if (typeof raw.path !== 'string' || !/\.ipynb$/i.test(raw.path.trim())) return fail('NotebookEdit needs path: a .ipynb notebook. Change another file with Edit.');
    let text;
    try { text = readFileSync(resolvePath(this.cwd, raw.path).abs, 'utf8'); } catch { return fail(`${raw.path} is not there. Make a new notebook with Write.`); }
    const r = notebookChange(text, raw);
    if (r.error) return fail(r.error);
    if (r.list) { this.emit('tool', { id: call.id, name: 'Read', label: 'Read', arg: raw.path, view: { kind: 'list', count: r.list.split('\n').length - 1, content: r.list } }); return { text: `${raw.path}: ${r.list}` }; }
    const out = await this.runStep({ id: call.id, name: 'Edit', args: JSON.stringify({ path: raw.path, old_text: text, new_text: r.after }) }, signal);
    return out.error || out.stop ? out : { ...out, text: `${r.said} of ${raw.path}. ${out.text}` };
  }
}
