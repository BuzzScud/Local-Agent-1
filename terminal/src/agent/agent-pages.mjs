// The Agent's pages (agent.mjs): the design studio and the layout check, the page question, pages
// opened and read back, and what goes on the Desktop.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { pageWrongQuestion } from './questions.mjs';
import { parseArgs, resolvePath } from './tools.mjs';
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isHomeFolder } from './prompt.mjs';
import { emptyOf, pageReadLine, pageReadNote, readPage } from './page-read.mjs';
import { designSettings } from './design.mjs';
import { buildNote, buildStyles, isBuilt } from './studio.mjs';
import { findChrome, layoutCheck, layoutNote, needsServer, pagesToCheck } from '../flows/layoutcheck.mjs';
import { findProjects, foldersNamed, projectsNamed } from './projects.mjs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { wantsDesktop } from '../flows/words.mjs';
import { canQuickLook, checkPagePicture, screenshotPage } from './helper-models.mjs';
import { CHECK_IT, asksForWork, auto, looksGood, missingParts, wantsCheck } from './agent-said.mjs';

export class PagesPart {
  // Outside a project, a request naming one ("the chart bug in MAIN2026") asks
  // once whether to work there. Each project is offered once a session.
  async offerProject(text, signal) {
    const home = this.home ?? homedir();
    this.namedFolder = null;
    // Only from the home folder or its Desktop, Documents and Downloads.
    if (!isHomeFolder(this.cwd, home)) return null;
    this.projects ??= findProjects(home);
    this.offered ??= new Set();
    const projects = projectsNamed(text, this.projects, this.cwd);
    // A folder the request names by its path, a code project or not (4 Oct 2026, the owner's pick: ask
    // "Work in that folder?"; either way the checks the home folder turns off work for it: turn.workFolder).
    const named = projects.length ? projects : foldersNamed(text, this.cwd, home);
    this.namedFolder = named.length === 1 ? named[0] : null;
    const found = named.filter((d) => !this.offered.has(d));
    if (!found.length || found.length > 4) return null;
    for (const d of found) this.offered.add(d);
    const tilde = (p) => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
    const one = found.length === 1;
    const code = found.some((d) => this.projects.includes(d));
    const question = `${one ? `Work in ${tilde(found[0])}?` : `Work in which ${code ? 'project' : 'folder'}?`} ${code ? 'Agentic Coder then uses its tests and its AGENTS.md, and its' : 'Agentic Coder then starts there:'} commands can only change files there, until /clear.`;
    // Staying is the first choice, so enter keeps you where you started: a
    // pasted command that named the app's own repo once moved it there, and the
    // next request's page could not reach the Desktop (28 Sep).
    const options = [`No, stay in ${tilde(this.cwd)}`, ...found.map((d) => (one ? `Yes, work in ${basename(d)}` : tilde(d)))];
    const id = `project_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', args: { question, options }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    const said = (answer.text ?? answer.feedback ?? '').trim();
    if (answer.choice === 'no' && !said) return { stop: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: said } });
    const pick = one ? (/^(yes|y|ok|okay|sure|yep|go)\b/i.test(said) ? found[0] : null) : found.find((d) => said === tilde(d) || said === d);
    if (!pick) return null;
    this.moveTo(pick);
    // /rewind copies the new folder before anything in it changes.
    try { await this.rewind?.whenMoved(); } catch {}
    this.emit('note', { text: `Working in ${tilde(pick)} now: its tests and AGENTS.md, and commands can only change files there.`, tone: 'dim' });
    return { moved: pick };
  }

  // The design studio's build of a page this turn changed: the text for the
  // model, or null (studio off, not a studio turn and never built, or a plain-CSS
  // page). A stock colour it used is said in the same reply.
  async buildStudio(prepared) {
    const design = designSettings(this.designSaved);
    let html = '';
    try { html = readFileSync(prepared.abs, 'utf8'); } catch { return null; }
    if (!isBuilt(html) && !(design.studio && this.turn?.studio)) return null;
    let r;
    try { r = await buildStyles(html); } catch (e) {
      this.emit('note', { text: `Could not build the styles into ${prepared.rel}: ${e.message}.`, tone: 'warn' });
      return null;
    }
    if (r.skipped) return null;
    try { writeFileSync(prepared.abs, r.html); } catch (e) { this.emit('note', { text: `Could not save the built styles into ${prepared.rel}: ${e.code ?? e.message}.`, tone: 'warn' }); return null; }
    this.emit('note', { text: `Built the styles into ${prepared.rel} (${r.classes} classes, ${(r.bytes / 1024).toFixed(1)} KB, ${(r.ms / 1000).toFixed(1)} s)${r.cdn ? ', in place of the Tailwind link' : ''}${r.stock.length ? `; not in your theme: ${r.stock.join(', ')}` : ''}.`, tone: r.stock.length ? 'warn' : 'dim' });
    return buildNote(prepared.rel, r);
  }

  // The layout check of the pages this message changed (flows/layoutcheck.mjs):
  // the text for the model when something is broken, else null. `again`: a
  // look after its fix, which says what is left. `send`: what it finds goes
  // back to the model (the first look, and the second of LAYOUT_ROUNDS).
  // `quiet`: no notes (the look at the end of the turn, see stillBroken).
  async checkLayout(again = false, { quiet = false, send = !again } = {}) {
    if (!designSettings(this.designSaved).check || !(this.turn?.startTexts?.size || this.madePages().length)) return null;
    const pages = pagesToCheck(this.cwd, [...(this.turn.startTexts?.keys() ?? []), ...this.madePages()]);
    if (!pages.length) return null;
    const chrome = findChrome();
    if (!chrome) {
      if (!this.layoutTold) { this.layoutTold = true; this.emit('note', { text: 'Layout check skipped: no headless Chrome on this Mac (Chrome, or Playwright\'s own).', tone: 'dim' }); }
      return null;
    }
    const notes = [];
    const left = [];
    let ran = 0;
    for (const rel of pages) {
      const abs = resolvePath(this.cwd, rel).abs;
      let html = '';
      try { html = readFileSync(abs, 'utf8'); } catch { continue; }
      const server = needsServer(html);
      if (server) { this.emit('note', { text: `Layout check skipped for ${rel}: ${server}.`, tone: 'dim' }); continue; }
      const r = await layoutCheck(abs, { chrome });
      if (r.skipped) { this.emit('note', { text: `Layout check skipped for ${rel}: ${r.skipped}.`, tone: 'dim' }); continue; }
      ran++;
      const n = r.problems.length;
      // `check` is the same result for the screen, which draws it as a step with each problem named.
      const check = { page: rel, problems: r.problems, secs: r.secs, again, sent: send };
      if (quiet) { if (n) left.push({ page: rel, problems: r.problems }); continue; }
      if (!n) this.emit('note', { text: `Layout check, ${rel}: nothing broken at 1440 px, on a phone or in dark mode (${r.secs.toFixed(1)} s).`, tone: 'dim', check });
      else this.emit('note', { text: `Layout check, ${rel}: ${n} problem${n === 1 ? '' : 's'}${again ? ' left' : ''} (${r.secs.toFixed(1)} s)${send ? ', sent back to fix.' : `: ${r.problems.slice(0, 3).join(' ')}`}`, tone: 'warn', check });
      if (n) { notes.push(layoutNote(rel, r.problems, again)); left.push({ page: rel, problems: r.problems }); }
    }
    // After its fix: what is still broken, and how many edits the turn had then.
    if (this.turn && again) { this.turn.layoutLeft = left.length ? left : null; this.turn.editsAtLook = this.turn.edits ?? 0; }
    if (quiet) return null;
    // ran: the pages really opened (not skipped); found: each problem, for the question after it (askPage).
    if (this.turn) this.turn.layout = { pages, problems: notes.length, again, ran, found: left.flatMap((p) => p.problems) };
    return notes.length ? notes.join('\n\n') : null;
  }

  // Look first, check after (the user's pick, 1 Oct 2026): a page saved for a request opens in
  // the browser and you are asked before anything checks it. On Bonsai at 16k the invoice page
  // was saved 6 minutes in and the checks after it took the next 14 (its own commands, then the
  // layout check sending it back). "Check it for me" runs the layout check (under a second, no
  // model) and asks again before anything goes back to be fixed; what you type goes to the model.
  // /design ask off (or AGENTIC_LAYOUT_ASK=off): the checks run by themselves, as before.
  askFirst() {
    return Boolean(this.pageAsk && this.turn && designSettings(this.designSaved).ask && asksForWork(this.turn.request));
  }

  // The page a Write of this reply saved, ready to look at: an .html file whose own files (a
  // script or style sheet it links by a relative path) are there too. One that still waits
  // for its app.js is not finished, so the turn goes on.
  savedPage(calls) {
    for (const c of [...calls].reverse()) {
      const path = parseArgs('Write', c.args).args?.path;
      if (!path || !/\.html?$/i.test(path)) continue;
      const { abs, rel, inside } = resolvePath(this.cwd, path);
      if (!inside) continue;
      let html = '';
      try { html = readFileSync(abs, 'utf8'); } catch { continue; }
      if (missingParts(html, dirname(abs)).length) continue;
      return rel;
    }
    return null;
  }

  // → { end: reason } the turn stops here · { send, fix } go on with that message · {} nothing to ask.
  //   saved: asked right after the Write, before the model's reply (the app says the last line).
  //   again: a look after a fix you asked for.
  async askPage(pages, signal, { saved = false, again = false } = {}) {
    const t = this.turn;
    const names = pages.map((p) => basename(p)).join(' and ');
    const it = pages.length === 1 ? 'it' : 'them';
    const mtimes = () => pages.map((p) => { try { return statSync(resolvePath(this.cwd, p).abs).mtimeMs; } catch { return 0; } }).join();
    const end = (line) => { if (saved) this.finishLine(line); return { end: 'done' }; };
    if (!t.checkWanted) {
      // Asked already, and the page has not changed since: nothing new to look at.
      if (t.askedAt === mtimes()) return {};
      t.pageAsked = (t.pageAsked ?? 0) + 1;
      t.askedAt = mtimes();
      const opened = await this.openPages(pages);
      const canCheck = designSettings(this.designSaved).check && Boolean(findChrome());
      const question = `${names} ${pages.length === 1 ? 'is' : 'are'} saved${opened ? ' and open in your browser' : ''}. Have a look: is ${it} right?`;
      const id = `page_${Date.now()}`;
      this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
      const answer = await this.ask({ id, name: 'Ask', kind: 'page', args: { question, options: ['Looks good', ...(canCheck ? [CHECK_IT] : [])] }, prepared: {}, label: 'Ask', arg: question });
      if (signal?.aborted) return { end: 'interrupted' };
      const text = (answer.text ?? answer.feedback ?? '').trim();
      if (answer.choice === 'no' && !text) return { end: 'declined' }; // "Stop here"
      this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || 'Looks good' } });
      if (!text || looksGood(text)) return end(`Saved ${pages.join(' and ')}. You looked at ${it} and said ${it} looks good, so nothing more was checked.`);
      if (!wantsCheck(text) || !canCheck) {
        // "No, this is wrong" and little more: what is wrong, as choices; then back with that and the request.
        let what = '';
        const wrong = /^\W*(no|nope|wrong|not right|this is wrong|that'?s wrong|incorrect|bad)\b/i.test(text) && text.split(/\s+/).length <= 8;
        if (wrong) {
          const q = pageWrongQuestion(names);
          const id2 = `pagewrong_${Date.now()}`;
          this.emit('tool-ask', { id: id2, name: 'Ask', label: 'Ask', arg: q.question });
          const a2 = await this.ask({ id: id2, name: 'Ask', kind: 'page', args: q, prepared: {}, label: 'Ask', arg: q.question });
          if (signal?.aborted) return { end: 'interrupted' };
          what = String(a2.text ?? a2.feedback ?? '').trim();
          if (what) this.emit('tool', { id: id2, name: 'Ask', label: 'Ask', arg: q.question, view: { kind: 'answer', question: q.question, text: what } });
        }
        // An instruction ("make the total bold") goes back as it was; "wrong" with its detail and the request.
        if (!wrong) return { send: `[Page] You stopped after saving ${names} so the user could look at ${it}. The user answered: ${text}\nFollow that.` };
        const asked = String(t.task ?? t.request ?? '').split('\n\n(')[0].replace(/\s+/g, ' ').trim();
        const hint = this.rememberHint('corrected');
        return { send: `[Page] You stopped after saving ${names} so the user could look at ${it}. The user answered: ${text}${what ? `\nWhat is wrong, in their words: ${what}` : ''}\nTheir request, to hold the page against: "${asked.length > 900 ? `${asked.slice(0, 899)}…` : asked}"\nFollow that.${hint ? `\n${hint}` : ''}` };
      }
      t.checkWanted = true;
    }
    const found = await this.checkLayout(again, { send: false });
    if (signal?.aborted) return { end: 'interrupted' };
    if (!found) return end(`Saved ${pages.join(' and ')}. ${t.layout?.ran ? 'The page check found nothing broken.' : 'The page check could not run (the line above says why).'}`);
    const n = t.layout?.found?.length || 1;
    const question = `The page check found ${n === 1 ? 'a problem' : `${n} problems`}${again ? ' left after the fix' : ''} (above). Fix ${n === 1 ? 'it' : 'them'}?`;
    const id = `pagefix_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'page', args: { question, options: [n === 1 ? 'Fix it' : 'Fix them', 'Leave it'] }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { end: 'interrupted' };
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (answer.choice === 'no' && !text) return { end: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    if (/^(fix|yes|y|ok|okay|go|sure|do it)\b/i.test(text)) return { send: auto(found), fix: true };
    if (/^(leave|no|n|skip)\b/i.test(text)) return end(`Saved ${pages.join(' and ')}. You chose to leave what the page check found.`);
    return { send: `[Page check] The page check found this:\n\n${found}\n\nThe user answered: ${text}\nFollow that.`, fix: true };
  }

  // The pages, opened in your browser by the app (openPage): true when any is open. A page is
  // opened again only once it changed, and deliverDesktop does not open it a second time.
  async openPages(pages) {
    if (!this.openPage) return false;
    const t = this.turn;
    t.opened ??= new Map();
    let any = false;
    for (const rel of pages) {
      const abs = resolvePath(this.cwd, rel).abs;
      let mtime = 0;
      try { mtime = statSync(abs).mtimeMs; } catch { continue; }
      if (t.opened.get(abs) === mtime) { any = true; continue; }
      try { await this.openPage(abs); } catch (e) { this.emit('note', { text: `Could not open ${this.tilde(abs)}: ${e.message}.`, tone: 'warn' }); continue; }
      t.opened.set(abs, mtime);
      any = true;
      this.emit('note', { text: `Opened ${this.tilde(abs)} in your browser.`, tone: 'dim' });
    }
    return any;
  }

  // The turn's last reply, said by the app when it ends at a question of its own (askPage
  // right after a Write): the conversation gets its answer, and the screen shows it.
  finishLine(text) {
    this.messages.push({ role: 'assistant', content: text });
    this.emit('assistant', { text, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
  }

  // The Desktop, as `~/…` for the screen, and whether this folder's commands
  // can write there (started from the home folder or the Desktop itself).
  get desktopDir() { return join(this.home, 'Desktop'); }
  desktopInside() { return this.desktopDir === this.cwd || this.desktopDir.startsWith(`${this.cwd}/`); }
  // The Desktop from a project folder, outside the fence (3 Oct 2026, the user's ask: "allow them to
  // think and write on my desktop"; the file had gone into the project as Desktop/CodeIndex-Helper.md
  // and every mv out was refused). Once a request in this conversation asked for a file there, a new
  // file goes right on it with Write, and the files it made there may be read and edited again.
  // Nothing else: not your files already there, not its folders (your other projects), no commands.
  desktopOpen(name, abs) {
    if (this.desktopInside() || dirname(abs) !== this.desktopDir) return false;
    if (this.desktopMade?.has(abs)) return name === 'Read' || name === 'Edit' || name === 'Write';
    return name === 'Write' && Boolean(this.desktopAsked) && !existsSync(abs);
  }
  // Files and folders you dropped into the window (app/attach.mjs) may be read where they are, outside
  // the fence (8 Oct 2026: a big one's first part goes with the message, and the model is told where
  // the rest is): the copy, its text, a folder and what is in it. Read, List and Search only, never a
  // change and never a command; nothing else outside the project.
  allowAttached(paths) { this.attachedPaths ??= new Set(); for (const p of paths ?? []) if (p) this.attachedPaths.add(resolve(p)); }
  attachedOpen(name, abs) {
    if (!['Read', 'List', 'Search'].includes(name) || !this.attachedPaths?.size) return false;
    for (const p of this.attachedPaths) if (abs === p || abs.startsWith(`${p}/`)) return true;
    return false;
  }
  tilde(p) { return p === this.home ? '~' : p.startsWith(`${this.home}/`) ? `~${p.slice(this.home.length)}` : p; }
  // The pages this message changed that are somewhere else than the Desktop
  // (one moved there since is gone from where it was, so it is not counted).
  pagesOffDesktop() {
    const t = this.turn;
    if (!t?.startTexts) return [];
    const out = [];
    for (const rel of [...t.startTexts.keys()].filter((r) => /\.html?$/i.test(r))) {
      const abs = resolvePath(this.cwd, rel).abs;
      if (!existsSync(abs) || abs.startsWith(`${this.desktopDir}/`)) continue;
      out.push({ rel, abs });
    }
    return out.slice(0, 2);
  }
  // Where a page goes on the Desktop: its own name, or name-v2, -v3… when a
  // page of that name is there already (the user keeps the original).
  desktopTarget(abs) {
    const name = basename(abs);
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let target = join(this.desktopDir, name);
    for (let v = 2; existsSync(target); v++) target = join(this.desktopDir, `${stem}-v${v}${ext}`);
    return target;
  }

  // The end of a turn that made a page "on my desktop", on the app's screen
  // (openPage): what the model cannot do from inside the fence. A page still
  // somewhere else is offered to be copied to the Desktop (the user's pick,
  // 30 Sep: ask each time), and the page on the Desktop opens in the browser.
  async deliverDesktop(reason) {
    const t = this.turn;
    if (!this.openPage || reason !== 'done' || !t?.changed || !t.startTexts || !asksForWork(t.request) || !wantsDesktop(t.request)) return;
    const pages = [];
    for (const rel of [...t.startTexts.keys()].filter((r) => /\.html?$/i.test(r))) {
      const abs = resolvePath(this.cwd, rel).abs;
      // Moved to the Desktop with a Bash mv: there under its own name, changed in this message.
      const moved = join(this.desktopDir, basename(abs));
      if (!existsSync(abs)) { try { if (statSync(moved).mtimeMs >= t.since - 1000) pages.push(moved); } catch {} continue; }
      if (abs.startsWith(`${this.desktopDir}/`)) { pages.push(abs); continue; }
      const target = this.desktopTarget(abs);
      const question = `Copy ${basename(abs)} to your Desktop${basename(target) !== basename(abs) ? ` as ${basename(target)}` : ''}? It is in ${this.tilde(dirname(abs))} now.`;
      const id = `desktop_${Date.now()}`;
      this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
      const answer = await this.ask({ id, name: 'Ask', args: { question, options: ['Yes, copy it', 'No, leave it there'] }, prepared: {}, label: 'Ask', arg: question });
      const said = (answer.text ?? '').trim();
      const yes = answer.choice === 'yes' || answer.choice === 'always' || /^(yes|y|ok|okay|sure|copy)\b/i.test(said);
      this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: said || (yes ? 'yes' : 'no') } });
      if (!yes) continue;
      try { copyFileSync(abs, target); } catch (e) { this.emit('note', { text: `Could not copy ${basename(abs)} to the Desktop: ${e.code ?? e.message}.`, tone: 'warn' }); continue; }
      this.emit('note', { text: `Copied to ${this.tilde(target)}.`, tone: 'dim' });
      pages.push(target);
    }
    for (const page of pages.slice(0, 2)) {
      // Open already as it is now (askPage opened it for you to look at): not a second time.
      try { if (t.opened?.get(page) === statSync(page).mtimeMs) continue; } catch {}
      try { await this.openPage(page); this.emit('note', { text: `Opened ${this.tilde(page)} in your browser.`, tone: 'dim' }); } catch (e) { this.emit('note', { text: `Could not open ${this.tilde(page)}: ${e.message}.`, tone: 'warn' }); }
    }
  }

