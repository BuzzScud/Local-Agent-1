// /agents (2 Oct 2026, the owner's ask: "build it all", after Addy Osmani's agent setup and the
// agent-tree screen of Claude Code's /advisor): one request taken through six stages, each a ring
// of four steps the app runs in order, so the tree on the screen (app/agents-tree.mjs) always shows
// what is really happening.
//   01 Define   ask · answer · write · check     a short interview, then SPEC.md and CONSTRAINTS.md
//   02 Plan     look · split · checks · write    tasks/plan.md and tasks/todo.md, then your one yes
//   03 Build    red · green · check · save       per task: a failing test, the least code, the suite,
//                                                a rewind point and the second opinion
//   04 Verify   suite · run · cross · proof      shown, not "should work"
//   05 Review   read · find · show · grade       five areas, each finding with file:line and a fix
//   06 Ship     code · security · tests · merge  three reviewers, one report, GO or NO-GO
// It never commits: every message to the model is a /rewind point already (agent.send), and the
// report says to read git diff. The stop list (agents-guards.mjs) and three misses in a row ask you.
// Everything the model, the commands and the files do goes through a driver, so the tests and
// /agents demo give their own (agents-demo.mjs).
import { EventEmitter } from 'node:events';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { guardStep, GUARD_OPTS } from './agents-guards.mjs';

export const STAGES = [
  { id: 'define', name: 'Define', nodes: ['ASK', 'ANSWER', 'WRITE', 'CHECK'], unit: 'questions' },
  { id: 'plan', name: 'Plan', nodes: ['LOOK', 'SPLIT', 'CHECKS', 'WRITE'], unit: 'parts' },
  { id: 'build', name: 'Build', nodes: ['RED', 'GREEN', 'CHECK', 'SAVE'], unit: 'tasks' },
  { id: 'verify', name: 'Verify', nodes: ['SUITE', 'RUN', 'CROSS', 'PROOF'], unit: 'checks' },
  { id: 'review', name: 'Review', nodes: ['READ', 'FIND', 'SHOW', 'GRADE'], unit: 'areas' },
  { id: 'ship', name: 'Ship', nodes: ['CODE', 'SECURITY', 'TESTS', 'MERGE'], unit: 'reviewers' },
];
export const MAX_TRIES = 3;
export const LIMITS = { lines: 100, files: 3 };
// Ship's fix rounds: a critical finding is offered "Fix it" this many times, then only "Stop here".
export const SHIP_FIXES = 2;
// The files a run writes. One already here that no /agents run wrote is yours: the run asks before it
// writes (keep yours and write its own in .agentic/agents/<run>/, replace them after a copy, or stop).
export const RUN_FILES = ['SPEC.md', 'CONSTRAINTS.md', 'tasks/plan.md', 'tasks/todo.md', 'tasks/review.md', 'tasks/ship.md'];
const RUN_JSON = '.agentic/agents/run.json';
const hashOf = (text) => createHash('sha1').update(String(text ?? '')).digest('hex').slice(0, 16);
const PLAN_MODE = 'Plan mode only reads, and /agents writes its files and the code: leave Plan mode (shift+tab), then /agents again';

// The five areas of a review: the poster's for code, and for math the ones that break numbers.
export const AREAS = {
  code: [['Correctness', 'wrong results, missed cases, the spec not met'], ['Readability', 'names, structure, comments that mislead'], ['Architecture', 'where the code lives, what it couples'], ['Security', 'OWASP: injection, secrets, unchecked input'], ['Performance', 'N+1 calls, work repeated in loops, memory']],
  math: [['Correctness', 'the result against the spec and the reference values'], ['Stability', 'cancellation, overflow, division near zero, convergence'], ['Precision', 'tolerances, floats against exact values, units'], ['Speed', 'complexity, iterations, repeated work'], ['Readability', 'names, the steps of the method, comments that mislead']],
};
export const REVIEWERS = [
  { name: 'code-reviewer', does: 'quality + perf', focus: 'code quality: correctness, readability, architecture, performance (no N+1, no repeated work)' },
  { name: 'security-auditor', does: 'OWASP + secrets', focus: 'security: OWASP issues, secrets in code or logs, unchecked input, unsafe commands' },
  { name: 'test-engineer', does: 'tests + coverage', focus: 'tests: every acceptance check in SPEC.md has a test, edge cases, flaky timing' },
];
// A request about numbers gets the math areas and the math checks.
export const isMathy = (text) => /\b(math\w*|equations?|solver?|numeric\w*|integra\w*|derivative|matri(x|ces)|vectors?|tolerance|precision|proofs?|theorem|formula|orbit\w*|kepler|statistic\w*|probabilit\w*|fft|ode|pde|newton|bisection|series|primes?|residual|eigen\w*|interpolat\w*|regression)\b/i.test(String(text ?? ''));

