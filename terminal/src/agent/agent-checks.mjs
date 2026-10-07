// The Agent's checks and questions (agent.mjs): the reminders of the plan and the request, the cases,
// Look first, Stays on task, the second look, the check-ins, the stuck question and asking the user.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { endpointOf } from '../../../models/index.mjs';
import { askedQuestions, checkInQuestion, errorSaid, lookSaid, planQuestion, sameResultSaid, stepSaid, stuckQuestion } from './questions.mjs';
import { CASES_ASK, CASES_FIX, MAX_CASES, REVIEW_CODE, REVIEW_MAX, REVIEW_SCHEMA, REVIEW_SYSTEM, addCase, casesFromList, casesOf, casesTold, gapCases, isTestPath, reviewAsk, reviewBack, reviewWrong, signSample } from './cases.mjs';
import { display, parseArgs } from './tools.mjs';
import { readFileSync } from 'node:fs';
import { namesQuestion } from './folder.mjs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { lostNames } from '../flows/blocks.mjs';
import { complete } from '../flows/llm.mjs';
import { DRIFT_EVERY, DRIFT_NUDGES, driftCheck, nudgeText, recentSteps } from './drift.mjs';
import { lookFacts, lookOn, lookText, ownSteps, secondLook } from './second-look.mjs';
import { chasedQuestion } from './claude-notes.mjs';
import { reviewChange } from './helper-models.mjs';
import { BIG_MEMORY, CASE_ITEM, CHANGES, CUT_MARK, LOOKS, PLAN_EVERY, REQUEST_EVERY, claimsFound, namesAFix, planList, planReminder, requestReminder, severalAsks } from './agent-said.mjs';

export class ChecksPart {
  // This turn's request with what goes along with it (see send()): the steps
  // for its kind of bug, the user's own math notes when the topic came up, and
  // the design examples with a request to make or restyle a page.
  withTurnNotes(messages) {
    const t = this.turn;
    if (t?.baked) return messages;
    const extras = [t?.bug, t?.skill, t?.folder, t?.look, t?.asks, t?.fixNote, t?.math, t?.design, t?.carried, t?.web, t?.mcp, t?.open, t?.rules].filter(Boolean);
    const pin = this.pinnedNote();
    if (!extras.length && !pin) return messages;
    return messages.map((m) => {
      const notes = extras.filter((x) => m === x.request).map((x) => `\n\n(${x.steps ?? x.notes})`).join('');
      const held = pin && m === t.requestMsg ? `\n\n(${pin})` : '';
      return notes || held ? { ...m, content: `${m.content}${notes}${held}` } : m;
    });
  }

  // What a trim must not drop, sent with the request: the success check, and the last tool
  // error once its own message has been shortened. While that message is still whole, the
  // model already has it. The focused tries put the last failure in the next prompt; this
  // is the free loop's copy of that.
  pinnedNote() {
    const t = this.turn;
    if (!t) return '';
    const parts = [];
    if (t.check) parts.push(`This request passes when this command passes: ${t.check}`);
    const held = t.lastError && this.messages.some((m) => m.keep === 'error' && !String(m.content).startsWith('[older output removed'));
    if (t.lastError && !held) parts.push(`The last tool error, kept whole:\n${t.lastError}`);
    return parts.join('\n\n');
  }

  // The reminder of its plan (planReminder) when this step is PLAN_EVERY steps or more past the last
  // time it saw it, and steps are left. Only a plan written in this message counts (planAt).
  planDue(calls) {
    const t = this.turn;
    if (!t) return '';
    if (calls.some((c) => c.name === 'TodoWrite')) { t.planAt = t.steps ?? 0; return ''; }
    if (this.lean || t.planAt == null || (t.steps ?? 0) - t.planAt < PLAN_EVERY) return '';
    const line = planReminder(this.todos);
    if (line) t.planAt = t.steps ?? 0;
    return line;
  }

