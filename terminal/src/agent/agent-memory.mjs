// The Agent's memory (agent.mjs): facts brought back and saved, the opening read, the maps, Claude's
// notes, a folder's notes and the Remember hint.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { resolvePath } from './tools.mjs';
import { existsSync } from 'node:fs';
import { isHomeFolder } from './prompt.mjs';
import { folderCard, folderKind, namesInRequest } from './folder.mjs';
import { basename, dirname, join } from 'node:path';
import { routeByRules } from '../flows/index.mjs';
import { applyChanges, changeTrust, dirFor, memoryDirs, readFacts } from './facts.mjs';
import { nearFacts, recall, recallNotes, usedFacts } from './recall.mjs';
import { claudeText, notesDir, recallClaude, topicOf } from './claude-notes.mjs';
import { packDir, packView } from './claude-pack.mjs';
import { MAP_DIR, projectFiles } from '../tools/codemap.mjs';
import { applySave, knownAlready, practiceWork, saveLessons, saveLine } from './lessons.mjs';
import { howChosen } from './search.mjs';
import { mapsRead, memorySent, openingOn, openingRead } from './opening.mjs';
import { CORRECTS, SMALL_CTX_NOTES, filesInAnswer, fullPathsIn, tokensOf } from './agent-said.mjs';

export class MemoryPart {
  // Remember at the moments that teach something (4 Oct 2026, the owner's picks: your answers to its
  // questions, your corrections, a fix that worked, a wall it hit): one line, once a moment a message,
  // when the model has the Remember tool (Model way, the memory on and saving).
  rememberHint(kind) {
    const t = this.turn;
    if (!t || this.isHelper || this.lean || this.way !== 'model' || !this.memory || this.memory.saveOff) return '';
    t.remembered ??= new Set();
    if (t.remembered.has(kind)) return '';
    t.remembered.add(kind);
    const what = { answers: 'If one of these answers will hold next time too', corrected: 'If what was wrong will matter again', fixed: 'That worked. If the fix will matter again', wall: 'Once you are past it, if how will matter again' }[kind];
    return what ? `(${what}, save it with Remember: one short sentence.)` : '';
  }

  // The facts that fit this request, found by meaning (or by words when the
  // small model is not here). They go into the request itself.
  // What came along is shown as one "Context" line (ctrl+o lists it): each
  // item with how close it was and what it costs the model to read.
  async remember(text, at, signal) {
    if (!this.memory || this.memory.recall === false) return;
    const t0 = Date.now();
    // Matched on what the request is about, not on how it asks to be answered (claude-notes.mjs topicOf).
    const topic = topicOf(text);
    const r = await recall(this.cwd, topic, { embedder: this.memory.embedder ?? null, home: this.memory.home, signal, retriever: this.search.retriever, reranker: this.reranker });
    if (r.note && !this.memory.told) { this.memory.told = true; this.emit('note', { text: r.note, tone: 'dim' }); }
    const request = this.messages[at];
    let added = 0;
    const goesAlong = (notes) => {
      if (request?.role === 'user' && typeof request.content === 'string') request.content = `${request.content}\n\n(${notes})`;
      this.ctxUsed += tokensOf(notes);
      added += tokensOf(notes);
    };
    const items = [];
    const one = (f) => f.text.replace(/\s+/g, ' ');
    if (r.facts.length) {
      const notes = recallNotes(r.facts);
      goesAlong(notes);
      Object.assign(this.happened, { recalled: r.facts.map((f) => ({ id: f.id, dir: f.dir, text: f.text })), notes });
      this.emit('memory', { facts: r.facts, how: r.how, ms: r.ms });
      for (const f of r.facts) items.push({ from: 'memory', text: one(f), close: f.close, tokens: tokensOf(recallNotes([f])) });
    }
    for (const f of r.skipped ?? []) items.push({ from: 'memory', text: one(f), close: f.close, skipped: 'an event, skipped' });
    const c = await this.rememberClaude(topic, goesAlong, signal);
    for (const n of c?.notes ?? []) items.push({ from: 'Claude', text: n.name.replace(/-/g, ' '), close: n.close, tokens: tokensOf(n.part) });
    // With Claude's notes after it, the request again at the end, so the last thing read is the request
    // (4 Oct 2026: 7,000 characters of notes followed a 420-character request, and a question one of them
    // quoted was taken for it).
    if (c?.notes?.length && request?.role === 'user' && typeof request.content === 'string') {
      const words = String(text).replace(/\s+/g, ' ').trim();
      request.content += `\n\n(This message's request, the one to answer; what is above it is background: "${words.length > 900 ? `${words.slice(0, 899)}…` : words}")`;
    }
    // Said on the line when /effort's Search rows changed how they were chosen.
    const chosen = [r.chosen, c?.chosen].find((x) => x && (x.order === 'hybrid' || x.reranked));
    if (items.length) this.emit('context', { items, tokens: added, ms: Date.now() - t0, how: r.how, ...(chosen ? { chosen: howChosen(chosen, r.how) } : {}) });
  }

