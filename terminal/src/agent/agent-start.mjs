// The Agent's first steps with a message, before its loop (agent-work.mjs work()): working instructions and
// prompt files saved since the last task, a picture described for a model that cannot see, and the focused
// paths (rename / fix / change). Its methods are put on Agent.prototype by agent.mjs, so this is the Agent:
// every this.x() is the agent's own. Moved from work() word for word.
import { readInstructions, replaceInstructionBlock, withModelNotes } from './instructions.mjs';
import { describePictures, describedNote } from './helper-models.mjs';
import { runFlows } from '../flows/index.mjs';
import { tallies } from '../flows/llm.mjs';
import { tokensOf } from './agent-said.mjs';

export class StartPart {
  loadChanges() {
    // A hub save applies between tasks; in-flight requests keep their snapshot.
    // With the model's own instructions (/tune), which change with a save there or another model.
    const instructions = readInstructions();
    const was = this.workingInstructions?.model ?? '';
    this.workingInstructions = withModelNotes(instructions.sections, this.model?.ownNotes);
    const before = this.messages[0].content;
    const after = replaceInstructionBlock(before, this.workingInstructions);
    if (after !== before) {
      this.setSystem(after);
      this.ctxUsed += tokensOf(after) - tokensOf(before);
      const mine = this.workingInstructions.model ?? '';
      this.emit('note', { text: mine !== was ? `${this.model?.remote?.model ?? this.model?.name ?? 'The model'}’s own instructions (/tune) ${mine ? 'loaded' : 'taken out'}.` : 'Updated working instructions loaded.', tone: 'dim' });
    }
    // A save of AGENTS.md, TOOLS.md or SKILLS.md (the hub's Prompt files) applies between tasks too.
    // Not in a helper: its one task keeps the prompt it was handed (the parent's, with its part).
    if (!this.isHelper && this.promptFilesChanged()) {
      const was = this.rulesSetUsed;
      this.refreshNotes();
      this.emit('note', { text: was === this.rulesSetUsed ? 'Updated prompt files loaded (AGENTS.md, TOOLS.md, SKILLS.md).' : this.setNote(), tone: 'dim' });
    }
    // Helpers on another model (agent.mjs helpersElsewhere): the Agent tool and its line come with a conversation's
    // first message, the prompt built again once.
    if (!this.isHelper && Boolean(this.helperLineUsed) !== this.helpersElsewhere()) {
      this.refreshNotes();
      if (this.helperLineUsed) this.emit('note', { text: `Helpers on ${this.helpersAway.model}: the Agent tool hands reading and searching to it, and its report comes back (/profiles, Helpers it starts).`, tone: 'dim' });
    }
  }

  // Gives back the message and its pictures as they go to the model.
  async picturesFirst(text, images, signal) {
    // A picture this model cannot see, and a Pictures helper on the service: it describes
    // the picture first, and the words go in its place (/subagents, 2 Oct 2026).
    const lookUse = images?.length && !this.canSee ? this.helperUse('pictures') : undefined;
    if (lookUse) {
      this.emit('note', { text: `Pictures: ${lookUse.model} looks at ${images.length === 1 ? 'the picture' : `the ${images.length} pictures`} first…`, tone: 'dim' });
      try {
        const d = await describePictures({ url: this.url, use: lookUse, images, question: text, signal });
        this.emit('note', { text: `Pictures: ${lookUse.model} described ${images.length === 1 ? 'it' : 'them'} (${d.secs.toFixed(0)} s): ${d.text.replace(/\s+/g, ' ').slice(0, 160)}${d.text.length > 160 ? '…' : ''}`, tone: 'dim' });
        text = `${text}\n\n${describedNote(images, lookUse.model, d.text)}`;
      } catch (e) {
        if (signal?.aborted) throw e;
        this.emit('note', { text: `Pictures: ${lookUse.model} could not look (${e.message}); the message goes with a line saying a picture was attached.`, tone: 'warn' });
        text = `${text}\n\n(The user attached ${images.length === 1 ? 'a picture' : `${images.length} pictures`} (${images.map((i) => i.path).join(', ')}), but this model is not looking at pictures now.)`;
      }
      images = undefined;
    }
    return { text, images };
  }

  // Gives back how the turn ended when a path did the work; nothing when the loop is to do it.
  async focusedPaths(text, started, signal) {
    // Every focused call's tokens, for the done line (the loop counts its own).
    const counted = { steps: 0, tokens: 0, thinkTokens: 0 };
    const tally = ({ tokens, thought }) => { counted.steps++; counted.tokens += tokens + thought; counted.thinkTokens += thought; this.stats.outTokens += tokens + thought; };
    tallies.add(tally);
    const fctx = this.flowContext(signal);
    try {
      const r = await runFlows(fctx, text);
      if (r) {
        this.emit('flow-step', null);
        this.messages.push({ role: 'assistant', content: r.summary });
        this.emit('assistant', { text: r.summary, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
        this.busy = false;
        this.happened.flow = { done: r.done, summary: String(r.summary ?? '').slice(0, 300) };
        const reason = signal?.aborted ? 'interrupted' : r.declined ? 'declined' : 'done';
        if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
        tallies.delete(tally);
        this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, flow: true, done: r.done, steps: counted.steps, reads: 0, thinkTokens: counted.thinkTokens, tokens: counted.tokens });
        return reason;
      }
      tallies.delete(tally);
      this.carriedNotes = [...fctx.notes]; // notes a path read before it handed over go with the first step
    } catch (e) {
      tallies.delete(tally);
      this.carriedNotes = [...fctx.notes]; // notes a path read before it gave up go with the first step
      this.emit('flow-step', null);
      if (signal?.aborted || e.name === 'AbortError') {
        this.busy = false;
        this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
        this.emit('turn-end', { reason: 'interrupted', secs: (Date.now() - started) / 1000 });
        return 'interrupted';
      }
      this.emit('note', { text: `The focused path failed (${e.message}); working step by step instead.`, tone: 'warn' });
    }
  }
}