  // A question from Claude's notes taken for the request (claude-notes.mjs chasedQuestion): once a message,
  // the line that sets it right, with the request (4 Oct 2026: a quoted 30 Sep question was worked on for
  // 20 minutes in place of the request).
  noteChaseDue(said) {
    const t = this.turn;
    if (!t || t.noteChased || !this.claudeSaid) return '';
    const q = chasedQuestion(said, this.claudeSaid, t.task ?? t.request);
    if (!q) return '';
    t.noteChased = true;
    const words = String(t.task ?? t.request ?? '').split('\n\n(')[0].replace(/\s+/g, ' ').trim();
    this.emit('note', { text: `It took a question from Claude's notes for your request ("${q.length > 80 ? `${q.slice(0, 79)}…` : q}"); set it right.`, tone: 'warn' });
    return `(The question "${q}" is quoted in Claude's notes from an earlier conversation; it is not this request, so leave it. This message's request: "${words.length > 600 ? `${words.slice(0, 599)}…` : words}". Work on that.)`;
  }

  // Your request (requestReminder) on a model with a big memory, REQUEST_EVERY steps after it was last in sight.
  requestDue() {
    const t = this.turn;
    if (!t || this.lean || this.ctx < BIG_MEMORY || !String(t.request ?? '').trim()) return '';
    if ((t.steps ?? 0) - (t.requestAt ?? 0) < REQUEST_EVERY) return '';
    t.requestAt = t.steps ?? 0;
    return requestReminder(t.request, t.task);
  }
  // The follow-through lines with a step's result (4 Oct 2026, the owner's picks after a Qwen run): a wall
  // it met and has not asked you about after two more steps (Stop when blocked); a reply that says it
  // found what it needs when it saw only outlines of the files (Read before claiming); a request with
  // several asks and no plan by the third step (Plan for several asks). Each once a message.
  followDue(calls, text) {
    const t = this.turn;
    if (!t || this.isHelper) return [];
    const out = [];
    const wall = t.walls[0];
    if (wall && !t.askedUser && !t.wallReminded && (t.steps ?? 0) - wall.step >= 2 && this.hook('blocked')) {
      t.wallReminded = true;
      this.emit('note', { text: 'It has not asked you about what blocked it; reminded it to ask.', tone: 'warn' });
      out.push(`(You have not asked the user yet: ${wall.why}. Ask now, with Ask, before you go on. Do not do a different task instead.)`);
    }
    if (!t.readFirstSent && t.outlined.size && claimsFound(text) && this.hook('read-first')) {
      t.readFirstSent = true;
      const names = [...t.outlined].slice(0, 3).map((f) => basename(f));
      this.emit('note', { text: `It says it found what it needs, but saw only the outline of ${names.join(', ')}; told it to read the part first.`, tone: 'warn' });
      out.push(`(You wrote that you found or have what you need, but of ${names.join(', ')} you have seen only the outline: its parts and line numbers, none of its text. Read the part you need (offset and limit, or find) before you use what is in it.)`);
    }
    if (!t.toDoSent && t.planAt == null && (t.steps ?? 0) >= 3 && !calls.some((c) => c.name === 'TodoWrite') && severalAsks(t.request) && this.hook('to-do') && this.tools().some((x) => x.function?.name === 'TodoWrite')) {
      t.toDoSent = true;
      this.emit('note', { text: 'Several asks and no plan yet: asked it to write one.', tone: 'dim' });
      out.push('(Your request has several asks. Write your plan now with TodoWrite: one item for each thing the user asked, and mark each one as you finish it.)');
    }
    return out;
  }
  // The request's cases (cases.mjs): with the first change of a message, on a model on another machine in a
  // project with tests, a call of their own lists them with a fixed form of answer (listCases), and the model is
  // told the list; the check before its answer stands holds it to them. The owner's pick, 4 Oct 2026: asked to
  // write its plan as the cases, two models of four ignored it twice, so the check had nothing to hold them to.
  // A plan written as cases adds its own, kept for the whole message (a plan written again after memory filled
  // dropped Qwen3.6's ten). No list from the call: the model is asked to write them, as before (once, then once more).
  async casesDue(calls, signal) {
    const t = this.turn;
    if (!t || this.isHelper || !this.model?.remote || !this.testCmd || !this.hook('cases') || !this.tools().some((x) => x.function?.name === 'TodoWrite')) return '';
    const wrotePlan = calls.some((c) => c.name === 'TodoWrite');
    if (wrotePlan) for (const c of casesOf(t.planAt != null ? this.todos ?? [] : [])) addCase(t, c);
    if (!t.casesAsked && calls.some((c) => CHANGES.has(c.name))) {
      t.casesAsked = true;
      t.toDoSent = true;
      const listed = await this.listCases(signal);
      if (signal?.aborted) return '';
      for (const c of listed) addCase(t, c);
      if (listed.length) {
        t.casesListed = true;
        this.emit('note', { text: `The request's cases, listed by a call of their own: ${listed.length}, each to be tried by a test before the answer stands.`, tone: 'dim' });
        return casesTold(listed);
      }
      if (t.cases?.length) return '';
      this.emit('note', { text: "Asked it for its plan as the request's cases, each with an example to test.", tone: 'dim' });
      return CASES_ASK;
    }
    if (t.casesAsked && !t.casesListed && !t.casesFixAsked && wrotePlan && !t.cases?.length) {
      t.casesFixAsked = true;
      this.emit('note', { text: 'Its plan has no examples to test: asked for them once more.', tone: 'dim' });
      return CASES_FIX;
    }
    return '';
  }