  // Claude's notes (claude-notes.mjs): what Claude Code wrote down about the
  // user's work, read where it is. Up to four notes that fit the request
  // go along with it, as the saved facts do (two in a memory of 16k or less,
  // where the request's start must leave room to work: 1 Oct). They are never
  // counted for or against (no trust): Agentic Coder does not change them.
  async rememberClaude(text, goesAlong, signal) {
    const c = this.memory.claude;
    if (!c) return;
    const dir = c === true ? notesDir() : notesDir({ setting: c.dir ?? c });
    if (!dir) return;
    let r;
    // A service that is not the owner's own machine gets only the notes about this project (Memory sent).
    const sent = this.notesSent();
    try { r = await recallClaude(this.cwd, text, { embedder: this.memory.embedder ?? null, dir, store: c.store, kind: routeByRules(text)?.kind ?? null, signal, retriever: this.search.retriever, reranker: this.reranker, top: this.ctx <= 16384 ? SMALL_CTX_NOTES : undefined, sent }); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; return; }
    if (!r.notes.length) return;
    const said = claudeText(r.notes, { pack: Boolean(this.notesView()) });
    goesAlong(said);
    if (this.happened) this.happened.claude = r.notes.map((n) => n.id);
    this.claudeCame = true; // for this message: a step that is turned away points back at the note (runTool)
    this.claudeSaid = said; // which places the notes name (noteNames)
    this.emit('memory', { claude: r.notes.map((n) => ({ id: n.id, name: n.name, type: n.type, ...(n.project ? { project: n.project } : {}), close: n.close, chars: n.part.length })), how: r.how, ms: r.ms, of: r.of, sent });
    return r;
  }

  // A message that corrects Agentic Coder ("no, that is wrong", "undo that") counts
  // against the facts the turn before it used, once.
  corrected(text) {
    const last = this.lessons.at(-1);
    if (!last || last.corrected || !CORRECTS.test(String(text).trim())) return;
    last.corrected = String(text).slice(0, 200);
    last.known = false; // a turn that had to be corrected taught something
    this.trust(last.used ?? last.recalled, -2, 'you corrected Agentic Coder');
  }

  // Of the facts that came with the request, the ones the turn really used:
  // what its steps touched and ran, and its answer (recall.mjs).
  usedThisTurn(h) {
    if (!h.recalled?.length) return [];
    // Only this message's answers: an earlier turn's words are not evidence.
    const from = h.message ? this.messages.indexOf(h.message) : -1;
    const answer = from < 0 ? '' : this.messages.slice(from + 1).filter((m) => m.role === 'assistant' && typeof m.content === 'string').map((m) => m.content).join('\n');
    try { return usedFacts(h.recalled, [...h.did, ...h.files, h.check?.cmd ?? '', String(answer).slice(0, 4000)].join('\n')); } catch { return []; }
  }

  trust(recalled, delta, reason) {
    if (!this.memory || !delta || !recalled?.length) return;
    try { for (const dir of new Set(recalled.map((f) => f.dir))) changeTrust(dir, recalled.filter((f) => f.dir === dir).map((f) => f.id), delta, reason); } catch { /* the memory never stops the work */ }
  }