// The test file a covering command runs, from the project's whole-suite command.
export const isTestFile = (rel) => /(^|\/)(tests?|__tests__|spec)\//.test(rel) || /[._-](test|spec)\.[a-z]+$/i.test(rel) || /^test_.*\.py$/.test(basename(rel));
const q = (s) => (/^[\w./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);
export function coveringCommand(testCmd, file) {
  if (!file) return testCmd;
  if (!testCmd) return /\.py$/.test(file) ? `python3 -m pytest ${q(file)}` : /\.(m?[jt]sx?)$/.test(file) ? `bun test ./${file}` : null;
  if (/^(python3? -m )?pytest\b/.test(testCmd)) return `${testCmd} ${q(file)}`;
  if (/^bun (run )?test\b/.test(testCmd)) return `bun test ./${file}`;
  if (/^npm (run )?test\b/.test(testCmd)) return `npm test -- ${q(file)}`;
  if (/^node --test\b/.test(testCmd)) return `node --test ${q(file)}`;
  if (/^npx (jest|vitest)\b/.test(testCmd)) return `${testCmd} ${q(file)}`;
  return testCmd;
}

// The first {...} in a reply, read as JSON; null when there is none.
export function jsonOf(text) {
  const t = String(text ?? '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  for (let end = t.lastIndexOf('}'); end > start; end = t.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* a shorter one */ }
  }
  return null;
}
const tail = (text, n = 30) => String(text ?? '').trim().split('\n').slice(-n).join('\n');
// The line of a test's output that says what went wrong (pytest's "E   …", an assertion, an error).
export function missOf(out) {
  const lines = String(out ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = lines.filter((l) => /^E\s/.test(l)).pop() ?? lines.filter((l) => /error|assert|expected|received|✗|fail(ed)?:/i.test(l) && !/^\d+ (failed|fail)\b|^=+/.test(l)).pop() ?? lines.pop() ?? '';
  const t = pick.replace(/^E\s+/, '');
  return t.length > 90 ? `${t.slice(0, 89)}…` : t;
}
const firstLine = (text, max = 140) => { const l = String(text ?? '').trim().split('\n').find((x) => x.trim()) ?? ''; return l.length > max ? `${l.slice(0, max - 1)}…` : l; };

const QUESTIONS_SYSTEM = `You help write a spec before any code is written. Ask the 3 to 5 questions whose answers most change what gets built: the goal and who uses it, the inputs and outputs, what counts as done (each answer should become a test), the limits (packages, speed, precision), and what to leave out. For a math or numerical task, ask about the tolerance and the reference values to check against. Give each question 2 short likely answers.
Reply with JSON only: {"questions":[{"q":"the question","options":["an answer","another answer"]}]}`;
const SPEC_SYSTEM = `Write SPEC.md for the request from the user's answers. Markdown with these sections, in this order: "## Goal", "## Inputs and outputs", "## Acceptance checks" (a numbered list; each check is one thing a test can prove), "## Constraints", "## Out of scope". Keep it short. Do not write code. Reply with the file's content only.`;
const PLAN_SYSTEM = `Break the spec into 3 to 8 small tasks, in the order they depend on. Each task is one thin slice that one test can prove, about 100 changed lines at most, in at most 3 files.
Reply with JSON only: {"tasks":[{"title":"a short title","check":"what its test proves, in one line","files":["the files it likely touches"]}]}`;
const FINDINGS_FORMAT = `Report only real problems, each with the input or the line that shows it. Reply with JSON only: {"findings":[{"level":"critical|important|suggestion","at":"file:line","text":"what goes wrong","fix":"the fix, in one line"}]} with an empty list when there is nothing real. Critical means wrong results, lost data or a security hole.`;
const FALLBACK_QUESTIONS = [
  { q: 'What should it do, in one sentence?', options: ['what the request says', 'less: the smallest useful part first'] },
  { q: 'What counts as done?', options: ['the checks I name pass as tests', 'it runs and gives the right output'] },
  { q: 'Anything to leave alone?', options: ['no new packages', 'nothing in particular'] },
];

export class AgentsRun extends EventEmitter {
  // driver: the model, the commands and the files (see the top). request: what you typed after /agents.
  // saved: a state from .agentic/agents/run.json, to go on from its stage.
  constructor({ request, driver, saved = null, now = () => Date.now() }) {
    super();
    this.d = driver;
    this.now = now;
    this.ac = new AbortController();
    this.notes = [];
    this.waiters = [];
    this.s = saved ? { ...saved, gate: null, paused: false, verdict: null, endedAt: null } : {
      id: `${now().toString(36)}`, request: String(request ?? '').trim(), startedAt: now(), endedAt: null,
      math: isMathy(request), model: driver.model ?? 'the model', reviewer: driver.reviewer ?? null,
      stage: 0, item: 0, items: STAGES.map(() => []), stageAt: STAGES.map(() => null),
      nodes: ['todo', 'todo', 'todo', 'todo'], active: [], stepAt: 0, stepEta: 0, tries: 1, miss: '',
      lanes: [], adv: { calls: 0, tokens: 0, last: '', at: null, atTime: 0 },
      log: [], stops: 0, rewind: 0, diff: 0, files: 0, findings: { critical: 0, important: 0, suggestion: 0, fixed: 0 },
      verdict: null, gate: null, paused: false, answers: [], tasks: [], diffs: [], report: [],
    };
    this.s.testCmd = this.s.testCmd ?? driver.testCmd ?? null;
    // On resume Build keeps its task list: what is done stays done.
    this.resumed = Boolean(saved);
  }

  get state() { return this.s; }
  get running() { return Boolean(this.promise) && !this.s.verdict; }
  changed() {
    this.emit('state', this.s);
    try { this.d.save?.(this.s); } catch { /* the run goes on without its file */ }
  }
  log(who, text, tone = '') {
    this.s.log.push({ t: this.now(), s: this.s.stage, who, text: String(text), tone });
    if (this.s.log.length > 200) this.s.log.splice(0, this.s.log.length - 200);
    this.changed();
  }
  lanes(list) { this.s.lanes = list.map((l) => ({ status: 'wait', ...l })); this.changed(); }
  lane(i, status, does) { const l = this.s.lanes[i]; if (!l) return; l.status = status; if (does) l.does = does; this.changed(); }

  // ---- what you do while it runs ----
  pause() { this.s.paused = true; this.changed(); }
  resume() { this.s.paused = false; this.changed(); for (const w of this.waiters.splice(0)) w(); }
  stop() { this.ac.abort(); this.resume(); if (this.s.gate) this.answer(-1); }
  // A message you type while it runs goes with the next step it sends the model.
  note(text) { this.notes.push(String(text)); this.log('you', text); }
  // The answer to the question it is waiting on: n is the option, text what you typed (option "type").
  answer(n, text = '') {
    const g = this.s.gate;
    if (!g) return;
    this.s.gate = null;
    this.changed();
    g.resolve({ n, text });
  }
  ask(gate) {
    return new Promise((resolve) => {
      this.s.gate = { sel: 0, ...gate, resolve };
      this.changed();
    }).then((r) => { if (this.ac.signal.aborted) throw new Error('stopped'); return r; });
  }
  async gap() {
    if (this.ac.signal.aborted) throw new Error('stopped');
    if (this.s.paused) await new Promise((r) => this.waiters.push(r));
    if (this.ac.signal.aborted) throw new Error('stopped');
  }

  // ---- the ring ----
  enter(k, items, { keep = false } = {}) {
    const s = this.s;
    s.stage = k; s.item = 0;
    if (!keep) s.items[k] = items.map((x) => ({ state: 'todo', ...x }));
    if (!keep || s.stageAt[k] == null) s.stageAt[k] = this.now();
    s.nodes = ['todo', 'todo', 'todo', 'todo']; s.active = []; s.tries = 1; s.miss = '';
    this.log('main', `${String(k + 1).padStart(2, '0')} ${STAGES[k].name}`, 'stage');
  }
  begin(i) {
    const s = this.s, it = s.items[s.stage][i];
    s.item = i; it.state = 'now'; it.t0 = this.now();
    s.nodes = ['todo', 'todo', 'todo', 'todo']; s.active = []; s.tries = 1; s.miss = '';
    this.changed();
  }
  finishItem(state = 'done', patch = {}) {
    const it = this.s.items[this.s.stage][this.s.item];
    Object.assign(it, { state, t1: this.now() }, patch);
    this.changed();
  }
  async node(n, etaMs = 20_000) {
    await this.gap();
    this.s.nodes[n] = 'now'; this.s.active = [n]; this.s.stepAt = this.now(); this.s.stepEta = etaMs;
    this.changed();
  }
  done(n, state = 'done') { this.s.nodes[n] = state; this.s.active = this.s.active.filter((x) => x !== n); this.changed(); }

  // ---- the model, through the driver ----
  async think(system, user, { maxTokens = 1500 } = {}) {
    return this.d.complete({ system, user, maxTokens, signal: this.ac.signal });
  }
  async send(text, shown, kind = 'change') {
    const note = this.notes.length ? `Notes from the user for this step:\n${this.notes.splice(0).map((n) => `- ${n}`).join('\n')}\n\n` : '';
    const r = await this.d.send(`${note}${text}`, { shown, signal: this.ac.signal, kind });
    if (r?.diff) this.s.diffs.push(r.diff);
    if (this.ac.signal.aborted || r?.reason === 'interrupted') throw new Error('stopped');
    return r ?? {};
  }
  async exec(cmd) { return this.d.exec(cmd, { signal: this.ac.signal }); }
  // The second opinion: the review model from /subagents, or the main model with a fresh context.
  async doubt(at, request, diff) {
    this.s.adv.at = at; this.s.adv.atTime = this.now(); this.changed();
    const r = await this.d.review({ request, diff, signal: this.ac.signal });
    const adv = this.s.adv;
    adv.calls++; adv.tokens += r?.tokens ?? Math.round((String(request).length + String(diff).length) / 3.6) + 400;
    adv.last = r?.ok ? (r.note ?? 'nothing wrong found') : (r?.findings ?? []).join('; ');
    adv.at = at; adv.atTime = this.now();
    this.log('2nd opinion', `${at === 'plan' ? 'before the plan' : at === 'miss' ? 'after a miss' : 'before done'}: ${adv.last}`);
    return r ?? { ok: true, findings: [] };
  }
  wholeDiff() { return this.s.diffs.join('\n').slice(-24_000); }
  // The run's own files: at the top of the project, or in .agentic/agents/<run>/ when you kept yours.
  where(rel) { return this.s.place ? `${this.s.place}/${rel}` : rel; }
  get(rel) { return this.d.read?.(this.where(rel)) ?? null; }
  put(rel, text) {
    this.d.write?.(this.where(rel), text);
    (this.s.wrote ??= {})[this.where(rel)] = hashOf(text);
  }
  // Before the first write: your own SPEC.md or tasks files (not written by an earlier /agents run here,
  // as its run file says) are never replaced without asking.
  async yours() {
    const s = this.s;
    if (s.place !== undefined) return;
    const there = (rel) => (this.d.has ? this.d.has(rel) : this.d.read?.(rel) != null);
    const theirs = RUN_FILES.filter((f) => there(f) && s.wrote?.[f] !== hashOf(this.d.read?.(f) ?? ''));
    s.place = '';
    if (!theirs.length) return;
    const dir = `.agentic/agents/${s.id}`;
    this.log('stop', `Your files are here: ${theirs.join(', ')}`, 'warn');
    const { n } = await this.ask({ kind: 'files', title: 'Your files are here', detail: `${theirs.join(', ')} ${theirs.length === 1 ? 'is' : 'are'} here, and no /agents run wrote ${theirs.length === 1 ? 'it' : 'them'}. Keep yours and this run writes all its files in ${dir}/, or replace them after a copy in .agentic/agents/kept/${s.id}/.`, opts: ['Keep mine (this run writes its files in .agentic/agents/)', 'Replace them (yours are copied to .agentic/agents/kept/ first)', 'Stop'] });
    if (n === 0) { s.place = dir; this.log('you', `keep mine: this run's files are in ${dir}/`); return; }
    if (n === 1) {
      for (const f of theirs) this.d.write?.(`.agentic/agents/kept/${s.id}/${f}`, this.d.read?.(f) ?? '');
      this.log('you', `replace them: yours are in .agentic/agents/kept/${s.id}/`);
      return;
    }
    s.verdict = { kind: 'stopped', why: `you stopped it: your ${theirs.join(', ')} ${theirs.length === 1 ? 'is' : 'are'} as ${theirs.length === 1 ? 'it was' : 'they were'}` };
    this.ac.abort();
    throw new Error('stopped');
  }

  // ---- the guards: a step on the stop list asks you first ----
  async guard(step) {
    const s = this.s, task = s.stage === 2 ? s.items[2][s.item] : null;
    const hit = guardStep(step, { stage: s.stage, task, cover: this.cover, node: s.active[0], limits: LIMITS, math: s.math });
    if (!hit) { if (task) { s.diff = task.lines ?? 0; s.files = (task.filesTouched ?? []).length; } return null; }
    if (hit.deny) { this.log('stop', hit.deny, 'warn'); return { denied: hit.title, text: hit.deny }; }
    s.stops++;
    const was = s.nodes.slice();
    for (const n of s.active) s.nodes[n] = 'stop';
    s.tripped = hit.key;
    this.log('stop', `${hit.title}: ${hit.detail}`, 'warn');
    const opts = GUARD_OPTS[hit.key] ?? GUARD_OPTS.default;
    const { n, text } = await this.ask({ kind: 'stop', title: `Stop · ${hit.title}`, detail: hit.detail, opts, typeAt: 2 });
    s.tripped = null; s.nodes = was; this.changed();
    // Once is once: the same step later asks again. A big diff allowed still counts its lines.
    if (n === 1) { if (task && hit.lines != null) { task.lines = hit.lines; task.filesTouched = hit.files; } this.log('you', 'allowed it this once'); return null; }
    const said = n === 2 && text ? text : null;
    this.log('you', said ?? opts[0]);
    return { denied: `${hit.title}: you said no`, text: `The user said no to this step (${hit.title}: ${hit.detail}).${said ? ` They said: ${said}` : ' Do it another way, without it.'}` };
  }

  // ---- the run ----
  start(from = this.s.stage ?? 0) {
    this.d.setGuard?.((step) => this.guard(step));
    this.d.reviewInTurn?.(false);
    this.promise = this.run(from).finally(() => { this.d.setGuard?.(null); this.d.reviewInTurn?.(true); });
    return this.promise;
  }
  async run(from) {
    const stages = [() => this.define(), () => this.plan(), () => this.build(), () => this.verify(), () => this.review(), () => this.ship()];
    // What earlier /agents runs here wrote (their run file), read before this run saves its own.
    this.s.wrote ??= { ...(jsonOf(this.d.read?.(RUN_JSON))?.wrote ?? {}) };
    try {
      // Plan mode turns every edit away: said once, up front, instead of at each step.
      if (this.d.mode === 'plan') this.s.verdict = { kind: 'stopped', why: PLAN_MODE };
      else for (let k = from; k < STAGES.length; k++) await stages[k]();
      if (!this.s.verdict) this.s.verdict = { kind: 'go' };
    } catch (e) {
      if (!this.ac.signal.aborted && e?.message !== 'stopped') { this.s.verdict = { kind: 'failed', why: String(e?.message ?? e).slice(0, 200) }; this.log('stop', `/agents stopped: ${this.s.verdict.why}`, 'bad'); }
      else this.s.verdict ??= { kind: 'stopped', why: `you stopped it in ${STAGES[this.s.stage].name}` };
    }
    this.s.active = []; this.s.gate = null; this.s.endedAt = this.now();
    this.log('main', this.verdictLine(), this.s.verdict.kind === 'go' ? 'good' : 'warn');
    try { this.d.save?.(this.s, { now: true }); } catch { /* the run ends without its file */ }
    this.emit('end', this.s);
    return this.s;
  }
  verdictLine() {
    const v = this.s.verdict, f = this.s.findings;
    if (v.kind === 'go') return `GO · ${f.critical} critical${f.fixed ? ' (fixed)' : ''} · ${f.important} important · ${f.suggestion} suggestions · nothing committed`;
    if (v.kind === 'nogo') return `NO-GO · ${v.why}`;
    return `${v.kind === 'failed' ? 'FAILED' : 'STOPPED'} · ${v.why} · nothing committed`;
  }

  // 01 Define: the interview, then SPEC.md and CONSTRAINTS.md.
  async define() {
    const s = this.s;
    await this.yours();
    this.lanes([{ name: 'explorer', does: 'reads the project' }, { name: 'worker', does: 'waits for the plan' }, { name: 'checker', does: 'checks SPEC.md' }]);
    this.enter(0, [{ title: 'the questions' }]);
    this.begin(0);
    await this.node(0, 15_000);
    this.lane(0, 'run');
    const files = (this.d.listFiles?.() ?? []).slice(0, 60).join('\n');
    let qs = jsonOf(await this.think(QUESTIONS_SYSTEM, `The request: ${s.request}\n\nThe project's files:\n${files || '(an empty folder)'}`, { maxTokens: 900 }))?.questions;
    if (!Array.isArray(qs) || !qs.length) qs = FALLBACK_QUESTIONS;
    qs = qs.slice(0, 5).map((x) => ({ q: String(x.q ?? x.question ?? '').trim(), options: (x.options ?? []).map(String).slice(0, 2) })).filter((x) => x.q);
    this.lane(0, 'done');
    s.items[0] = qs.map((x) => ({ state: 'todo', title: x.q, q: x.q, options: x.options }));
    s.answers = [];
    for (let i = 0; i < qs.length; i++) {
      this.begin(i);
      await this.node(0, 3000);
      this.log('main', qs[i].q);
      this.done(0);
      await this.node(1, 60_000);
      const opts = [...qs[i].options, 'Something else (type it)'];
      const { n, text } = await this.ask({ kind: 'ask', title: `Question ${i + 1} of ${qs.length}`, detail: qs[i].q, opts, typeAt: opts.length - 1 });
      const ans = n === opts.length - 1 ? (text || 'no answer') : opts[n] ?? 'no answer';
      s.answers.push({ q: qs[i].q, a: ans });
      s.items[0][i].answer = ans;
      this.log('you', ans);
      this.done(1);
      await this.node(2, 1000); this.done(2);
      await this.node(3, 1000); this.done(3);
      this.finishItem('done');
    }
    // SPEC.md from the answers, written by the app (the model only writes its text).
    this.lane(1, 'run', 'writes SPEC.md');
    const qa = s.answers.map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n\n');
    let spec = String(await this.think(SPEC_SYSTEM, `The request: ${s.request}\n\nThe user's answers:\n${qa}\n\nThe project's files:\n${files}`, { maxTokens: 1500 }) ?? '').trim();
    spec = spec.replace(/^```\w*\n?|```\s*$/g, '').trim();
    if (!/acceptance/i.test(spec)) spec += `\n\n## Acceptance checks\n1. ${s.request}`;
    this.put('SPEC.md', `# ${s.request}\n\n${spec.replace(/^# .*\n+/, '')}\n`);
    this.put('CONSTRAINTS.md', [
      '# Constraints', '', 'The quality bar /agents holds this work to.', '',
      '- Every task starts with a failing test, then the least code to pass it.',
      `- At most ${LIMITS.lines} changed lines and ${LIMITS.files} files a task; more asks first.`,
      '- No new packages without asking. No change to a test\'s expected value or tolerance without asking.',
      '- Auth, payments, deploys, migrations, secrets and deletions ask first.',
      '- Nothing is committed: each step is a /rewind point; you commit after reading git diff.',
      ...s.answers.filter((x) => /packag|tolerance|precision|leave|limit|constraint/i.test(`${x.q} ${x.a}`)).map((x) => `- ${x.q} ${x.a}`),
      '',
    ].join('\n'));
    this.lane(1, 'done'); this.lane(2, 'done');
    s.math = s.math || isMathy(`${spec} ${qa}`);
    this.log('main', 'SPEC.md and CONSTRAINTS.md written');
  }

  // 02 Plan: tasks/plan.md and tasks/todo.md, the second opinion, then your one yes.
  async plan(change = '') {
    const s = this.s;
    this.lanes([{ name: 'explorer', does: 'reads SPEC.md' }, { name: 'worker', does: 'waits for your yes' }, { name: 'checker', does: 'a test per task' }]);
    this.enter(1, [{ title: 'SPEC.md' }, { title: 'the tasks' }, { title: 'their checks' }, { title: 'tasks/plan.md' }]);
    const spec = this.get('SPEC.md') ?? s.request;
    this.begin(0); await this.node(0, 3000); this.lane(0, 'run'); this.done(0); this.lane(0, 'done'); this.finishItem();
    this.begin(1); await this.node(1, 30_000);
    const files = (this.d.listFiles?.() ?? []).slice(0, 60).join('\n');
    let tasks = jsonOf(await this.think(PLAN_SYSTEM, `SPEC.md:\n${spec}\n\nThe project's files:\n${files}${change ? `\n\nThe user asked for this change to the plan: ${change}` : ''}`, { maxTokens: 1500 }))?.tasks;
    if (!Array.isArray(tasks) || !tasks.length) tasks = [{ title: s.request.slice(0, 60), check: 'the request works as SPEC.md says', files: [] }];
    tasks = tasks.slice(0, 8).map((t) => ({ title: String(t.title ?? 'a task').slice(0, 80), check: String(t.check ?? t.test ?? '').slice(0, 160) || 'it works', files: (t.files ?? []).map(String).slice(0, 3) }));
    this.done(1); this.finishItem('done', { n: tasks.length });
    this.begin(2); await this.node(2, 2000); this.lane(2, 'run'); this.done(2); this.lane(2, 'done'); this.finishItem();
    this.begin(3); await this.node(3, 2000);
    s.tasks = tasks;
    const plan = ['# Plan', '', `For: ${s.request}`, '', ...tasks.map((t, i) => `${i + 1}. **${t.title}** · check: ${t.check}${t.files.length ? ` · ${t.files.join(', ')}` : ''}`), ''].join('\n');
    this.put('tasks/plan.md', plan);
    this.writeTodo();
    this.done(3); this.finishItem();
    this.log('main', `tasks/plan.md: ${tasks.length} tasks`);
    // The second opinion reads the plan before you say yes.
    const r = await this.doubt('plan', `Check this plan against the spec. Is a part of the spec missing, or a task too big?\n\nSPEC.md:\n${spec}`, plan);
    const said = r.ok ? '' : ` The second opinion says: ${r.findings.join('; ')}.`;
    let detail = `${tasks.length} tasks in tasks/plan.md, each with its check.${said} Only 1 builds it: "looks fine" is not a yes.`;
    for (;;) {
      const { n, text } = await this.ask({ kind: 'plan', title: 'Approve the plan', detail, opts: ['Yes, build it', 'Change it (type how)', 'Show the plan'], typeAt: 1 });
      if (n === 0) { this.log('you', 'yes, build it'); break; }
      if (n === 1) { this.log('you', text || 'change it'); return this.plan(text); }
      detail = tasks.map((t, i) => `${i + 1} ${t.title}`).join(' · ');
    }
  }
  writeTodo() {
    const s = this.s;
    this.put('tasks/todo.md', ['# To do', '', ...s.tasks.map((t, i) => `- [${s.items[2]?.[i]?.state === 'done' ? 'x' : ' '}] ${i + 1}. ${t.title}`), ''].join('\n'));
  }

  // 03 Build: every task test-first, in order.
  async build(only = null) {
    const s = this.s;
    // Resumed in Build: the task list stays, done stays done, a task caught half-way starts again from its test.
    const keep = only === null && this.resumed && s.stage === 2 && s.items[2]?.length > 0;
    if (only === null) this.enter(2, s.tasks.map((t) => ({ title: t.title, check: t.check, files: t.files, tries: 1, doubt: null })), { keep });
    if (keep) this.log('main', `resumed: ${s.items[2].filter((t) => t.state === 'done').length} of ${s.items[2].length} tasks were done`);
    this.lanes([{ name: 'explorer', does: 'finds the spot' }, { name: 'worker', does: 'edits + tests' }, { name: 'checker', does: s.math ? 'suite + math' : 'suite + build' }]);
    for (let i = only ?? 0; i < s.items[2].length; i++) {
      if (only !== null && i !== only) break;
      if (s.items[2][i].state === 'done') continue;
      await this.task(i);
      this.writeTodo();
    }
  }
  async task(i) {
    const s = this.s, t = s.items[2][i], n = s.items[2].length, name = `task ${i + 1}/${n}`;
    // Caught half-way by a stop (resume): its failing test is written, so it starts again from there.
    const again = t.state === 'now' && t.test ? t.test : null;
    this.begin(i);
    t.lines = 0; t.filesTouched = []; s.diff = 0; s.files = 0;
    this.cover = null;
    // RED: one failing test, nothing else. No test file: asked once more, then the task stays open.
    // A test that passes before any code: asked once to fail for the right reason, then "already true".
    await this.node(0, 40_000);
    this.lane(0, 'run'); this.lane(1, 'run');
    let testFile = again;
    if (!again) {
      const red = await this.send(`/agents · ${name}: ${t.title}\nWrite ONE new failing test for this check: ${t.check}\nPut it where this project keeps its tests, in their style. Change only test files: do not write the code yet, and do not run the whole suite.`, `/agents · ${name} · red · ${t.title}`);
      testFile = (red.files ?? []).find(isTestFile) ?? null;
      if (!testFile) {
        this.log('checker', 'no test file was written: asked once more', 'warn');
        const more = await this.send(`/agents · ${name}: no test file was written. Write ONE new failing test for this check now, in a test file where this project keeps its tests: ${t.check}\nChange only test files: do not write the code yet.`, `/agents · ${name} · red · again`);
        testFile = (more.files ?? []).find(isTestFile) ?? null;
      }
    } else this.log('main', `${name}: back to its failing test, ${again}`);
    this.lane(0, 'done');
    if (!testFile) {
      this.done(0, 'miss'); this.lane(1, 'wait');
      this.log('stop', `${name}: no test written, so it stays open`, 'warn');
      this.finishItem('open', { why: 'no test written' });
      return;
    }
    this.cover = testFile;
    t.test = testFile;
    // Its own covering run: just its test file. The whole suite is never a task's own test.
    const cover = coveringCommand(s.testCmd, testFile);
    const cmd = cover && cover !== s.testCmd ? cover : null;
    let already = false;
    if (cmd && !again) {
      this.lane(2, 'run');
      let r = await this.exec(cmd);
      this.log('checker', `${cmd}: ${r.code === 0 ? 'passes already' : 'fails, as it should'}`);
      if (r.code === 0) {
        await this.send(`/agents · ${name}: the new test in ${testFile} passes already, before any code. Change it so it fails for the reason its check is about (${t.check}): it must fail now and pass once the code is right. Change only the test.`, `/agents · ${name} · red · make it fail`);
        r = await this.exec(cmd);
        already = r.code === 0;
        this.log('checker', `${cmd}: ${already ? 'still passes: already true, no code step' : 'fails, as it should'}`, already ? 'warn' : '');
      }
      this.lane(2, 'wait');
    } else if (!cmd) this.log('main', `no command runs ${testFile} alone: its check is the whole suite after the code`, 'warn');
    this.done(0);
    // GREEN: the least code, up to three tries; then it asks you. Skipped when it is already true.
    if (already) t.already = true;
    let tries = 0;
    let why = '';
    for (;;) {
      if (already) break;
      await this.node(1, 60_000);
      this.lane(1, 'run');
      const ask = tries === 0
        ? `/agents · ${name}: ${t.title}\nMake ${testFile ? `the new test in ${testFile}` : 'the check'} pass with the least code: ${t.check}\nDo not change the test. Do not run the whole suite.`
        : `/agents · ${name}: the test still fails (try ${tries + 1} of ${MAX_TRIES}):\n${tail(why)}\nFind the cause and fix the code, not the test.`;
      await this.send(ask, `/agents · ${name} · green · try ${tries + 1}`);
      const r = cmd ? await this.exec(cmd) : { code: 0, out: '' };
      if (r.code === 0) { this.log('checker', cmd ? `${cmd}: passes` : 'done'); break; }
      tries++;
      why = r.out;
      s.miss = missOf(r.out) || 'the test fails';
      t.tries = s.tries = tries + 1;
      this.done(1, 'miss');
      this.lane(1, 'bad');
      this.log('checker', `${cmd}: fails: ${s.miss}`, 'bad');
      if (tries < MAX_TRIES) {
        const adv = await this.doubt('miss', `Task: ${t.title}. Check: ${t.check}. The test fails like this:\n${tail(r.out, 20)}\nWhat is the likely cause, in one line?`, this.wholeDiff().slice(-8000));
        if (!adv.ok) this.notes.push(`A second opinion on the miss: ${adv.findings.join('; ')}`);
        continue;
      }
      this.s.nodes[1] = 'stop';
      s.stops++;
      s.tripped = 'tries';
      this.log('stop', `Test won't pass: ${MAX_TRIES} tries, ${s.miss}`, 'warn');
      const { n: pick, text } = await this.ask({ kind: 'stop', title: "Stop · Test won't pass", detail: `${MAX_TRIES} tries, and ${cmd} still fails: ${s.miss}`, opts: ['Give it a hint (type it)', 'Leave the task open and go on', 'Stop /agents'], typeAt: 0 });
      s.tripped = null;
      if (pick === 2 || pick < 0) { this.ac.abort(); throw new Error('stopped'); }
      if (pick === 1) { this.log('you', 'leave it open'); this.finishItem('open'); return; }
      this.log('you', text || 'try once more');
      this.notes.push(text || 'Try once more, a different way.');
      tries = MAX_TRIES - 1;
    }
    this.done(1);
    this.lane(1, 'done');
    // CHECK: the whole suite (a failure goes back to the model, as a try).
    await this.node(2, 30_000);
    this.lane(2, 'run');
    if (s.testCmd) {
      let r = await this.exec(s.testCmd);
      if (r.code !== 0) {
        this.log('checker', `${s.testCmd}: fails`, 'bad');
        await this.send(`/agents · ${name}: the whole suite fails after this change:\n${tail(r.out)}\nFix it without changing what the tests check.`, `/agents · ${name} · check`);
        r = await this.exec(s.testCmd);
      }
      this.log('checker', `${s.testCmd}: ${r.code === 0 ? 'all pass' : 'still fails'}`, r.code === 0 ? '' : 'bad');
      if (r.code !== 0) t.suiteFails = true;
    }
    this.lane(2, 'done');
    this.done(2);
    // SAVE: its rewind point (each message is one), then the second opinion before it counts as done.
    await this.node(3, 20_000);
    s.rewind++;
    this.log('main', `rewind point ${s.rewind} · nothing committed`);
    t.doubt = 'wait'; this.changed();
    const d = await this.doubt('done', `Task: ${t.title}\nIts check: ${t.check}\nIs it true that the change does this, and nothing else is broken?`, s.diffs.slice(-3).join('\n').slice(-12_000));
    if (!d.ok && d.findings.length) {
      await this.send(`/agents · ${name}: a second opinion read this change and thinks (it can be wrong):\n${d.findings.map((f) => `- ${f}`).join('\n')}\nCheck each one; fix what is real, and say in one line why the rest is fine.`, `/agents · ${name} · doubt`);
      if (cmd) await this.exec(cmd);
      t.doubt = 'fixed';
    } else t.doubt = 'held';
    this.done(3);
    this.finishItem(t.suiteFails ? 'open' : 'done');
  }

  // 04 Verify: the suite, the request run the way you would, a second way, the proof.
  async verify() {
    const s = this.s;
    this.enter(3, [{ title: 'the whole suite' }, { title: 'run it as you would' }, { title: s.math ? 'the same, two ways' : 'the edge cases' }, { title: 'before and after' }]);
    this.lanes([{ name: 'explorer', does: 'waits' }, { name: 'worker', does: 'runs it live' }, { name: 'checker', does: s.math ? 'suite + two ways' : 'suite + edges' }]);
    this.begin(0); await this.node(0, 30_000); this.lane(2, 'run');
    const suite = s.testCmd ? await this.exec(s.testCmd) : { code: 0, out: 'no test command' };
    this.log('checker', `${s.testCmd ?? 'tests'}: ${suite.code === 0 ? 'all pass' : 'fails'}`, suite.code === 0 ? '' : 'bad');
    this.done(0); this.lane(2, 'wait'); this.finishItem(suite.code === 0 ? 'done' : 'open', { result: suite.code === 0 ? 'all pass' : 'fails' });
    this.begin(1); await this.node(1, 60_000); this.lane(1, 'run');
    const run = await this.send('/agents · verify: show that the request works the way the user would use it. Run it once (the command, the script, or the check a page needs) and report the exact output. Do not change files.', '/agents · verify · run it', 'question');
    this.log('worker', firstLine(run.text) || 'ran it');
    this.done(1); this.lane(1, 'done'); this.finishItem('done', { result: firstLine(run.text, 60) });
    this.begin(2); await this.node(2, 60_000); this.lane(2, 'run');
    const cross = await this.send(s.math
      ? '/agents · verify: check one result a second, independent way (another method, a brute-force or closed-form check) and report both numbers and how far apart they are. Do not change files.'
      : `/agents · verify: try the edge cases ${this.where('SPEC.md')} names (empty, missing, too big, the first and the last) and report each result. Do not change files.`, `/agents · verify · ${s.math ? 'two ways' : 'edge cases'}`, 'question');
    this.log('checker', firstLine(cross.text) || 'checked');
    this.done(2); this.lane(2, 'done'); this.finishItem('done', { result: firstLine(cross.text, 60) });
    this.begin(3); await this.node(3, 2000);
    const open = s.items[2].filter((t) => t.state === 'open').length;
    this.log('main', `proof: ${s.items[2].length - open} of ${s.items[2].length} tasks shown by their tests${open ? `, ${open} open` : ''}`);
    this.done(3); this.finishItem();
  }

  // 05 Review: five areas, each finding with file:line and a fix; a critical one goes back to Build.
  async review() {
    const s = this.s, areas = AREAS[s.math ? 'math' : 'code'];
    this.enter(4, areas.map(([title, hint]) => ({ title, hint })));
    this.lanes([{ name: 'explorer', does: 'reads the diff' }, { name: 'worker', does: 'finds an input' }, { name: 'checker', does: 'tries to break' }]);
    const spec = this.get('SPEC.md') ?? s.request;
    const lines = ['# Review', ''];
    for (let i = 0; i < areas.length; i++) {
      const [area, hint] = areas[i];
      this.begin(i);
      await this.node(0, 3000); this.lane(0, 'run'); this.done(0); this.lane(0, 'done');
      await this.node(1, 30_000); this.lane(2, 'run');
      const f = (jsonOf(await this.think(`You review a finished change for one area: ${area} (${hint}). ${FINDINGS_FORMAT}`, `The request: ${s.request}\n\nSPEC.md:\n${spec.slice(0, 4000)}\n\nThe change:\n${this.wholeDiff() || '(no diff kept)'}`, { maxTokens: 900 }))?.findings ?? [])
        .filter((x) => x && x.text).slice(0, 3).map((x) => ({ level: ['critical', 'important', 'suggestion'].includes(x.level) ? x.level : 'suggestion', at: String(x.at ?? ''), text: String(x.text), fix: String(x.fix ?? '') }));
      this.done(1); this.lane(2, 'done');
      await this.node(2, 1500); this.lane(1, 'run'); this.done(2); this.lane(1, 'done');
      await this.node(3, 1500);
      for (const x of f) { s.findings[x.level]++; this.log('explorer', `${x.level} · ${x.at} · ${x.text}`, x.level === 'critical' ? 'bad' : x.level === 'important' ? 'warn' : ''); }
      lines.push(`## ${area}`, '', ...(f.length ? f.map((x) => `- **${x.level}** ${x.at}: ${x.text}${x.fix ? ` · fix: ${x.fix}` : ''}`) : ['- nothing found']), '');
      this.done(3);
      this.finishItem('done', { findings: f, flag: f[0]?.level ?? 'none' });
      const crit = f.find((x) => x.level === 'critical');
      if (crit) await this.fix(crit, 4);
    }
    this.put('tasks/review.md', lines.join('\n'));
  }
  // A critical finding: one fix task in Build, then back where it came from.
  async fix(f, back) {
    const s = this.s, keep = { items: s.items[back], item: s.item, lanes: s.lanes };
    this.log('main', `critical: back to Build for one fix, then ${STAGES[back].name} again`, 'bad');
    s.tasks.push({ title: `Fix: ${f.text}`.slice(0, 80), check: f.fix || `${f.text} no longer happens`, files: [] });
    s.items[2].push({ title: `Fix: ${f.text}`.slice(0, 80), check: f.fix || `${f.text} no longer happens`, state: 'todo', tries: 1, doubt: null });
    s.stage = 2;
    this.lanes([{ name: 'explorer', does: 'finds the spot' }, { name: 'worker', does: 'edits + tests' }, { name: 'checker', does: s.math ? 'suite + math' : 'suite + build' }]);
    await this.task(s.items[2].length - 1);
    s.findings.fixed++;
    s.stage = back; s.items[back] = keep.items; s.item = keep.item; s.lanes = keep.lanes;
    s.nodes = ['done', 'done', 'done', 'done']; s.active = [];
    this.changed();
  }

  // 06 Ship: three reviewers, one report, GO or NO-GO, and how to roll it back.
  async ship() {
    const s = this.s;
    this.enter(5, REVIEWERS.map((r) => ({ title: r.name })).concat([{ title: 'merged report' }]));
    this.lanes(REVIEWERS.map((r) => ({ name: r.name, does: r.does })));
    const spec = this.get('SPEC.md') ?? s.request;
    const all = [];
    s.nodes = ['now', 'now', 'now', 'todo']; s.active = [0, 1, 2]; s.stepAt = this.now(); s.stepEta = 60_000;
    for (let i = 0; i < 3; i++) { s.items[5][i].state = 'now'; this.lane(i, 'run'); }
    // One after another on one model; the tree shows them all at work, as they are in line together.
    for (let i = 0; i < 3; i++) {
      await this.gap();
      const r = REVIEWERS[i];
      const f = (jsonOf(await this.think(`You are the ${r.name}. Review the finished change for ${r.focus}. ${FINDINGS_FORMAT}`, `The request: ${s.request}\n\nSPEC.md:\n${spec.slice(0, 4000)}\n\nThe change:\n${this.wholeDiff() || '(no diff kept)'}`, { maxTokens: 900 }))?.findings ?? []).filter((x) => x && x.text).slice(0, 3);
      const bad = f.some((x) => x.level === 'critical');
      all.push(...f.map((x) => ({ ...x, by: r.name })));
      s.nodes[i] = bad ? 'miss' : 'done'; s.active = s.active.filter((x) => x !== i);
      s.items[5][i].state = 'done'; s.items[5][i].result = f.length ? `${f.length} finding${f.length === 1 ? '' : 's'}${bad ? ', critical' : ''}` : 'nothing found';
      this.lane(i, bad ? 'bad' : 'done');
      this.log(r.name, s.items[5][i].result, bad ? 'bad' : '');
    }
    this.begin(3); await this.node(3, 3000);
    const crit = all.filter((x) => x.level === 'critical');
    const open = s.items[2].filter((t) => t.state === 'open');
    s.report = [
      `# Ship report`, '', `For: ${s.request}`, '',
      `Verdict: ${crit.length ? 'NO-GO' : 'GO'}`, '',
      '## Findings', '', ...(all.length ? all.map((x) => `- ${x.by} · **${x.level}** ${x.at ?? ''}: ${x.text}${x.fix ? ` · fix: ${x.fix}` : ''}`) : ['- nothing found']), '',
      '## Tasks', '', ...s.items[2].map((t, i) => `- ${t.state === 'done' ? '✓' : '○'} ${i + 1}. ${t.title}${t.why ? ` · ${t.why}` : ''}${t.already ? ' · already true: its test passed before any code' : ''}${t.doubt ? ` · second opinion: ${t.doubt}` : ''}`), '',
      '## Rollback', '', '- Nothing was committed. Read `git diff`, then commit what you keep.', `- /rewind goes back to before any step of this run (${s.rewind} task points).`, '',
    ];
    this.put('tasks/ship.md', s.report.join('\n'));
    this.done(3); this.finishItem();
    if (crit.length || open.length) {
      const why = crit.length ? `${crit[0].at ?? ''} ${crit[0].text}`.trim() : `${open.length} task${open.length === 1 ? '' : 's'} left open`;
      // A critical finding: fixing it comes first, SHIP_FIXES times at most (no screen always answers
      // "Fix it"), then only stopping. Tasks left open: stopping there comes first (GO is your call).
      const rounds = s.shipFixes ?? 0, more = rounds < SHIP_FIXES;
      const opts = crit.length ? (more ? ['Fix it, then run Ship again', 'Stop here: NO-GO'] : ['Stop here: NO-GO']) : ['Stop here: NO-GO', 'Go on anyway: GO'];
      const { n } = await this.ask({ kind: 'stop', title: 'NO-GO', detail: crit.length && !more ? `${why}. Still critical after ${rounds} rounds of fixes: Ship stops here.` : `${why}.`, opts });
      const stopHere = n < 0 || opts[n] === 'Stop here: NO-GO';
      if (stopHere) { s.verdict = { kind: 'nogo', why }; return; }
      if (crit.length) { s.shipFixes = rounds + 1; await this.fix({ text: crit[0].text, fix: crit[0].fix }, 5); return this.ship(); }
    }
    s.verdict = { kind: 'go' };
  }
}