  // The request's cases from the model, in a call of their own: only the request, and a fixed form of answer
  // (as the Done check asks its question). [] when it gives none or fails.
  async listCases(signal) {
    const request = String(this.turn?.request ?? '').trim();
    if (!request) return [];
    try {
      const r = await complete({ what: 'listing the cases', url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0, maxTokens: 4000,
        system: 'You list the cases a coding request specifies, so each can be tested. Judge only from the request.',
        user: `Request:\n${request.slice(0, 6000)}\n\nList what this request specifies, so that each thing can be tested. Go through it phrase by phrase and stay with its own words: add no behaviour, argument or path it does not state.\n- cases: each behaviour it asks for. One case for every form it names: "A, B or C" is three cases.\n- unchanged: each thing it says must stay as it is, be refused, or be left alone. Again one for every form it names.\nFor each one: example is the input alone, just as the request writes it (a command line, a string, a value), with a small made-up value where it has a placeholder (FILE becomes notes.txt, DIR becomes src, N becomes 3) and relative names only, never a path from the root. Give a call only when the request's form is itself a call. expect is what the request says happens, in the request's own words, with no data shape of your own.\nAt most ${MAX_CASES} in each list.`,
        schema: { type: 'object', properties: { cases: { type: 'array', items: CASE_ITEM, maxItems: MAX_CASES }, unchanged: { type: 'array', items: CASE_ITEM, maxItems: MAX_CASES } }, required: ['cases', 'unchanged'] } });
      const listed = casesFromList(r.json?.cases, r.json?.unchanged, request);
      // What the request spells out and the list left unused (cases.mjs gapCases): a case each.
      return listed.length ? [...listed, ...gapCases(request, listed)] : listed;
    } catch (e) {
      if (signal?.aborted) throw e;
      return [];
    }
  }

