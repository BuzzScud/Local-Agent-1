// The notes a request brings before the Agent's loop (agent-work.mjs): an MCP server it names, your standing
// rules, look first, the bug steps, a skill, a web address, bypass, the math notes and the design cards.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
// Moved from work() word for word; it gives back the look-first floor, which the loop keeps to.
import { ASK_NOTE, wantsQuestions } from './questions.mjs';
import { isHomeFolder } from './prompt.mjs';
import { kindText } from './rules.mjs';
import { LOOK_NOTE, LOOK_NOTE_DATA } from './look.mjs';
import { skillNote } from './prompt-files.mjs';
import { mathNotes } from './expertise.mjs';
import { briefNote, designNotes, designSettings, isDesignRequest, mixTurn, pickCards } from './design.mjs';
import { systemNotes } from './design-system.mjs';
import { pickPieces, studioNotes, usesReact, pickLookFor } from './studio.mjs';
import { lookCard } from './library.mjs';
import { LEAN_NOTE } from './way.mjs';
import { wantsDesktop } from '../flows/words.mjs';
import { checkInText } from '../flows/fix.mjs';
import { alwaysRules } from './facts.mjs';
import { requestHits, requestNote } from './mcp.mjs';
import { BYPASS_OPEN, CORRECTS, SELF_OPEN, asksForWork, tokensOf, webAddresses } from './agent-said.mjs';
import { sshNamed, sshNote } from '../tools/ssh.mjs';