  // UI design · checks (/subagents): each page this message changed, as a picture,
  // looked at by a helper that sees. Answers the message that goes back, or null.
  async lookAtPages(signal) {
    const use = this.helperUse('designCheck');
    if (!use || !(this.turn?.startTexts?.size || this.madePages().length)) return null;
    const pages = pagesToCheck(this.cwd, [...(this.turn.startTexts?.keys() ?? []), ...this.madePages()]);
    if (!pages.length) return null;
    // No Chrome: a Mac takes the picture with Quick Look (helper-models.mjs screenshotPage).
    const chrome = findChrome();
    if (!chrome && !canQuickLook()) return null;
    const notes = [];
    for (const rel of pages) {
      const abs = resolvePath(this.cwd, rel).abs;
      const image = screenshotPage(abs, chrome);
      if (!image) continue;
      this.emit('note', { text: `UI design: ${use.model} looks at ${rel}…`, tone: 'dim' });
      try {
        const r = await checkPagePicture({ url: this.url, use, image, page: rel, request: this.turn.request, signal });
        if (r.ok) { this.emit('note', { text: `UI design: ${use.model} says ${rel} looks right (${r.secs.toFixed(0)} s).`, tone: 'dim' }); continue; }
        this.emit('note', { text: `UI design: ${use.model} sees ${r.findings.length} thing${r.findings.length === 1 ? '' : 's'} off in ${rel}: ${r.findings.join(' · ')}`, tone: 'warn' });
        notes.push(`${rel}:\n${r.findings.map((f) => `- ${f}`).join('\n')}`);
      } catch (e) {
        if (signal?.aborted) throw e;
        this.emit('note', { text: `UI design check skipped: ${use.model} did not answer (${e.message}).`, tone: 'dim' });
        return null;
      }
    }
    return notes.length ? `A model that can see looked at a screenshot of the page (1440 px wide) and thinks this looks off (it can be wrong):\n${notes.join('\n')}\nFix what is real with Edit; then say what you changed in one sentence.` : null;
  }