  // Case review: the changed code (not its tests), read against each case of the request by a call of its
  // own with a fixed form of answer. What goes back to the model, or '' (all read right, nothing to read, no answer).
  async reviewCases(signal) {
    const t = this.turn;
    // A sign the request spells out (gapCases) is read as an example made of two listed ones; a flag alone has none.
    const listed = (t?.cases ?? []).filter((c) => !c.sign && !c.probe).map((c) => c.example);
    const cases = (t?.cases ?? []).filter((c) => !c.probe).map((c) => (c.sign ? { ...c, example: signSample(c.sign, listed), text: `\`${signSample(c.sign, listed)}\` → what the request says about \`${c.sign}\`` } : c)).slice(0, REVIEW_MAX);
    const request = String(t?.request ?? '').trim();
    if (!cases.length || !request) return '';
    let code = [...(t.wrote?.keys() ?? [])].filter((rel) => !isTestPath(rel)).map((rel) => { try { return `--- ${rel}\n${readFileSync(join(this.cwd, rel), 'utf8')}`; } catch { return ''; } }).filter(Boolean).join('\n\n');
    if (!code) return '';
    if (code.length > REVIEW_CODE) code = t.diffs?.trim() ? `(The changed files are long, so these are this message's changes: + added, - removed.)\n${t.diffs.slice(0, REVIEW_CODE)}` : code.slice(0, REVIEW_CODE);
    const t0 = Date.now();
    this.emit('busy', { task: 'reading the code against the cases' });
    try {
      const r = await complete({ what: 'reviewing the cases', url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0, maxTokens: 4000, system: REVIEW_SYSTEM, user: reviewAsk({ request, code, cases }), schema: REVIEW_SCHEMA(cases.length) });
      const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
      if (!Array.isArray(r.json?.reviews)) { this.emit('note', { text: `Case review: no answer came back (${secs} s); the answer stands as it is.`, tone: 'dim', fold: true }); return ''; }
      const wrong = reviewWrong(r.json.reviews, cases);
      if (!wrong.length) { this.emit('note', { text: `Case review: the code reads right for all ${cases.length} cases (${secs} s).`, tone: 'dim', fold: true }); return ''; }
      this.emit('note', { text: `Case review: ${wrong.length} of the ${cases.length} cases read as wrong (${secs} s); sent back once to be checked. · ${wrong.slice(0, 4).map((w) => w.example).join(' · ')}`, tone: 'warn' });
      return reviewBack(wrong, cases.length);
    } catch (e) {
      if (signal?.aborted) throw e;
      this.emit('note', { text: 'Case review: no answer came back; the answer stands as it is.', tone: 'dim', fold: true });
      return '';
    }
  }