export class NotesPart {
  async turnNotes(text, request, signal, { follow, kind, bug, skill, math }) {
    if (asksForWork(this.turn.request) && wantsDesktop(this.turn.request)) this.desktopAsked = true;
    // A request about what one of the user's MCP servers reaches: a line naming its tools (mcp.mjs requestNote).
    // Not for a message that brings a server's data with it (a resource you attached: @server:uri), or
    // that is a server's own prompt (/server:prompt).
    const mcpSays = this.mcpFrozen && request?.role === 'user' && typeof request.content === 'string' && !this.fromServer && !/<resource server="/.test(text) ? requestNote(text, this.mcpEntries(), { listed: this.mcpListed() }) : '';
    if (mcpSays) this.turn.mcp = { request, notes: mcpSays, hits: requestHits(text, this.mcpEntries(), { listed: this.mcpListed() }) };
    // Look first (look.mjs): a minimum of looking before the answer, on every task that goes step
    // by step here; not a follow-up (it continues a turn that already looked), not in the home
    // folder (a general question there needs no files), not for a helper (it is part of the looking),
    // not for a request that names one of your MCP servers (its answer is there, not in the project).
    // A folder that is not a code project (folder.mjs, 4 Oct 2026): what it says about itself (its
    // README, its manifest) goes with the first request there, and the names the request uses are
    // matched against it; when the folder does not settle which one is meant, you are asked.
    const folder = !follow && !this.isHelper && request?.role === 'user' && typeof request.content === 'string' ? await this.folderNotes(text, request, signal) : null;
    // Your standing rules ([always] facts) with the request itself, on a model on another machine: they are
    // in the instructions' Memory lines too, far above a long conversation (4 Oct 2026: a 29-step run's
    // answer went against "explain simply… no file names or code unless asked").
    if (this.model?.remote && this.memory && !this.isHelper && request?.role === 'user' && typeof request.content === 'string') {
      let rules = [];
      try { rules = alwaysRules(this.cwd, { home: this.memory.home ?? this.home }); } catch { /* no memory to read */ }
      if (rules.length) this.turn.rules = { request, notes: `Your standing rules, for this answer too:\n${rules.map((r) => `- ${r}`).join('\n')}` };
    }
    // A request that asks to be asked: the questions as choices in the window (questions.mjs ASK_NOTE).
    if (!this.isHelper && request?.role === 'user' && typeof request.content === 'string' && wantsQuestions(text)) this.turn.asks = { request, notes: ASK_NOTE };
    // A message that corrects it: Remember what was wrong, when it will matter again (rememberHint).
    if (request?.role === 'user' && typeof request.content === 'string' && CORRECTS.test(String(text).trim())) {
      const hint = this.rememberHint('corrected');
      if (hint) this.turn.fixNote = { request, notes: hint.replace(/^\(|\)$/g, '') };
    }
    const lookFloor = !follow && !this.isHelper && !isHomeFolder(this.cwd) && !this.turn.mcp?.hits.some((x) => x.named) ? this.lookSecsNow : 0;
    // said once a session, and again only after it was off (7 Oct 2026: it was printed every turn)
    if (!this.isHelper && !follow) { if (this.lean && !this.leanSaid) this.emit('note', { text: LEAN_NOTE, tone: 'dim', fold: true }); this.leanSaid = this.lean; }
    if (lookFloor && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.look = { request, notes: folder?.kind === 'data' ? LOOK_NOTE_DATA : LOOK_NOTE };
      this.emit('note', { text: `Looking first: at least ${lookFloor} s of searching and reading before it answers (/effort Look first).`, tone: 'dim', fold: true });
    }
    if (bug && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.bug = { request, steps: kindText(bug), kind: bug };
      // A check the request names scores the change instead of the whole suite
      // (the bug steps, step 7); for a kind the suite cannot see, with no
      // check named, the suite is not run at all — it would only mislead.
      this.turn.check = checkInText(text);
    }
    if (skill && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.skill = { request, notes: skillNote(skill), name: skill.name };
      this.turn.fence = new Set(skill.fence ?? []);
      this.ctxUsed += tokensOf(this.turn.skill.notes);
      const fence = skill.fence?.length ? `; fence: ${skill.fence.join(', ')}` : '';
      this.emit('note', { text: `Skill: ${skill.name} (SKILLS.md; its words here: ${skill.matched.join(', ')}${fence}; ≈${tokensOf(this.turn.skill.notes).toLocaleString('en-US')} tokens).`, tone: 'dim', skill: skill.name });
    }
    // A check the fix path made and what the browser found (flows/pagecheck.mjs).
    if (this.carried && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.carried = { request, notes: this.carried.note };
      this.turn.check = this.carried.check;
      this.carried = null;
    }
    // A web address in the request, with WebFetch on: a line saying it is a page to read, not a
    // file here. Qwen looked for "http://…/notes" in the project with Search, List and Read, and ran
    // curl, twice in seven (the Web check, 30 Sep 2026).
    const urls = webAddresses(text);
    if (urls.length && this.webTools()?.fetch && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.web = { request, urls, notes: `${urls.length === 1 ? 'The request names a web page' : 'The request names web pages'} (${urls.slice(0, 3).join(', ')}): read ${urls.length === 1 ? 'it' : 'them'} with WebFetch. ${urls.length === 1 ? 'It is' : 'They are'} not a file in the project.` };
    }
    // A server named as an ssh command (18 Oct 2026, tools/ssh.mjs): "log in to the server: ssh root@…, just run the
    // command". In Bypass Qwen3.6 thought past its budget about whether it might, then wrote the command out and never
    // ran it. A line says it runs from here, and how (outside Bypass, where it would).
    const server = sshNamed(text);
    if (server && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.ssh = { request, server, notes: sshNote(server, { open: this.mode === 'bypass' }) };
    }
    // Bypass permissions: the prompt's rules say commands stay in the folder, offline. They are
    // kept word for word (the service's cache), so the request says what is true while it is on.
    if (this.mode === 'bypass' && request?.role === 'user' && typeof request.content === 'string') {
      // With where the user's own folders are: it does not know their name, and guessed /Users/Shared/Desktop (5 Oct 2026).
      this.turn.open = { request, notes: `${this.selfOn() ? SELF_OPEN : BYPASS_OPEN} The user's home folder is ${this.home}; their Desktop is ${this.desktopDir}.` };
    }
    if (math && request?.role === 'user' && typeof request.content === 'string') {
      try {
        this.turn.math = { request, notes: mathNotes(math, text) };
        this.emit('note', { text: math.browse ? 'Using the math notes (~/Desktop/MATH).' : `Using the math notes: ${math.area.name} (~/Desktop/MATH).`, tone: 'dim' });
      } catch {}
    }
    // The design examples (src/agent/design.mjs): with a request to make or
    // restyle a page, screen or widget, or any request sent with /design; never
    // with a question, a bug fix or a rename.
    const design = designSettings(this.designSaved);
    const forced = this.designForce;
    this.designForce = false;
    // UI design · writes (/subagents): a page request runs on that helper, when it is not the main model.
    if (this.turn && (forced || (!['question', 'fix', 'rename'].includes(kind) && isDesignRequest(text)))) {
      this.turn.type = 'page';
      const writer = this.helperUse('designWrite');
      if (writer) { this.turn.use = { ...writer, keepAlive: undefined }; this.emit('note', { text: `UI design: ${writer.model} writes this page.`, tone: 'dim' }); }
    }
    if ((forced || (design.auto && !['question', 'fix', 'rename'].includes(kind) && isDesignRequest(text))) && request?.role === 'user' && typeof request.content === 'string') {
      try {
        // The design studio's pieces (studio.mjs) that fit take the example
        // card's place; the rules card still comes. No piece fits: the cards as before.
        // A page of your picks that says the thing asked for as well wins over the pieces (8 Oct 2026).
        // The library's pieces come with the user's own (library.mjs); a React project gets React ones; a
        // look the request names ("like Linear", or /design look) changes the colours the page is built in.
        const pieces = design.studio ? pickPieces(text, { ctx: this.ctx, react: usesReact(this.cwd), library: design.library }) : null;
        const look = design.studio ? pickLookFor(text, design.look) : null;
        const peek = design.style === 'mix' ? mixTurn({ peek: true }) : design.style;
        const pick = pickCards(text, { sets: design.sets, style: peek });
        const yours = pick.examples[0]?.set === 'your picks' && pick.hits > 0 && pick.hits >= (pieces?.hits ?? 0);
        const studio = pieces?.pieces.length && !yours ? studioNotes(pieces, undefined, { look }) : null;
        // mix: opus and fable take turns, one page request each (the turn is taken only when the cards go).
        const style = !studio && design.style === 'mix' ? mixTurn() : design.style;
        // The design system (design-system.mjs, plan A of 18 Oct 2026): the look (the project's DESIGN.md, else yours,
        // which takes the rules cards' place), the guide, and the bank's whole page of the kind asked for.
        const sys = systemNotes(text, { cwd: this.cwd, ctx: this.ctx });
        const own = sys.look ? { ...pick, always: [] } : pick;
        const cards = designNotes(studio ? { ...own, examples: [], more: [], look: null } : own);
        // A look with the cards (no pieces): its card, used in the page's own CSS.
        const lookText = look && !studio ? `This page takes the ${look.name} look (asked for): use the colours, type and corners below in place of the rules card's look. Never the brand's name, logo or words on the page.\n${lookCard(look)}` : null;
        const notes = sys.text || cards || studio ? { text: [sys.text, cards?.text, studio?.text, lookText].filter(Boolean).join('\n\n'), names: [...sys.names, ...(cards?.cards ?? []).map((c) => c.file.replace(/\.md$/i, '')), ...(studio?.pieces ?? []).map((p) => `studio/${p.file.replace(/^components\//, '').replace(/^library\/(?:pieces|react)\//, '').replace(/\.(html?|tsx?)$/i, '')}`), ...(look ? [`look/${look.id}`] : [])] } : null;
        if (notes) {
          // The page plan: six lines from the model before it writes (agent-pages.mjs pageBrief).
          const brief = await this.pageBrief(text, notes.text, signal);
          if (brief) { notes.text += `\n\n${briefNote(brief)}`; this.turn.brief = brief; }
          this.turn.design = { request, notes: notes.text, cards: notes.names };
          this.turn.projectLook = sys.look?.from === 'project' ? sys.look.look : null;
          if (studio) this.turn.studio = { pieces: studio.pieces.map((p) => p.file), look: studio.pieces.every((p) => p.react) ? null : look?.id ?? null };
          this.ctxUsed += tokensOf(notes.text);
          // `design` names the cards for the screen (it folds them into the line under your message).
          this.emit('note', { text: `Design ${studio ? 'studio' : 'examples'}${!studio && design.style === 'mix' ? ` (mix: ${style}'s turn)` : !studio && design.style !== 'auto' ? ` (${style})` : ''}: ${notes.names.join(' + ')} (≈${tokensOf(notes.text).toLocaleString('en-US')} tokens).`, tone: 'dim', design: notes.names });
        } else if (forced) this.emit('note', { text: 'No design examples found (the "design examples" folder is missing or has no cards in the sets that are on).', tone: 'warn' });
      } catch {}
    }
    return lookFloor;
  }
}