  // What a reader sees of each page this message wrote (page-read.mjs, at most 3, newest first): a line
  // each on screen, kept for the second look. send: a page mostly empty to a reader is the text that
  // goes back to the model (else null).
  async readPages({ send = true } = {}) {
    const t = this.turn;
    const rels = pagesToCheck(this.cwd, [...(t?.startTexts?.keys() ?? []), ...this.madePages()], 3);
    if (!rels.length) return null;
    let back = null;
    t.pageReads = [];
    t.pageEmpty = new Set();
    for (const rel of rels) {
      const abs = resolvePath(this.cwd, rel).abs;
      this.emit('busy', { task: `opening ${basename(abs)} to see what a reader sees` });
      const read = await readPage(abs);
      if (!read) continue;
      const e = emptyOf(read);
      const said = this.tilde(abs);
      const line = pageReadLine(said, read, e);
      t.pageReads.push(line);
      const sending = send && e.problem && !back;
      if (e.problem) t.pageEmpty.add(said);
      const shown = e.of ? `${e.of - e.empty.length} of ${e.of} sections show text` : `${read.text.toLocaleString('en-US')} characters on screen`;
      const problems = e.problem ? [e.of ? `${e.empty.length} of ${e.of} sections show only their heading: ${e.empty.slice(0, 6).map((x) => x.title || x.id || 'untitled').join(', ')}` : `only ${read.text} characters on screen of ${(read.bytes / 1000).toFixed(1)} KB`, ...(read.errors?.length ? ['a script stopped with an error when it opened'] : [])] : [];
      this.emit('note', { text: `Page check, ${line}${sending ? '; sent back to fill it' : ''}.`, tone: e.problem ? 'warn' : 'dim', check: { title: 'Page check', page: said, problems, ok: shown, bad: shown, where: read.ran ? 'opened in WebKit, scripts run' : 'read as text', sent: sending } });
      if (sending) back = pageReadNote(said, read, e);
    }
    return back;
  }