  // Who checks that a model on another machine stays on task (drift.mjs): on an Ollama service its Side
  // jobs helper, else the main model; on the owner's other Mac (coding serve) the main model on the
  // server's second lane, as Auto's check does, so the conversation's own lane is not read again.
  driftWho() {
    if (!this.model?.remote) return null;
    const ep = endpointOf(this.url);
    if (ep?.ollama) return { use: this.sideUse() };
    if (ep?.kind === 'llama') return this.slots?.side !== undefined ? { slot: this.slots.side } : { none: 'its server has one lane (coding serve --slots 2 gives it a second)' };
    return null;
  }
  // Who takes the second look (second-look.mjs): on a model on another machine as for Stays on task; on this
  // Mac the server's second lane when it has one (as the Done check); the Claude API and other services: none.
  lookWho() {
    if (this.model?.remote) return this.driftWho();
    return this.slots?.side !== undefined ? { slot: this.slots.side } : null;
  }
  // Second look (/hooks, on): after a message that ran commands, wrote files or fetched pages, the answer is
  // checked against what the app saw; one that does not hold goes back once. Answers the line to send, or ''.
  async lookDue(answer, signal) {
    const t = this.turn;
    if (!t || this.isHelper || t.looked2 || !lookOn() || !this.hook('second-look')) return '';
    if (!(t.ranCommand || t.changed || t.wroteByCommand || t.fetched)) return '';
    t.looked2 = true;
    const who = this.lookWho();
    if (!who || who.none) return '';
    this.emit('busy', { task: 'taking a second look at the answer' });
    // The model's own calls of this message, kept as they ran (a summary of the conversation cannot lose them).
    const steps = ownSteps([{ role: 'assistant', tool_calls: t.callLog ?? [] }]);
    const r = await secondLook({ url: this.url, model: this.model, slot: who.slot, use: who.use, request: t.request, plan: t.planAt != null ? planList(this.todos) : '', steps, facts: lookFacts(t, { home: this.home ?? homedir() }), answer, signal });
    const secs = `${(r.ms / 1000).toFixed(1)} s`;
    if (r.failed) { this.emit('note', { text: `Second look: not made (${r.reason}).`, tone: 'dim' }); return ''; }
    if (r.ok) { this.emit('note', { text: `Second look: the answer holds (${secs}).`, tone: 'dim', check: { title: 'Second look', page: '', problems: [], ok: 'the answer holds', where: secs } }); return ''; }
    this.emit('note', { text: `Second look: ${r.problems.join(' · ')} Sent it back (${secs}).`, tone: 'warn', check: { title: 'Second look', page: '', problems: r.problems, bad: `${r.problems.length === 1 ? 'one thing' : `${r.problems.length} things`} the answer must fix`, where: secs, sent: true } });
    return lookText(r.problems);
  }
  // Stays on task (/hooks, off until you switch it on): every DRIFT_EVERY steps, the check; off task, the
  // line that brings it back (DRIFT_NUDGES a message at most). Answers that line, or ''.
  async driftDue(signal) {
    const t = this.turn;
    if (!t || this.isHelper || !this.hook('drift') || (t.nudges ?? 0) >= DRIFT_NUDGES) return '';
    if ((t.steps ?? 0) - (t.driftAt ?? 0) < DRIFT_EVERY) return '';
    t.driftAt = t.steps ?? 0;
    const who = this.driftWho();
    if (!who) return '';
    if (who.none) {
      if (!t.driftNone) { t.driftNone = true; this.emit('note', { text: `Stays on task: not checked, ${who.none}.`, tone: 'dim' }); }
      return '';
    }
    const { steps, said } = recentSteps(this.messages);
    this.emit('busy', { task: 'checking it stays on task' });
    const r = await driftCheck({ url: this.url, model: this.model, slot: who.slot, use: who.use, request: t.request, plan: t.planAt != null ? planList(this.todos) : '', steps, said, signal });
    const secs = `${(r.ms / 1000).toFixed(1)} s`;
    if (r.failed) { this.emit('note', { text: `Stays on task: not checked (${r.reason}).`, tone: 'dim' }); return ''; }
    if (r.on) { this.emit('note', { text: `Stays on task: on track (${secs}).`, tone: 'dim' }); return ''; }
    t.nudges = (t.nudges ?? 0) + 1;
    this.emit('note', { text: `Stays on task: ${r.reason}. Nudged it back (${t.nudges} of ${DRIFT_NUDGES}, ${secs}).`, tone: 'warn' });
    return nudgeText(r.reason);
  }

  // The functions this message's changes took away that the request neither
  // names nor asks to remove (lostNames), as "area in shapes.mjs"; null when
  // none. A function moved to another changed file is not lost.
  lostSinceStart() {
    const starts = this.turn?.startTexts;
    if (!starts?.size) return null;
    const now = new Map([...starts.keys()].map((rel) => { try { return [rel, readFileSync(join(this.cwd, rel), 'utf8')]; } catch { return [rel, '']; } }));
    const out = [];
    for (const [rel, before] of starts) {
      const elsewhere = [...now].filter(([r]) => r !== rel).map(([, t]) => t);
      for (const n of lostNames(rel, before, now.get(rel), this.turn.request ?? '', { elsewhere })) out.push(`${n} in ${rel}`);
    }
    return out.length ? `${out.slice(0, 4).join(', ')}${out.length > 4 ? ` and ${out.length - 4} more` : ''}` : null;
  }

  // A forced-JSON check of the finished work against the request: null when
  // covered, otherwise what is missing (one short sentence). Best effort.
  // Second opinion (/subagents): the request and this message's diff to the review
  // helper. Answers the message that goes back, or null (nothing real found, or it
  // could not answer: a note says so and the turn ends as it would have).
  async secondOpinion(signal) {
    const use = this.helperUse('review');
    if (!use) return null;
    this.emit('note', { text: `Second opinion: ${use.model} reads the change…`, tone: 'dim' });
    this.emit('busy', { task: 'second opinion' });
    try {
      const r = await reviewChange({ url: this.url, use, request: this.turn.request, diff: this.turn.diffs, signal });
      if (r.ok) { this.emit('note', { text: `Second opinion: ${use.model} found nothing wrong (${r.secs.toFixed(0)} s).`, tone: 'dim' }); return null; }
      this.emit('note', { text: `Second opinion: ${use.model} found ${r.findings.length} thing${r.findings.length === 1 ? '' : 's'} (${r.secs.toFixed(0)} s): ${r.findings.join(' · ')}`, tone: 'warn' });
      return `Another model read your change and thinks ${r.findings.length === 1 ? 'this is' : 'these are'} wrong (it can be wrong itself):\n${r.findings.map((f) => `- ${f}`).join('\n')}\nCheck each one with the tools. Fix what is real; for what is not, say why in one sentence. Then report.`;
    } catch (e) {
      if (signal?.aborted) throw e;
      this.emit('note', { text: `Second opinion skipped: ${use.model} did not answer (${e.message}).`, tone: 'dim' });
      return null;
    }
  }