  // The turn is over: what happened is written down. The facts it used gain
  // trust when the work passed its check, and lose it when the work failed,
  // when Agentic Coder got stuck, or when you stopped it.
  settle(reason) {
    const h = this.happened;
    this.happened = null;
    if (!h || h.small) return null;
    const t = this.turn;
    const checked = h.flow ? h.flow.done : t?.changed && t.testedAfterChange ? t.checkOk : undefined;
    const outcome = reason === 'interrupted' ? 'stopped' : ['stuck', 'limit', 'error'].includes(reason) ? 'stuck' : checked === false ? 'failed' : checked === true ? 'passed' : reason === 'declined' ? 'declined' : 'done';
    const lesson = {
      at: h.at, request: h.request.slice(0, 600), kind: this.way === 'model' ? null : this.lastRoute?.kind ?? routeByRules(h.request)?.kind ?? null, reason, outcome,
      files: [...h.files].slice(0, 12), check: h.check ?? null, tries: h.tries.slice(-6), findings: (t?.findings ?? []).slice(-4), asked: (t?.asked ?? []).slice(-3),
      warnings: h.warnings.slice(-4), summary: h.flow?.summary ?? null, recalled: h.recalled,
      used: this.usedThisTurn(h),
    };
    // A turn that went well on what the memory already holds teaches nothing
    // new: no save is started for it (the review at night still reads it).
    if (this.memory) { try { lesson.known = knownAlready(lesson, { cwd: this.cwd, home: this.memory.home }); } catch { /* then it is saved as usual */ } }
    // Work on the tests' own starter files is practice: never saved (lessons.mjs).
    if (practiceWork(lesson, this.cwd)) lesson.practice = true;
    this.lessons.push(lesson);
    this.lessons = this.lessons.slice(-20);
    const delta = { stopped: -2, stuck: -1, failed: -1, passed: +1 }[outcome] ?? 0;
    this.trust(lesson.used, delta, { stopped: 'you stopped Agentic Coder', stuck: 'Agentic Coder got stuck', failed: 'the task failed its check', passed: 'the task passed its check' }[outcome]);
    this.emit('settled', lesson);
    return lesson;
  }

  // Whether Claude's notes with this request name a place (its last part, as "notes.md" or
  // "MATH"): only then does a step turned away for being outside the folder point back at them.
  // On 3 Oct 2026 a script refused for "/" (a division) was told to answer from an unrelated
  // note, and the model gave up on the user's own files.
  noteNames(where) {
    const last = basename(String(where ?? '').trim().replace(/\/+$/, ''));
    return Boolean(this.claudeCame && last.length > 2 && String(this.claudeSaid ?? '').includes(last));
  }

  // A model on another machine (prompt-files.mjs, the remote set).
  remoteSet() { return (this.rulesSetUsed ?? this.rulesSet()) === 'remote'; }

  // This turn's notes (withTurnNotes) written into its request for good, once the turn is over.
  bakeTurnNotes() {
    const t = this.turn;
    if (!t?.requestMsg || t.baked) return;
    const [m] = this.withTurnNotes([t.requestMsg]);
    if (m !== t.requestMsg) t.requestMsg.content = m.content;
    t.baked = true;
  }

