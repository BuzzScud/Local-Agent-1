// The Agent's reading ahead (agent.mjs): the files named or ranked before the first step, the code
// search, the helpers' findings and the tests run first.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { display, execute, resolvePath } from './tools.mjs';
import { readFileSync, statSync } from 'node:fs';
import { repoMap } from '../tools/repomap.mjs';
import { rankFiles } from './rank.mjs';
import { isHomeFolder } from './prompt.mjs';
import { sortLine } from '../flows/words.mjs';
import { Scratch } from '../flows/scratch.mjs';
import { partsFor, wholeSmallProject } from '../flows/explain.mjs';
import { readResults } from '../flows/results.mjs';
import { llmCalls } from '../flows/llm.mjs';
import { CEILING, CODENAMES, SHARES, chars, createdNames, fixLike, gitChanges, shareOut, talksAboutChanges, testReport, whoUses } from './helpers.mjs';
import { CUT, CodeIndex, MARGIN, partKey, sameAsIndexed } from '../tools/codeindex.mjs';
import { choose, howChosen } from './search.mjs';
import { MAP_MIN_FILES, PREFETCH_MAX_LINES, RANK_MAX_TOKENS, RANK_SHARE, TESTS_FIRST_MS, filesNamed, tokensOf } from './agent-said.mjs';
import { noteSlow, slowRun } from './tests-first.mjs';

export class ReadPart {
  // What Read first reads before the first step: the files a request names,
  // and the files closest to it (rank.mjs). /helpers switches each.
  get readFirst() {
    if (!this.helpersGiven) return { named: true, ranked: true };
    return { named: this.helpers.has('named'), ranked: this.helpers.has('rag') };
  }

  // The code search for this folder (tools/codeindex.mjs, the rag helper),
  // built in the background from the first request on; none in the home folder.
  // The model that compares meanings for the code search: the service's Code search helper
  // (/subagents, helper-models.mjs RemoteEmbedder) when the app set one, else this Mac's.
  searchModel() { return this.searchEmbedder ?? this.embedder; }
  // Why CodeSearch cannot run here, or null when it can.
  codeSearchOff() {
    return !this.helpers.has('rag') ? 'the code search helper (Oracle) is off in /helpers' : !this.searchModel() ? "the small model that compares meanings is off (/effort's Embedder)" : isHomeFolder(this.cwd) ? 'there is no code search of the home folder' : null;
  }
  codeSearch() {
    const embedder = this.searchModel();
    if (!this.helpers.has('rag') || !embedder || isHomeFolder(this.cwd)) return null;
    // It waits while the model answers (a step here, or a focused path's call). Another
    // embedder (the helper switched on or off) starts a new index: their numbers differ.
    if (this.codeIndex?.cwd !== this.cwd || this.codeIndex.embedder !== embedder) this.codeIndex = new CodeIndex(this.cwd, embedder, { ...(this.indexDir ? { dir: this.indexDir } : {}), paused: () => this.answering > 0 || llmCalls.now > 0 });
    return this.codeIndex;
  }

  // The parts closest to the request, once the index is built; a build (or a
  // refresh of the files changed since) goes on in the background meanwhile.
  async findCode(text, signal) {
    const index = this.codeSearch();
    if (!index) return null;
    index.build(); // with everything already worked out, it is ready at once
    if (!index.ready) return { waiting: true, done: index.done, total: index.total, off: index.state === 'off' };
    const found = await index.search(text, { signal });
    // The index goes with what it found: /effort's Embedder Off, saved while
    // this request runs, drops this.codeIndex, not this search's own.
    return found && { ...found, index };
  }

  // The line under your request that says which path was picked, once a
  // message: "Sorted as: change · shortcut". Greetings and "update memory"
  // have none; their answer says it.
  sorted(kind, opts) {
    if (this.sortShown) return;
    this.sortShown = true;
    this.emit('sorted', { kind: kind ?? 'other', text: sortLine(kind, opts) });
  }