  async verifyDone(answer, signal) {
    const request = [...this.messages].reverse().find((m) => m.role === 'user' && !/^\[|^Not done yet|^Go ahead|^The tests fail|^You created|^Reply to the user|^You ran out/.test(m.content))?.content ?? '';
    if (!request.trim() || !this.turn.diffs.trim()) return null;
    try {
      const r = await complete({ what: 'checking it did everything', url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0, maxTokens: 220,
        system: 'You check whether a coding assistant did everything a request asked. Judge only from the request, the changes and its report.',
        user: `Request:\n${request.slice(0, 2000)}\n\nChanges made (diff lines, + added, - removed; a line ${CUT_MARK} means Agentic Coder shortened the change for this check, not that anything is missing):\n${this.turn.diffs.length > 16000 ? `${this.turn.diffs.slice(0, 16000)}\n${CUT_MARK}` : this.turn.diffs}\n\nIts report:\n${(answer ?? '').slice(0, 1000)}\n\nBreak the request into its distinct asks (parts, at most 6) and judge each one against the changes. A request with one ask has one part. A part is done only when it is done fully, the way the person asking would expect: a story, notes, a description or documentation that is only a sentence or two, a placeholder, a stub or a TODO counts as not done. Is every part of the request done? If something the request asks for is missing from the changes, say what in one short sentence.`,
        schema: { type: 'object', properties: { parts: { type: 'array', items: { type: 'object', properties: { part: { type: 'string' }, done: { type: 'boolean' } }, required: ['part', 'done'] }, maxItems: 6 }, done: { type: 'boolean' }, missing: { type: 'string' } }, required: ['parts', 'done', 'missing'] } });
      if (!r.json) return null;
      // Parts first: a request with several asks fails on the ones not done
      // (task 28's class: "the fallback missed a part").
      const undone = (r.json.parts ?? []).filter((p) => p && p.done === false && typeof p.part === 'string' && p.part.trim()).map((p) => p.part.trim());
      if (undone.length) return undone.join('; ').slice(0, 200);
      if (r.json.done || !r.json.missing?.trim()) return null;
      return r.json.missing.trim().slice(0, 200);
    } catch { return null; }
  }

  // What it looked at in this message (Read, Search, List, Map, CodeSearch), as the screen names them.
  lookedSince(at) {
    const out = [];
    for (const m of this.messages.slice(at)) {
      for (const c of m.tool_calls ?? []) {
        const name = c.function?.name;
        if (!['Read', 'Search', 'List', 'Map', 'CodeSearch'].includes(name)) continue;
        const shown = display(name, parseArgs(name, c.function?.arguments ?? '').args ?? {});
        out.push(`${shown.label}(${String(shown.arg ?? '').slice(0, 60)})`);
      }
    }
    return out;
  }

  // Fixing a bug, it named the cause or the fix, then went on looking: a note
  // says to make the change now (once; again only after 4 more looks with no
  // change). In the chart bug's High run the cause was in its thinking at
  // 8 minutes and it never changed a line.
  actNow(call, lines) {
    const t = this.turn;
    if (!t?.fixing || t.changed || !LOOKS.has(call.name)) return null;
    t.looks = (t.looks ?? 0) + 1;
    if (t.nudged >= 2 || t.looks < 3 || (t.nudged && t.looks - t.looksAtNudge < 4)) return null;
    const line = lines.filter(namesAFix).at(-1);
    if (!line) return null;
    t.nudged++;
    t.looksAtNudge = t.looks;
    return `You wrote: "${line}" If that is the cause, stop looking and make the smallest change that fixes it now (Read the exact lines first if they are not above). If one thing is still unclear, check only that.`;
  }

  // A check-in while it explores: after CHECK_INS.steps different looks (Read,
  // Search, List, Bash) or CHECK_INS.secs seconds with no change made, it says
  // what it has looked at and asks where to look. The answer steers the next
  // step. The same look again does not count: one file read six times is a
  // loop, which the stuck question handles (and an answer to that one starts
  // this count over, stuckAsk).
  async checkIn(call, signal) {
    const t = this.turn;
    if (!t || !this.checkIns || t.changed || !LOOKS.has(call.name)) return null;
    const args = parseArgs(call.name, call.args).args ?? {};
    const shown = display(call.name, args);
    // Counted by the step itself; listed in plain words (the file's name, the words searched for).
    t.looked.push({ key: `${call.name} ${shown.arg ?? ''}`.trim(), said: lookSaid(call.name, args) });
    const secs = (Date.now() - t.since) / 1000;
    const seen = [...new Set(t.looked.map((l) => l.key))];
    if (seen.length < this.checkIns.steps && secs < this.checkIns.secs) return null;
    const said = [...new Set(t.looked.map((l) => l.said))];
    const q = checkInQuestion(said, secs);
    const { question } = q;
    t.looked = [];
    t.since = Date.now();
    const id = `checkin_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'checkin', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    if (answer.choice === 'no' && !answer.feedback) return { stop: 'declined' }; // "Stop here"
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (!text) return null; // no answer: carry on
    t.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    if (/^(keep going|go on|continue|carry on|yes|ok|okay|y)\W*$/i.test(text)) return { asked: true };
    return { asked: true, text: `[Check-in] You asked whether you are on the right track. The user answered: ${text}\nFollow that.` };
  }

  // One question for a name of the request that the folder does not settle (folder.mjs namesQuestion).
  // What to tell the model, or null (no answer, no one to ask).
  async namesAsk(u, signal) {
    const q = namesQuestion(u);
    const { question } = q;
    const id = `names_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'names', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted || answer?.choice === 'skip') return null;
    const text = String(answer?.text ?? answer?.feedback ?? '').trim();
    if (!text) return null;
    this.turn?.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    const g = u.groups.find((x) => x.key.toLowerCase() === text.toLowerCase() || /^yes\b/i.test(text) && u.groups.length === 1);
    if (/^all of them$/i.test(text)) return u.groups.map((x) => `${x.key} (${x.names.join(', ')})`).join(' and ');
    return g ? `${g.key} (${g.names.join(', ')})` : `"${text}"`;
  }