  // The opening read (opening.mjs): once a conversation on the remote set, as a step the model did not
  // have to take, a List of the project folder, and on the screen as "Reading all memory files". A step,
  // because Qwen3.6 writes its first call as plain JSON text ({"file": "convert.mjs"}) when the
  // conversation has no call in it to follow (3 Oct 2026: every hard task, with the read written into
  // the request instead). A List, not the Bash it stands for: given a Bash, it ran git log and ls -la
  // itself twice more and copied the Bash's "description" into its Reads. A trim, the notes or /rewind
  // can take it away: then it comes again.
  giveOpening(text = '') {
    if (this.isHelper || !openingOn() || !this.remoteSet()) return;
    if (this.messages.some((m) => m.opening && !String(m.content).startsWith('[older output removed'))) return;
    let r = null;
    // Facts about the user go in full only to the owner's own other computer (opening.mjs memorySent).
    const sent = memorySent(this.model);
    // The maps go with it (opening.mjs mapsRead): the code map, and Claude's notes as Memory sent allows.
    let maps = null;
    try { maps = mapsRead(this.cwd, { ctx: this.ctx, request: text, notes: this.notesView() }); } catch { /* left out */ }
    try { r = openingRead(this.cwd, { memory: sent === 'none' ? null : this.memory, home: this.memory?.home ?? this.home, you: sent === 'all', maps }); } catch { return; }
    if (!r) return;
    const id = `opening_${Date.now()}`;
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'List', arguments: JSON.stringify({ path: '.' }) } }] });
    this.messages.push({ role: 'tool', tool_call_id: id, content: r.body, opening: true });
    this.ctxUsed += tokensOf(r.body) + 30;
    this.emit('tool', { id, name: 'List', label: r.view.title, arg: r.args.command, view: r.view, given: true });
  }

  // The files an answer names that are not in this project: not at that path, and no file of the
  // project has that name or ends with that path. Left out: files the request names (it may ask
  // about one that is gone), files made this message, places outside the project (~/…, /…).
  missingFiles(text) {
    // From the home folder, the folder the request names stands for the project (turn.workFolder).
    const base = this.turn?.workFolder ?? this.cwd;
    const request = String(this.turn?.request ?? '');
    // A full path into that folder is looked at where it says (4 Oct 2026: answers there name files by their full path).
    const full = this.turn?.workFolder ? fullPathsIn(text, base).filter((p) => !request.includes(p) && !existsSync(p) && !(this.turn?.created ?? []).some((c) => p.endsWith(String(c).replace(/^\.\//, '')))) : [];
    const named = filesInAnswer(text).filter((p) => !/^(~|\/)/.test(p) && !request.includes(p));
    if (!named.length) return full;
    let all = this.turn?.projectFiles;
    if (!all) { try { all = projectFiles(base); } catch { all = []; } if (this.turn) this.turn.projectFiles = all; }
    const made = new Set((this.turn?.created ?? []).map((f) => String(f).replace(/^\.\//, '')));
    const names = new Set(all.map((f) => f.split('/').pop()));
    return named.filter((p) => {
      const rel = p.replace(/^\.\//, '');
      if (made.has(rel) || [...made].some((m) => m.endsWith(`/${rel}`) || m.split('/').pop() === rel)) return false;
      if (existsSync(join(this.cwd, rel)) || existsSync(join(base, rel)) || (/^SCRIPTS\//.test(rel) && existsSync(resolvePath(this.cwd, rel).abs))) return false;
      return rel.includes('/') ? !all.some((f) => f === rel || f.endsWith(`/${rel}`)) : !names.has(rel);
    }).concat(full);
  }

  // What of Claude's notes this model may be given: all of them on this Mac and on the owner's own
  // machine, else only those about this project, or none (opening.mjs memorySent, /remote's Memory sent).
  notesSent() {
    return this.model?.remote ? memorySent(this.model) : 'all';
  }

  // The pack of Claude's notes (claude-pack.mjs) as this model may see it: its map, its topics and
  // notes under NOTES/. null with the notes off, no pack, or nothing this model may see.
  notesView() {
    const c = this.memory?.claude;
    if (!c) return null;
    const named = c === true ? null : c.dir ?? c;
    const dir = typeof named === 'string' ? (existsSync(join(named, 'pack.json')) ? named : existsSync(join(dirname(named), 'pack.json')) ? dirname(named) : null) : packDir();
    if (!dir) return null;
    try { return packView(dir, { sent: this.notesSent(), cwd: this.cwd, home: this.home }); } catch { return null; }
  }

  // The maps for a model of the local set (on this Mac): the code map (docs/map/MAP.md) and Claude's
  // notes map, as much of each as its context has room for, once a conversation, as a step it did
  // not have to take, like the opening read (not counted as conversation: said()). A model of the
  // remote set gets them in its opening read (giveOpening).
  giveMaps(text = '') {
    if (this.isHelper || this.remoteSet() || !openingOn()) return;
    // Once while it is in the conversation; trimmed away or summarized, it comes again.
    if (this.messages.some((m) => m.maps && !String(m.content).startsWith('[older output removed'))) return;
    let maps = null;
    try { maps = mapsRead(this.cwd, { ctx: this.ctx, request: text, notes: this.notesView() }); } catch { return; }
    if (!maps) return;
    const body = `Agentic Coder read these for you before your first step; do not read them again.\n\n${maps.parts.join('\n\n')}`;
    const id = `maps_${Date.now()}`;
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'List', arguments: JSON.stringify({ path: MAP_DIR }) } }] });
    this.messages.push({ role: 'tool', tool_call_id: id, content: body, maps: true });
    this.ctxUsed += tokensOf(body) + 30;
    this.emit('tool', { id, name: 'List', label: 'Reading the maps', arg: maps.commands.join('; '), view: { kind: 'opening', title: 'Reading the maps', command: maps.commands.join('; '), lines: maps.lines, content: body }, given: true });
  }

  // "update memory" with the memory on: the same save that runs on its own
  // (lessons.mjs), now, with what you said to remember.
  async updateFacts(request, started, signal) {
    let reason = 'done';
    try {
      this.emit('flow-step', { index: 0, count: 1, text: 'Updating memory' });
      const out = await saveLessons({ url: this.url, model: this.model, slot: this.slots?.side, use: this.sideUse(), cwd: this.cwd, home: this.memory.home, lessons: this.lessons, messages: this.messages.slice(0, -1), signal, embedder: this.memory.embedder, why: 'update memory', request });
      const lines = [...out.added.map((f) => `- ${f.text}`), ...out.replaced.map((x) => `- ${x.fact.text} (in place of: ${x.old.text})`)];
      const text = lines.length || out.retired.length
        ? `Saved to memory:\n${lines.join('\n')}${out.retired.length ? `${lines.length ? '\n\n' : ''}Taken out of use:\n${out.retired.map((f) => `- ${f.text}`).join('\n')}` : ''}`
        : `Nothing new to remember from this conversation.${out.refused.length ? ` (${out.refused.map((x) => x.why).join('; ')})` : ''}`;
      this.emit('flow-step', null);
      this.messages.push({ role: 'assistant', content: text });
      this.emit('assistant', { text, reasoning: '', secs: out.secs, thinkSecs: 0, tokens: out.tokens, final: true });
      this.emit('note', { text: '/memory shows what is saved · /memory undo takes the last save back', tone: 'dim' });
    } catch (e) {
      this.emit('flow-step', null);
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: `Could not update the memory (${e.message}).`, tone: 'error' }); }
    } finally {
      this.busy = false;
    }
    if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000 });
    return reason;
  }

  // "update memory": the facts worth keeping from this conversation, saved
  // at once (updateFacts). With the memory off ("memory": false) nothing is
  // saved; before 30 Sep 2026 it went to a notes file of its own instead.
  async updateMemory(request, started, signal) {
    if (this.memory) return this.updateFacts(request, started, signal);
    const text = 'The memory is off here ("memory": false in settings.json), so nothing was saved. Take that line out to have Agentic Coder remember.';
    this.messages.push({ role: 'assistant', content: text });
    this.emit('assistant', { text, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
    this.busy = false;
    this.emit('turn-end', { reason: 'done', secs: (Date.now() - started) / 1000 });
    return 'done';
  }

  // Remember (the model decides): one fact saved at once, and a line says what was saved.
  // Nothing is saved from the tests' own practice work, nor with saving off.
  // New replaces old (9 Oct 2026, the owner's pick): the answer lists the saved facts about the
  // same thing, by id; Remember again with `replaces` retires the one the new fact made out of date
  // (moved to retired/, /memory undo brings it back). A rule or a pinned fact is the user's to change.
  async rememberFact(args, seen) {
    const off = !this.memory ? 'the memory is off here ("memory": false in settings.json)'
      : this.memory.saveOff || process.env.AGENTIC_MEMORY_SAVE === 'off' ? 'saving to memory is off here'
      : practiceWork({ request: this.happened?.request ?? '', files: [...(this.happened?.files ?? [])] }, this.cwd) ? 'this is practice work on a test’s own files, which teaches the memory nothing'
      : null;
    if (off) { seen({ kind: 'error', message: 'Not saved' }, true); return { text: `Not saved: ${off}. Carry on.` }; }
    const kind = args.about === 'you' ? 'you' : 'project';
    const text = String(args.fact ?? '');
    const dir = dirFor(memoryDirs(this.cwd, this.memory.home), kind);
    const id = String(args.replaces ?? '').trim();
    const old = id ? readFacts(dir).find((f) => f.id === id) : null;
    const refuse = (why) => { seen({ kind: 'error', message: `Not saved: ${why}` }, true); return { text: `Not saved: ${why}.` }; };
    if (id && !old) return refuse(`no saved fact ${kind === 'you' ? 'about the user' : 'about this project'} has the id "${id}" (the ids are in Remember's answer)`);
    if (old && (old.always || old.pinned)) return refuse(`"${id}" is ${old.always ? 'a rule' : 'a pinned fact'} the user set, so only they change it (/memory)`);
    let out;
    try {
      // The new fact was saved by the call before: only the old one goes.
      const plain = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      out = old && readFacts(dir).some((f) => plain(f.text) === plain(text))
        ? { added: [], replaced: [], refused: [], retired: applyChanges(dir, { retire: [{ id, reason: `replaced by: ${text.replace(/\s+/g, ' ').trim().slice(0, 120)}` }] }, { why: 'remember' }).retired }
        : applySave({ cwd: this.cwd, home: this.memory.home, adds: [{ text, kind, from: 'saved by the model while it worked', ...(old ? { replaces: id } : {}) }] }, { why: 'remember' });
    } catch (e) { seen({ kind: 'error', message: e.message }, true); return { text: `Not saved: ${e.message}.`, error: true }; }
    if (!out.added.length && !out.replaced.length && !out.retired.length) return refuse(out.refused[0]?.why ?? 'it is already saved');
    seen({ kind: 'saved' });
    const line = saveLine(out);
    if (line) this.emit('note', { text: line, tone: 'dim' });
    if (old) return { text: `Saved to the memory; the old fact "${id}" is retired.` };
    const added = out.added[0];
    let near = [];
    try { near = await nearFacts(readFacts(dir).filter((f) => f.id !== added.id && !f.always && !f.pinned), text, { embedder: this.memory.embedder ?? null }); } catch { /* the list is a help, the save stands */ }
    if (!near.length) return { text: 'Saved to the memory.' };
    const list = near.map((f) => `- ${f.id}: ${f.text.replace(/\s+/g, ' ').trim()} (saved ${f.saved ?? 'before'})`).join('\n');
    return { text: `Saved to the memory. Saved facts about the same thing:\n${list}\nIf the new fact makes one of these out of date (a later state, a changed command), call Remember again with the same fact and replaces set to its id: the old one is retired. If they still hold, carry on.` };
  }

  // The folder a request works in, when it is not a code project (folder.mjs, 4 Oct 2026): what it
  // says about itself the first time in a conversation, the names the request uses, and a question
  // for a name the folder does not settle. { kind } (null for the home folder).
  async folderNotes(text, request, signal) {
    const dir = this.turn?.workFolder ?? (isHomeFolder(this.cwd, this.home) ? null : this.cwd);
    if (!dir) return null;
    this.folderKinds ??= new Map();
    let kind = this.folderKinds.get(dir);
    if (!kind) { try { kind = folderKind(dir); } catch { return null; } this.folderKinds.set(dir, kind); }
    this.cardsGiven ??= new Set();
    this.folderLabels ??= new Map();
    // A code project: its README, for a model on another machine, once a conversation, when it says
    // something (200 characters or more); the opening read already gives git, the top and the map.
    if (kind === 'code') {
      if (!this.model?.remote || this.cardsGiven.has(dir)) return { kind };
      this.cardsGiven.add(dir);
      let readme = null;
      try { readme = folderCard(dir, { chars: 2000 }); } catch {}
      const files = (readme?.files ?? []).filter((f) => /^readme/i.test(f));
      if (!files.length || readme.text.length < 200) return { kind };
      const notes = `What this project says about itself (${files.join(', ')}; Read it for the rest):\n${readme.text}`;
      this.turn.folder = { request, notes };
      this.ctxUsed += tokensOf(notes);
      this.emit('note', { text: `Read the project's ${files.join(' and ')}`, tone: 'dim', fold: true });
      return { kind };
    }
    let card = null;
    if (!this.cardsGiven.has(dir)) { try { card = folderCard(dir); } catch {} this.cardsGiven.add(dir); }
    if (card) this.folderLabels.set(dir, card.labels);
    // Names only in a folder of data: in any other, a request's words match its files' names too often.
    let names = null;
    if (kind === 'data') { try { names = namesInRequest(text, dir, { labels: this.folderLabels.get(dir) ?? new Map() }); } catch {} }
    const said = [];
    for (const u of (names?.unclear ?? []).slice(0, 2)) {
      if (signal?.aborted) break;
      const a = await this.namesAsk(u, signal);
      if (a) said.push(`The user says "${u.word}" means ${a}.`);
    }
    const notes = [card ? `What this folder says about itself (${card.files.join(', ')}; Read the file for the rest):\n${card.text}` : '', names?.note ?? '', said.join(' ')].filter(Boolean).join('\n\n');
    if (!notes) return { kind };
    this.turn.folder = { request, notes };
    this.ctxUsed += tokensOf(notes);
    const words = (names?.matched ?? []).map((m) => `${m.word} → ${m.to ?? 'asked'}`).join(', ');
    this.emit('note', { text: `${card ? `Read the folder's ${card.files.join(' and ')}` : 'This folder'}${words ? ` · names in your request: ${words}` : ''}`, tone: 'dim', fold: true });
    return { kind };
  }
}