  // What this message made or changed: its Writes and Edits and the files its commands wrote, each with
  // its size now and, for a page, what the page check found (the "Made" lines under the answer).
  madeSummary() {
    const t = this.turn;
    if (!t || this.isHelper) return [];
    const files = new Map();
    const created = new Set((t.created ?? []).map((c) => resolvePath(this.cwd, String(c)).abs));
    for (const rel of t.startTexts?.keys() ?? []) { const abs = resolvePath(this.cwd, rel).abs; files.set(abs, created.has(abs) || t.startTexts.get(rel) == null); }
    for (const abs of t.madeByCommand?.keys() ?? []) if (!files.has(abs)) files.set(abs, true);
    const out = [];
    for (const [abs, isNew] of files) {
      let bytes;
      try { bytes = statSync(abs).size; } catch { continue; }
      // Inside the project: its path from there; elsewhere with ~ (the page check's lines use ~ throughout).
      const said = this.tilde(abs);
      const page = (t.pageReads ?? []).find((l) => l.startsWith(`${said}:`));
      out.push({ path: abs.startsWith(`${this.cwd}/`) ? relative(this.cwd, abs) : said, bytes, created: isNew, ...(page ? { page: `page check: ${page.slice(said.length + 2)}`, empty: Boolean(t.pageEmpty?.has(said)) } : {}) });
    }
    return out;
  }

  // The pages a command wrote this message (made.mjs), as paths from the project folder.
  madePages() {
    return [...(this.turn?.madeByCommand?.keys() ?? [])].filter((a) => /\.html?$/i.test(a) && existsSync(a)).map((a) => relative(this.cwd, a));
  }
}