  // Stuck: the same step again and again, or three tool errors in a row. One question that says what it is
  // working on, what it tried and what came of it; a way out picked, or a hint, goes straight to the model.
  async stuckAsk(why, call, out, signal, { tries = 3 } = {}) {
    const t = this.turn;
    const step = stepSaid(call.name, parseArgs(call.name, call.args).args ?? {});
    const err = errorSaid(call.name, out?.text);
    const plan = t?.planAt != null ? this.todos ?? [] : [];
    const next = plan.find((x) => x.status === 'pending')?.text ?? '';
    const q = stuckQuestion(why, step, err, { tries, goal: plan.find((x) => x.status === 'in_progress')?.text ?? '', result: why === 'repeat' ? sameResultSaid(call.name, String(out?.text ?? '')) : '' });
    const { question } = q;
    const id = `stuck_${Date.now()}`;
    if (t) t.stuckAsks = (t.stuckAsks ?? 0) + 1;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'stuck', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    if (answer.choice === 'skip') return null; // no one to ask: carry on as before
    if (answer.choice === 'no' && !answer.feedback) return { stop: 'declined' }; // "Stop here"
    // You were just asked: the check-in counts from here, so the two never ask about one loop.
    if (t) { t.looked = []; t.since = Date.now(); }
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (!text) return null;
    t?.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    // The ways out: stop; another way ("Keep going" means that too: the same again is what it was doing); skip.
    if (/^stop( here)?\W*$/i.test(text)) return { stop: 'declined' };
    const was = why === 'repeat' ? `You sent the same step ${tries} times (${step}) and nothing changed` : `Three steps in a row failed (the last: ${step})`;
    if (/^(try (a|an)?\s*(different|other|another) way|keep going|go on|continue|carry on|yes|ok|okay|y)\W*$/i.test(text)) return { text: `[Stuck] ${was}. The user says: try a different way. Do not send that step again; reach what it was for another way, or go on to the next step.` };
    if (/^skip( (this|that|the) step| it)?\W*$/i.test(text)) return { text: `[Stuck] ${was}. The user says: skip this step. Leave it and go on with the rest of the request${next ? `; next in your plan: ${next}` : ''}. In your final answer, say that this step was skipped.` };
    return { text: `[Stuck] You were going round in circles and asked the user for a hint. The user answered: ${text}\nFollow that.` };
  }