  // In a project with several code files, the loop starts from the project
  // map (each file with its names) as if it had listed the project itself:
  // one read instead of a List → Read → List round at ~60 tokens a second.
  prefetchMap() {
    // No map of the home folder: it lists whatever code it meets first, and the
    // model took that as "your codebase" (src/agent/prompt.mjs, isHomeFolder).
    if (this.mapGiven || isHomeFolder(this.cwd)) return;
    this.mapGiven = true;
    let map;
    try { map = repoMap(this.cwd, { maxChars: 4500 }); } catch { return; }
    if (map.entries.length < MAP_MIN_FILES) return;
    const id = `map_${Date.now()}`;
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'List', arguments: JSON.stringify({ path: '.', pattern: '**/*' }) } }] });
    this.messages.push({ role: 'tool', tool_call_id: id, content: `Code files in the project (lines: top-level names):\n${map.text}` });
    this.emit('tool', { id, name: 'List', label: 'List', arg: 'the project map', view: { kind: 'list', count: map.entries.length, content: map.text }, given: true });
  }

  // "Explain this code" (flows/explain.mjs). Puts the code a question is
  // about into the conversation as if the model had read it: the files it
  // names (whole when they fit, otherwise their parts and the lines that
  // match the question), then the definitions of the names it uses.
  // One read put into the conversation as if the model had made it.
  giveRead(rel, args, body, view) {
    const id = `read_${Date.now()}_${this.messages.length}`;
    const result = { role: 'tool', tool_call_id: id, content: body };
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'Read', arguments: JSON.stringify(args) } }] });
    this.messages.push(result);
    // Asked for again, it is pointed back to (runTool), like any part already read.
    const abs = resolvePath(this.cwd, rel).abs;
    let mtime = null;
    try { mtime = statSync(abs).mtimeMs; } catch {}
    this.turn?.reads?.set(`${abs}|${args.offset ?? ''}|${args.limit ?? ''}|`, { msg: result, mtime });
    if (this.turn) this.turn.given = (this.turn.given ?? 0) + 1;
    this.emit('tool', { id, name: 'Read', label: 'Read', arg: rel, view, given: true });
  }

  // A file read in one go: whole when it fits, otherwise as the Read tool
  // gives a long file (its parts, and the lines that match the request).
  async readForPrefetch(f, text, room) {
    const full = readFileSync(f.abs, 'utf8');
    if (full.includes('\u0000')) return null;
    const lines = full.split('\n').length;
    if (lines <= PREFETCH_MAX_LINES && full.length <= room) {
      this.readFiles.add(f.abs);
      return { body: `${f.rel} (${lines} lines):\n${full}`, view: { kind: 'read', lines, total: lines, content: full } };
    }
    const r = await execute('Read', { path: f.rel }, {}, { cwd: this.cwd, request: text, maxResultChars: this.maxResultChars, read: this.model?.harness?.read });
    if (r.error) return null;
    return { body: r.text, view: r.view };
  }

  // Any other request in a project (a page, a change done step by step, a
  // fix the focused path handed over): the files it names, then the ones it
  // is most likely about by meaning (rank.mjs), read before the first step
  // instead of found with List/Search/Read one reply at a time.
  async prefetchRanked(text, signal) {
    const on = this.readFirst;
    if (isHomeFolder(this.cwd) || (!on.named && !on.ranked)) return;
    let entries;
    try { entries = repoMap(this.cwd).entries; } catch { return; }
    if (entries.length < MAP_MIN_FILES) return;
    let budget = Math.min(RANK_MAX_TOKENS, Math.round(this.ctx * RANK_SHARE)) * 3.6;
    const want = [];
    if (on.named) for (const f of filesNamed(this.cwd, text, { skip: createdNames(text) })) want.push(f);
    let ranked = { files: [], how: 'none', ms: 0 };
    if (on.ranked) { try { ranked = await rankFiles(this.cwd, text, { embedder: this.searchEmbedder ?? this.ranker ?? this.memory?.embedder ?? null, entries, signal, retriever: this.search.retriever, reranker: this.reranker }); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; } }
    for (const r of ranked.files) {
      const abs = resolvePath(this.cwd, r.rel).abs;
      if (!want.some((w) => w.abs === abs)) want.push({ rel: r.rel, abs, ranked: true });
    }
    const read = [];
    const byMeaning = [];
    for (const f of want) {
      if (this.readFiles.has(f.abs) || budget <= 400) continue;
      let got;
      try { got = await this.readForPrefetch(f, text, budget); } catch { continue; }
      if (!got || got.body.length > budget) continue;
      budget -= got.body.length;
      this.giveRead(f.rel, { path: f.rel }, got.body, got.view);
      (f.ranked ? byMeaning : read).push(f.rel);
      // For /helpers: which helper brought it, and its size.
      (this.lastHelpers ??= []).push({ from: f.ranked ? 'code' : 'file', text: f.rel, tokens: tokensOf(got.body) });
    }
    if (this.turn) this.turn.ranked = { how: ranked.how, ms: ranked.ms, files: [...read, ...byMeaning] };
    // Which helper read each: Scout the files named, Oracle the closest ones.
    const said = [read.length && `${CODENAMES.named}: ${read.join(', ')}`,
      byMeaning.length && `${CODENAMES.rag}${ranked.how === 'meaning' ? `, ${howChosen(ranked.chosen, 'meaning')}` : ranked.how === 'words' ? `, by the request’s words${ranked.chosen?.reranked ? ', reranked' : ''}` : ''}: ${byMeaning.join(', ')}`].filter(Boolean);
    if (said.length) this.emit('note', { text: `Read first · ${said.join(' · ')}`, tone: 'dim' });
  }

  async prefetch(text) {
    let budget = this.upFrontNow;
    const given = (rel, args, body, view) => {
      budget -= body.length;
      this.giveRead(rel, args, body, view);
    };
    const named = filesNamed(this.cwd, text);
    for (const f of named) {
      if (this.readFiles.has(f.abs) || budget <= 0) continue;
      let got;
      try { got = await this.readForPrefetch(f, text, budget); } catch { continue; }
      if (got) given(f.rel, { path: f.rel }, got.body, got.view);
    }
    // The names the question uses: the part of the file that defines each.
    if (isHomeFolder(this.cwd)) return;
    let parts = [];
    const skip = named.filter((f) => this.readFiles.has(f.abs)).map((f) => f.rel);
    // A question that names its files has said where to look: the rest of a
    // small project is not read on top.
    try { parts = named.length ? [] : wholeSmallProject(this.cwd, { skip }); if (!parts.length) parts = partsFor(this.cwd, text, { skip }); } catch {}
    for (const p of parts) {
      if (budget <= 0) break;
      const whole = p.from === 1 && p.to >= p.total;
      const head = whole ? `${p.rel} (${p.total} lines):` : `${p.rel} (lines ${p.from}-${p.to} of ${p.total}; pass offset to read more):`;
      given(p.rel, whole ? { path: p.rel } : { path: p.rel, offset: p.from, limit: p.to - p.from + 1 }, `${head}\n${p.text}`, { kind: 'read', lines: p.to - p.from + 1, total: p.total, content: p.text });
      this.readFiles.add(resolvePath(this.cwd, p.rel).abs);
    }
  }

  // What the context helpers bring before the first step, after Read first
  // (prefetchRanked: the named files and the closest files, whole): the
  // failing tests and the changes not yet committed, the closest functions
  // of the files not read whole, and where the names the request uses are
  // defined and used. Each goes in as a step the model took itself (a Bash,
  // a Read, a Search), within CEILING tokens, and one "Helpers" line lists
  // what came (ctrl+o: each with its fit and size).
  async bringHelpers(text, kind, signal) {
    const on = this.helpers;
    if (!on?.size) return;
    const t0 = Date.now();
    const home = isHomeFolder(this.cwd);
    const items = [];
    const skipped = [];
    let codeChosen = null; // how the code search chose, when not by meaning alone
    // The tests, on a fix-type request: the run a focused path made for this
    // message, or one now (in a throwaway copy, 60 s at most). Not now in a folder
    // whose run was cut off this week (tests-first.mjs), nor in a loop's run whose
    // last run ran them (testsFirst false): the model runs them itself.
    if (on.has('tests') && !home && this.testCmd && fixLike(kind, text)) {
      const made = this.happened?.testRun?.cmd === this.testCmd ? this.happened.testRun : null;
      const slow = made || this.testsFirst === false ? null : slowRun(this.cwd, this.testCmd);
      if (!made && this.testsFirst === false) skipped.push({ from: 'tests', text: this.testCmd, skipped: "the loop's last run ran them" });
      else if (slow) {
        skipped.push({ from: 'tests', text: this.testCmd, skipped: `cut off after ${TESTS_FIRST_MS / 1000} s here on ${slow.at.slice(0, 10)}` });
        if (!this.slowTold) { this.slowTold = true; this.emit('note', { text: `Not running ${this.testCmd} first: it took over ${TESTS_FIRST_MS / 1000} s here, so the model runs it when it needs to.`, tone: 'dim' }); }
      }
      const run = made ?? (slow || this.testsFirst === false ? null : await this.runTestsFirst(signal));
      if (run?.timedOut && !made) noteSlow(this.cwd, this.testCmd, run.secs);
      if (run) {
        const say = (maxChars) => `(Agentic Coder ran the tests before your first step; nothing has changed since.)\n${testReport(this.testCmd, run.out, run.code, { timedOut: run.timedOut, secs: run.secs, maxChars })}`;
        const res = readResults(run.out, run.code);
        const what = run.timedOut ? 'stopped after 60 s' : res.ok ? `all ${res.total ?? ''} pass`.replace('  ', ' ') : `${res.failed ?? 'some'} of ${res.total ?? '?'} fail`;
        const bash = (body) => ({ helper: 'tests', from: 'tests', text: `${this.testCmd} · ${what}`, name: 'Bash', args: { command: this.testCmd, description: 'Run the tests' }, body, chars: body.length, view: { kind: 'bash', code: run.code, lines: body.split('\n'), ms: Math.round((run.secs ?? 0) * 1000) } });
        items.push({ ...bash(say(chars(SHARES.tests))), small: bash(say(chars(SHARES.tests) / 3)) });
      }
    }
    if (on.has('tests') && !home && (fixLike(kind, text) || talksAboutChanges(text))) {
      const ch = gitChanges(this.cwd);
      if (ch?.text) {
        const body = `(The changes not yet committed, as git shows them.)\n${ch.text}`;
        items.push({ helper: 'tests', from: 'changes', text: `git diff · ${ch.files.length + ch.more} changed file${ch.files.length + ch.more === 1 ? '' : 's'}${ch.fresh ? `, ${ch.fresh} new` : ''}`, name: 'Bash', args: { command: 'git diff HEAD', description: 'See what changed since the last commit' }, body, chars: body.length, view: { kind: 'bash', code: 0, lines: body.split('\n'), ms: 0 } });
      }
    }
    // The closest functions by meaning (the code search): from the files
    // Read first did not give whole, so a long file's outline is followed by
    // the parts that matter, and a file its ranking missed can still come.
    if (on.has('rag') && !home) {
      let found = null;
      try { found = await this.findCode(text, signal); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
      if (found?.parts?.length && found.parts[0].close >= CUT) {
        const best = found.parts[0].close;
        // How many parts come along is the meaning's rule; which ones, /effort's
        // Retriever and Reranker rows (search.mjs). On Meaning with no reranker
        // these are the closest parts, as always.
        const index = found.index;
        const n = found.parts.filter((x) => x.close >= Math.max(CUT, best - MARGIN)).slice(0, 8).length;
        const hybrid = this.search?.retriever === 'hybrid';
        const chosen = await choose({ query: text, byMeaning: found.parts, byWords: hybrid ? index.wordSearch(text) : null, n, key: partKey, text: (p) => index.textOf(p, this.reranker?.model?.chars), retriever: this.search?.retriever, reranker: this.reranker, signal });
        if (chosen.note && !this.rerankTold) { this.rerankTold = true; this.emit('note', { text: chosen.note, tone: 'dim' }); } // once a session
        if (chosen.order === 'hybrid' || chosen.reranked) codeChosen = howChosen(chosen);
        const byFile = new Map();
        for (const p of chosen.picked.map((x) => ({ ...x, close: x.close ?? found.closeOf?.get(partKey(x)) ?? 0 }))) {
          const abs = resolvePath(this.cwd, p.rel).abs;
          if (this.readFiles.has(abs) || !sameAsIndexed(this.cwd, p)) continue;
          if (!byFile.has(p.rel)) byFile.set(p.rel, []);
          byFile.get(p.rel).push(p);
        }
        for (const [rel, parts] of [...byFile].slice(0, 3)) {
          const abs = resolvePath(this.cwd, rel).abs;
          let all;
          try { all = readFileSync(abs, 'utf8').replace(/\n$/, '').split('\n'); } catch { continue; }
          // Parts next to each other are given as one piece.
          const ranges = [];
          for (const p of [...parts].sort((a, b) => a.line - b.line)) {
            const last = ranges.at(-1);
            if (last && p.line <= last.end + 3) { last.end = Math.max(last.end, p.end); last.names.push(p.name); last.close = Math.max(last.close, p.close); } else ranges.push({ line: p.line, end: p.end, names: [p.name], close: p.close });
          }
          for (const r of ranges) {
            const end = Math.min(r.end, all.length);
            const piece = all.slice(r.line - 1, end).join('\n');
            const body = `${rel} (lines ${r.line}-${end} of ${all.length}; pass offset to read more):\n${piece}`;
            items.push({ helper: 'rag', from: 'code', text: `${rel} · ${r.names.join(', ')}`, close: r.close, name: 'Read', args: { path: rel, offset: r.line, limit: end - r.line + 1 }, abs, body, chars: body.length, view: { kind: 'read', lines: end - r.line + 1, total: all.length, content: piece } });
          }
        }
      } else if (found?.waiting && !found.off && found.total) {
        skipped.push({ from: 'code', text: 'code search', skipped: `still indexing: ${found.done} of ${found.total} parts` });
      }
    }
    // Where the names the request uses are defined and used.
    if (on.has('lsp') && !home) {
      let map = null;
      try { map = repoMap(this.cwd); } catch {}
      const w = map?.entries?.length ? whoUses(this.cwd, text, map.entries) : null;
      if (w) items.push({ helper: 'lsp', from: 'uses', text: w.names.join(', '), name: 'Search', args: { pattern: w.names.join('|') }, body: w.text, chars: w.text.length, view: { kind: 'search', count: w.names.length, content: w.text } });
    }
    if (!items.length && !skipped.length) return;
    const take = shareOut(items);
    for (const it of items) if (!take.includes(it) && !take.includes(it.small)) skipped.push({ from: it.from, text: it.text, skipped: `over the ${CEILING.toLocaleString('en-US')}-token limit` });
    for (const it of take) this.pretend(it);
    const tokens = take.reduce((s, it) => s + tokensOf(it.body), 0);
    this.lastHelpers = [...(this.lastHelpers ?? []), ...take.map((it) => ({ from: it.from, text: it.text, tokens: tokensOf(it.body) }))];
    if (this.happened) this.happened.helpers = this.lastHelpers;
    this.emit('context', { title: 'Helpers', items: [...take.map((it) => ({ from: it.from, text: it.text, close: it.close ?? null, tokens: tokensOf(it.body) })), ...skipped], tokens, ms: Date.now() - t0, how: 'meaning', ...(codeChosen ? { chosen: `${CODENAMES.rag} ${codeChosen}` } : {}) });
  }

  // A step the model did not have to take: the call and its result go into
  // the conversation as if it had made them (as the project map does), and
  // onto the screen like any step. A Read counts as read: asked for again,
  // it is pointed back to, and the file may be edited.
  pretend({ name, args, body, view, abs }) {
    if (this.turn) this.turn.shown = true; // the app looked for it (lookFirst counts it)
    if (name === 'Read' && abs) {
      this.giveRead(args.path, args, body, view);
      this.readFiles.add(abs);
      this.ctxUsed += tokensOf(body) + 30;
      return;
    }
    const id = `${name.toLowerCase()}_${Date.now()}_${this.messages.length}`;
    const result = { role: 'tool', tool_call_id: id, content: body };
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    this.messages.push(result);
    this.ctxUsed += tokensOf(body) + 30;
    this.emit('tool', { id, name, ...display(name, args), view, given: true });
  }

  // The tests before the first step, in a throwaway copy of the project
  // (a test may write files), stopped after a minute.
  async runTestsFirst(signal) {
    this.emit('note', { text: `Running ${this.testCmd} first, to see what fails (a minute at most).`, tone: 'dim' });
    let scratch;
    try {
      scratch = new Scratch(this.cwd);
      const r = await scratch.run(this.testCmd, { signal, timeoutMs: TESTS_FIRST_MS });
      return { cmd: this.testCmd, out: r.out ?? '', code: r.code, timedOut: r.timedOut, secs: (r.ms ?? 0) / 1000 };
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') throw e;
      return null;
    } finally { scratch?.dispose(); }
  }

  // Read with several paths (the model decides): each file read as its own Read, on screen
  // one by one; the model gets them in one result, in the order it named them.
  async readMany(id, paths, signal) {
    const parts = [];
    const readKeys = [];
    const images = [];
    let failed = 0;
    for (const [k, path] of paths.entries()) {
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      const out = await this.runTool({ id: `${id}_${k + 1}`, name: 'Read', args: JSON.stringify({ path }) }, signal);
      if (out.stop) return out;
      if (out.error) failed++;
      if (out.readKey) readKeys.push({ readKey: out.readKey, mtime: out.mtime });
      parts.push(out.text);
      images.push(...(out.images ?? []));
    }
    return { text: parts.join('\n\n'), error: failed === paths.length, readKeys, ...(images.length ? { images } : {}) };
  }
}