  // One yes-or-steer question before changing files; yes (or "ok", "go")
  // allows the rest of this message's changes.
  async confirm(plan, signal) {
    const q = planQuestion(plan);
    const { question } = q;
    const id = `plan_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'plan', args: q, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    const text = (answer.text ?? '').trim();
    const yes = answer.choice === 'yes' || answer.choice === 'always' || /^(yes|y|ok|okay|go|go ahead|sure|do it|yep|👍|yes,? go ahead)\W*$/i.test(text);
    if (yes) {
      if (this.turn) this.turn.planOk = true;
      this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || 'yes' } });
      return { ok: true };
    }
    if (answer.choice === 'no' && !answer.feedback && !text) return { ok: false, stop: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || answer.feedback } });
    return { ok: false, feedback: text || answer.feedback };
  }

  // The model's Ask tool: the question goes through the same prompt as a
  // permission (or the answers hook when there is no screen).
  // Several questions (more) are asked one after another, each with its place ("1 of 2").
  async askUser(id, args, shown, signal) {
    this.userHooks?.fire('Notification', { message: `Agentic Coder asks: ${String(args.question ?? '').slice(0, 200)}`, notification_type: 'question' });
    const questions = askedQuestions(args);
    if (!questions.length) questions.push({ question: String(args.question ?? ''), options: [], about: [], recommended: -1, several: false });
    const got = [];
    for (const [i, q] of questions.entries()) {
      const qid = i ? `${id}_${i}` : id;
      const qShown = i ? { label: 'Ask', arg: q.question } : shown;
      this.emit('tool-ask', { id: qid, name: 'Ask', ...qShown });
      const answer = await this.ask({ id: qid, name: 'Ask', args: { ...q, ...(questions.length > 1 ? { step: { at: i + 1, of: questions.length } } : {}) }, prepared: {}, ...qShown });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (answer.choice === 'no' || !answer.text?.trim()) {
        this.emit('tool', { id: qid, name: 'Ask', ...qShown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
        const sofar = got.length ? ` Their answers before that: ${got.map((g) => `${g.question} → ${g.text}`).join('; ')}.` : '';
        return { text: `The user did not answer${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}${sofar}`, error: true, stop: answer.feedback ? null : 'declined' };
      }
      const text = answer.text.trim();
      this.turn?.asked?.push(q.question);
      this.emit('tool', { id: qid, name: 'Ask', ...qShown, view: { kind: 'answer', question: q.question, text } });
      got.push({ question: q.question, text });
    }
    const hint = this.rememberHint('answers');
    if (got.length === 1) return { text: `The user answered: ${got[0].text}${hint ? `\n${hint}` : ''}` };
    return { text: `The user answered:\n${got.map((g, i) => `${i + 1}. ${g.question} → ${g.text}`).join('\n')}${hint ? `\n${hint}` : ''}` };
  }
}
