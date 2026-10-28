// The answer's checks (agent.mjs): what the app looks at when the model answers with no tool call, before the
// answer stands: the cases have tests, the page was checked, Look first, files that exist, the second opinion,
// the second look, your Stop hooks and the rest. Moved out of agent-work.mjs's work() on 13 Oct 2026 so each file
// can be read whole. Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the
// agent's own.
import { questionLines } from './questions.mjs';
import { casesBack, isTestPath, untested } from './cases.mjs';
import { readFileSync } from 'node:fs';
import { isHomeFolder } from './prompt.mjs';
import { LOOK_BACKS, lookBackNote } from './look.mjs';
import { pageReadOn } from './page-read.mjs';
import { pagesToCheck } from '../flows/layoutcheck.mjs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { STOP_BACKS } from './user-hooks.mjs';
import { appCodeChanged } from './self.mjs';
import { wantsDesktop } from '../flows/words.mjs';
import { SERVICE_REPLY } from './room.mjs';
import { endpointOf } from '../../../models/index.mjs';
import { qwenRawFits } from './qwen-raw.mjs';
import { LAYOUT_ROUNDS, LOST_CALL, MENTIONS_WALL, aboutTheCode, announcesNextStep, asksForWork, commandInText, asksTheUser, auto, claimsAllGood, claimsAlreadyThere, claimsDone, claimsFound, emptyCutNote, kTok, lostCall, searchWords, tokensOf, wholeFilePasted, writesCodeInstead } from './agent-said.mjs';

export class AnswerPart {
  // The answer, with no tool call: the app's checks before it stands (moved out of work() on 13 Oct 2026 so each
  // file can be read whole). st holds work()'s counters and once-flags this changes; the rest are work()'s own
  // names. Answers 'continue' (something went back to the model: the next step) or 'break' (the message ends,
  // with st.reason).
  async answerChecks(st, { text, signal, images, started, turnStart, again, skill, request, toolsUsed, lookFloor, turn, assistant }) {
    // Thinking that came out as the reply's text (leakedThinking) and nothing else: not an
    // answer. Qwen3.6 ended hard task 32 this way, mid-task (3 Oct 2026). A technical
    // recovery, so on both ways.
    if (turn.leaked && !text.trim() && st.leakBacks < 2) {
      st.leakBacks++;
      this.emit('note', { text: 'The reply was only thinking, written out as text; asked it to take the next step.', tone: 'dim' });
      this.messages.push({ role: 'user', content: auto('Your last reply was only your thinking, with no tool call and no answer. Take the next step now with a tool, or give your answer.') });
      return 'continue';
    }
    // A reply that asks you something ends the turn: it waits for you.
    // The questions the request asked for, written as text: back once to put them in Ask, the outline kept.
    if (this.turn.asks && !this.turn.askedUser && !this.turn.askBack && questionLines(text) >= 2) {
      this.turn.askBack = true;
      this.emit('note', { text: 'It wrote its questions as text; asked it to put them in the picker (Ask).', tone: 'warn' });
      this.messages.push({ role: 'user', content: auto(`You wrote your questions as text. Put them to the user with the Ask tool now: each with 2 to 4 choices, up to 5 questions in one Ask. Keep the rest of your answer as it is; do not write it again.`) });
      return 'continue';
    }
    // An answer to a question from Claude's notes in place of the request: back once with the request.
    const chasedNow = !this.turn.noteChased ? this.noteChaseDue(`${turn.reasoning ?? ''}\n${text}`) : '';
    if (chasedNow) { this.messages.push({ role: 'user', content: auto(chasedNow.replace(/^\(|\)$/g, '')) }); return 'continue'; }
    // The page the request names, never tried (Look before answering): the answer goes back once, with the
    // tool to use; the second time a line under it says the page was not read. Before a question to the user ends the
    // message, as the ssh one (18 Oct 2026): "Could you paste the page's text?" with nothing tried had ended it.
    if (this.turn.web?.urls?.length && !this.turn.fetched && !this.isHelper && this.hook('look-first') && text.trim()) {
      if (!this.turn.webBack) {
        this.turn.webBack = true;
        this.emit('note', { text: `It answered without reading ${this.turn.web.urls[0]}; told it to read the page with WebFetch.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(`You answered without reading ${this.turn.web.urls.slice(0, 3).join(', ')}. WebFetch is one of your tools here and this address is allowed: call it now, then answer from what the page shows. If it fails, tell the user exactly what it answered; do not say you cannot reach the internet without trying.`) });
        return 'continue';
      }
      this.emit('note', { text: `Answered without reading ${this.turn.web.urls[0]}: what it says about that page is not from the page.`, tone: 'warn' });
    }
    // The server the request names, never tried in Bypass (tools/ssh.mjs): Qwen3.6 wrote "I'll run the SSH command"
    // with it in a shell block, promised a password prompt and ended (18 Oct 2026). Back once, then a line under it.
    // Before a question to the user ends the message: at 8:09 PM the same day it answered "What would you like to do
    // on the server?" with nothing run, and that question ended the message before this was looked at.
    if (this.turn.ssh && this.mode === 'bypass' && !this.turn.sshRan && !this.isHelper && this.hook('next-step') && text.trim()) {
      if (!this.turn.sshBack) {
        this.turn.sshBack = true;
        this.emit('note', { text: `It answered without running ssh to ${this.turn.ssh.server}; told it to run it.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(`You answered without running anything, so nothing happened. Bash is one of your tools and commands reach ${this.turn.ssh.server} from here: run ssh now (ssh ${this.turn.ssh.server} alone checks the login). If it fails, its output says what to do or ask.`) });
        return 'continue';
      }
      this.emit('note', { text: `Answered without running ssh: nothing ran on ${this.turn.ssh.server}.`, tone: 'warn' });
    }
    if (asksTheUser(text)) return 'break';
    // The server says it wrote far more than arrived, and no call came: a call lost on the way, not a
    // step it forgot (Qwen3.6 on the service, 8 Oct 2026: 38 s of writing after "Let me write the scripts
    // directly using Write:", only those words arrived, and "You said what you will do next" got two
    // Writes with only a path). Once a message.
    if (!this.turn.lostCall && lostCall(turn, text)) {
      this.turn.lostCall = true;
      this.emit('note', { text: `It wrote about ${kTok(turn.tokens)} tokens and its call never arrived (the server dropped it); asked it to take the step again, smaller.`, tone: 'warn' });
      this.messages.push({ role: 'user', content: auto(LOST_CALL) });
      return 'continue';
    }
    // "Let me find it." and the command written out in a shell block, never called: back once to run
    // it, at the first step too (commandInText; qwen3-coder-next, 9 Oct 2026).
    const written = !this.turn.commandBack && this.hook('next-step') ? commandInText(text) : '';
    if (written) {
      this.turn.commandBack = true;
      this.emit('note', { text: 'It wrote a command out without running it; asked it to run it.', tone: 'warn' });
      this.messages.push({ role: 'user', content: auto('You wrote a command in your reply but did not run it, so nothing happened. If you meant to run it, run it now with the Bash tool; if it was only for the user to run, say so in one line and stop.') });
      return 'continue';
    }
    // Small models often announce the next step mid-task ("Now I will
    // update main().") and stop. Tell them to go ahead, at most twice per
    // message, and only once work is under way (a tool already ran).
    if (st.nudges < 2 && toolsUsed > 0 && this.hook('next-step') && announcesNextStep(text)) {
      st.nudges++;
      this.messages.push({ role: 'user', content: auto('You said what you will do next but did not do it. If you meant to, do it now with the tools; if you are waiting for the user, stop.') });
      return 'continue';
    }
    // A whole file pasted into the reply instead of saved (19 Oct 2026, Qwen3.6 on a service wrote the page as
    // a fenced block across 11 minutes and never called Write; the two words-nudges below did not move it and the
    // request's minutes went to re-pasting). On the FIRST such reply, open a Write for it in raw mode and let it
    // stream the file body (pasteToWrite, the lost-Write machinery), then save it. Only where raw mode fits
    // (a Qwen 3.5-family Ollama service); elsewhere the words-nudges below still run. Before the page/plan nudge,
    // so a file pasted on the very first reply is saved, not answered with "write it now".
    if (!this.turn.forcedWrite && !this.isHelper && !this.turn.changed && !this.turn.startTexts?.size && !this.madePages().length
      && (this.turn.type === 'page' || this.fileNamed()) && asksForWork(this.turn.request)
      && wholeFilePasted(text) && qwenRawFits(endpointOf(this.url))) {
      this.turn.forcedWrite = true;
      const wrote = await this.pasteToWrite(text, turn, signal).catch(() => null);
      if (wrote) return 'continue';
    }
    // A page asked for and none written: back once to write it (8 Oct 2026: Qwen3.6 on the service
    // answered page requests with the six-line plan, and Look before answering below sent it to
    // search an empty folder; no page came in 9 of 10 runs). The search nudge is for code that is there.
    if (this.turn.type === 'page' && !this.isHelper && !this.turn.pageBack && !this.turn.changed && !this.turn.startTexts?.size && !this.madePages().length && !(!text.trim() && turn.finish === 'length')) {
      this.turn.pageBack = true;
      const planOnly = /^\s*Main thing:/i.test(text) && /^\s*Phone:/im.test(text);
      this.emit('note', { text: `It answered without writing the page${planOnly ? ' (only its plan)' : ''}; asked it to write it.`, tone: 'warn' });
      this.messages.push({ role: 'user', content: auto(`You have not written the page yet${planOnly ? ': that was only the plan' : ''}. Write it now with the Write tool, as one self-contained file in this folder, then say in a line what you made.`) });
      return 'continue';
    }
    // Look before answering (a model on another machine, in a project, aboutTheCode): an answer
    // with no look of its own goes back once with the words to search for; a request for work
    // that made a file is not held to it (a new file needs no look). The second time it is
    // let through with a line under it (the owner's pick).
    // A reply cut off at the limit with nothing in it is no answer: the cut handling below has it.
    const lookHeld = this.model?.remote && !this.isHelper && (!isHomeFolder(this.cwd) || Boolean(this.turn.workFolder)) && !(!text.trim() && turn.finish === 'length');
    // Files the app read for it before its first step count as a look (App reads ahead); the opening
    // read and the maps do not (they say where things are, not what is in them).
    const sawCode = this.turn.lookedOwn || (this.turn.given ?? 0) > 0 || this.turn.shown;
    if (lookHeld && this.hook('look-first') && !sawCode && !this.turn.changed && aboutTheCode(this.turn.request)) {
      if (!st.unlooked) {
        st.unlooked = true;
        const words = searchWords(this.turn.request);
        this.emit('note', { text: 'It answered without looking at the project; asked it to search first.', tone: 'dim' });
        this.messages.push({ role: 'user', content: auto(`You answered without looking at this project's files. Do not answer about the code from memory: Search for the names in the request${words.length ? ` (for example ${words.map((w) => `"${w}"`).join(', ')})` : ''}, Read what the search finds, then answer from what you saw, naming the files.`) });
        return 'continue';
      }
      this.emit('note', { text: 'Answered without looking at the project\'s files: check it before you rely on it.', tone: 'warn' });
    }
    // Files that exist: an answer that names files not in the project (and not made this
    // message, nor named in the request) goes back once; the second time, a line says which.
    if (lookHeld && this.hook('real-files')) {
      const missing = this.missingFiles(text);
      if (missing.length) {
        if (!st.unreal) {
          st.unreal = true;
          this.emit('note', { text: `It named files that are not in the project (${missing.slice(0, 3).join(', ')}); asked it to check.`, tone: 'dim' });
          this.messages.push({ role: 'user', content: auto(`These files are not in this project: ${missing.join(', ')}. Search for what you meant (Search or List), and answer only with files you have seen in a tool's result.`) });
          return 'continue';
        }
        this.emit('note', { text: `It named files that are not in this project: ${missing.slice(0, 5).join(', ')}.`, tone: 'warn' });
      }
    }
    // Look first: an answer before the minimum, with nothing changed yet, goes back to look
    // further, with what it has looked at so far (at most LOOK_BACKS times a message).
    const lookedFor = (Date.now() - started) / 1000;
    if (lookFloor && lookedFor < lookFloor && st.lookBacks < LOOK_BACKS && !this.turn.changed && turn.finish !== 'length') {
      st.lookBacks++;
      this.emit('note', { text: `Answered after ${Math.round(lookedFor)} s of the ${lookFloor} s minimum (/effort Look first); asked it to look further first.`, tone: 'dim' });
      this.messages.push({ role: 'user', content: auto(lookBackNote(this.lookedSince(turnStart))) });
      return 'continue';
    }
    // A skill's check fence: one command before the turn may end. The steps say
    // so too; the loop is what holds it when that sentence loses.
    if (this.turn.fence?.has('check') && !this.turn.ranCommand && asksForWork(this.turn.request) && (this.turn.checkNudges ?? 0) < 2) {
      this.turn.checkNudges = (this.turn.checkNudges ?? 0) + 1;
      this.emit('note', { text: 'This skill requires a command before it is done; asked it to run one.', tone: 'warn' });
      this.messages.push({ role: 'user', content: auto('This skill is not done until a command has checked the work. Run that command with Bash, then answer.') });
      return 'continue';
    }
    // It says the work is done, but nothing changed in this message: no
    // Edit, no Write, and no command that could have written instead
    // (an ls or a git log could not: 3 Oct 2026, that one let it through).
    // Sent back once; if it still claims it with nothing changed, a note
    // under the answer says so. So is an answer that is the change written
    // out as code (Qwen3.6 on hard task 30, the model deciding): nothing
    // was changed, and the user cannot apply it from there.
    const t = this.turn;
    const codeInstead = writesCodeInstead(text);
    if (!t.changed && !t.question && !t.carried && !t.wroteByCommand && !t.skillSaved && this.hook('said-done') && asksForWork(t.request) && (claimsDone(text) || codeInstead)) {
      if (!st.doneUnchanged) {
        st.doneUnchanged = true;
        this.emit('note', { text: codeInstead ? 'It wrote the change in its answer, but no file changed; asked it to make the change.' : 'It says the work is done, but no file changed; asked it to look again.', tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(codeInstead ? 'You wrote the change in your answer, but no file was changed: the user cannot apply it from there. Make the change now with Edit or Write, then check it.' : 'You said the work is done, but no file was changed in this message. If the request needs a change, make it now with the tools. If it was really done before this message, say which file has it and that nothing changed now, in one or two sentences.') });
        return 'continue';
      }
      this.emit('note', { text: 'Nothing was changed for this request: no file was written or edited.', tone: 'warn' });
    }
    // It created a file this turn, then says the work was already there.
    if (this.turn.created.length && this.hook('already') && claimsAlreadyThere(text)) {
      const files = this.turn.created.join(', ');
      if (!st.correctedAlready) {
        st.correctedAlready = true;
        this.messages.push({ role: 'user', content: auto(`You created ${files} in this turn; it did not exist before. Answer again in 1-3 sentences: say that you created it, what it does, and how you checked it. Do not say it was already there.`) });
        return 'continue';
      }
      this.emit('note', { text: `Note: ${files} did not exist before; Agentic Coder created it just now.`, tone: 'warn' });
    }
    // Answer matches results: it says all passed or it works, but its last run of the checks failed
    // (4 Oct 2026: "All 24 formulas passed" after "Results: 22 passed, 2 failed", exit code 1). Back
    // once with that run's own line; if it still says so, a line under the answer does.
    const lastCheck = this.turn.checks.at(-1);
    if (lastCheck?.failed && claimsAllGood(text) && this.hook('results')) {
      const said = `\`${lastCheck.cmd}\`${lastCheck.counts ? ` printed "${lastCheck.counts}"` : ''}${lastCheck.code ? ` and ended with exit code ${lastCheck.code}` : ''}`;
      if (!this.turn.resultsBack) {
        this.turn.resultsBack = true;
        this.emit('note', { text: `Its answer says everything passed, but its last check run did not (${lastCheck.counts || `exit code ${lastCheck.code}`}); sent it back.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(`Your answer says it all passed or works, but your last run of the checks did not: ${said}. Answer again from that run: what passed, what failed and why, in plain words. If you fixed it since, run the checks again first and answer from that run.`) });
        return 'continue';
      }
      this.emit('note', { text: `Check this answer: its last check run did not pass (${lastCheck.counts || `exit code ${lastCheck.code}`}).`, tone: 'warn' });
    }
    // Stop when blocked: it met a wall (a login, an address or path you gave that is not there) and
    // its answer neither asked you nor says so. Back once to say it and ask; then a line names it.
    const wallMet = this.turn.walls[0];
    if (wallMet && !this.turn.askedUser && !MENTIONS_WALL.test(text) && this.hook('blocked')) {
      if (!this.turn.wallBack) {
        this.turn.wallBack = true;
        this.emit('note', { text: `Its answer leaves out what blocked it (${wallMet.why}); sent it back to say so and ask you.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(`Your answer leaves out what blocked you: ${wallMet.why}. Say it plainly at the start of your answer, say what you did instead (if anything), and ask the user how they want to go on.`) });
        return 'continue';
      }
      this.emit('note', { text: `Not said in the answer: ${wallMet.why}.`, tone: 'warn' });
    }
    // Read before claiming, at the end: the answer says it found what it needs while files it leans
    // on were seen only as outlines. Back once to read the part; the step-by-step line (followDue)
    // covers the replies before.
    if (!this.turn.readFirstSent && this.turn.outlined.size && claimsFound(text) && this.hook('read-first')) {
      this.turn.readFirstSent = true;
      const names = [...this.turn.outlined].slice(0, 3).map((f) => basename(f));
      this.emit('note', { text: `It says it found what it needs, but saw only the outline of ${names.join(', ')}; sent it back to read the part.`, tone: 'warn' });
      this.messages.push({ role: 'user', content: auto(`You wrote that you found or have what you need, but of ${names.join(', ')} you have seen only the outline: its parts and line numbers, none of its text. Read the part you need (offset and limit, or find), then answer from what it says.`) });
      return 'continue';
    }
    // A blank answer (seen once after "hello"): ask for one, once.
    if (!text.trim() && turn.finish !== 'length' && !st.blankRetry && this.hook('empty')) {
      st.blankRetry = true;
      this.emit('note', { text: 'The model gave an empty answer; asked it to reply.', tone: 'dim' });
      this.messages.push({ role: 'user', content: auto('Reply to the user now, in one to three sentences.') });
      return 'continue';
    }
    // With the hook off, the empty answer stands, and the screen says why it is blank.
    if (!text.trim() && turn.finish !== 'length' && !st.blankRetry && !this.hook('empty')) this.emit('note', { text: 'The model ended with an empty answer (the Empty reply hook would send it back: /hooks on empty).', tone: 'dim' });
    if (!text.trim() && turn.finish === 'length') {
      // Cut off after a few words: the memory was full, not the thinking too long.
      if (turn.tokens < 200) {
        this.messages.pop();
        await this.compact(signal);
        return 'continue';
      }
      // Counted with the cut-off calls: told the same thing three times running, it stops
      // (it was sent back with no end: three in a row on 3 Oct, until you pressed esc).
      st.cuts++;
      const size = `${kTok(turn.tokens)} of ${kTok(this.lastRoom ?? turn.tokens)} tokens`;
      if (st.cuts >= 3) {
        st.reason = 'stuck';
        this.emit('note', { text: `Three replies in a row were cut off at the reply limit (${size}), so it stopped. Raise Reply length in /effort, or ask for the file in smaller pieces.`, tone: 'warn' });
        return 'break';
      }
      // Cut at your own Reply length (/effort) while the context has room for twice as much:
      // this step once more with that room, for the rest of the message (4 Oct 2026: Qwen3.6
      // at 8.2k thought for 3½ minutes and none of its page arrived; "build it in parts" made
      // one write many steps). Ollama's limit holds the thinking and the answer together.
      const own = this.model?.replyTokens;
      const more = Math.min(SERVICE_REPLY, Math.floor(this.ctx * this.roomAt) - this.estNow());
      if (own && !this.turn.roomUp && more >= own * 2) {
        this.turn.roomUp = more;
        this.messages.pop();
        this.emit('note', { text: `The reply was cut off at your Reply length (${size}) before anything arrived; this step goes again with ${kTok(more)} of room. Raise Reply length in /effort to keep it.`, tone: 'warn' });
        return 'continue';
      }
      // The thinking took the room: think less. Little or no thinking (a model that cannot
      // think, like qwen3-coder-next): it was writing a call, most likely a file, and Ollama
      // hands back nothing of a tool call cut at the limit, so "think less" was the wrong advice.
      if (tokensOf(turn.reasoning) >= turn.tokens * 0.6) {
        this.messages.push({ role: 'user', content: auto('You ran out of room while thinking. Think less and take the next step.') });
        this.emit('note', { text: `The model ran out of room while thinking (${size}); asked it to act.`, tone: 'warn' });
      } else {
        this.messages.push({ role: 'user', content: auto(emptyCutNote()) });
        this.emit('note', { text: `The reply was cut off at the limit (${size}) and nothing of it arrived, most likely a file too long for one reply: asked it to build the file in parts.`, tone: 'warn' });
      }
      return 'continue';
    }
    // It says it is done after changing files but never ran the tests:
    // run them (through the normal permission prompt); if they fail, send
    // it back to fix them. At most twice per message.
    // Only a file on the Desktop changed: the project's tests cannot see it (3 Oct: a helper's
    // .md for the Desktop started the whole suite, more than 10 minutes on this Mac).
    const onlyAway = this.turn.changedAway && !this.turn.changedHere && !this.turn.check;
    const due = this.turn.changed && !onlyAway && !this.turn.testedAfterChange && st.checks < 2 && this.hook('tests');
    const checkCmd = !due ? null : this.turn.check ?? (this.turn.bug?.kind && !this.turn.bug.kind.testsSeeIt ? null : await this.changeTests());
    if (checkCmd) {
      st.checks++;
      const call = { id: `check_${Date.now()}`, name: 'Bash', args: JSON.stringify({ command: checkCmd, description: this.turn.check ? 'Run the check the request names' : 'Check the change with the project’s tests' }) };
      assistant.tool_calls = [{ id: call.id, type: 'function', function: { name: 'Bash', arguments: call.args } }];
      this.emit('note', { text: `Checking the change: ${checkCmd}`, tone: 'dim' });
      const out = await this.runTool(call, signal);
      const checkMsg = { role: 'tool', tool_call_id: call.id, content: out.text, ...(out.images?.length ? { images: out.images } : {}) };
      this.messages.push(checkMsg);
      if (out.stop) { st.reason = out.stop; return 'break'; }
      if (out.error) {
        this.noteError(out.text, checkMsg);
        this.messages.push({ role: 'user', content: auto(`${this.turn.check ? 'The named check fails' : 'The tests fail'} (output above). Find what is wrong in your change, fix it with Edit, then run ${this.turn.check ? 'the check' : 'the tests'} again.`) });
        return 'continue';
      }
    }
    // Nothing lost: it changed files and says it is done, but a function
    // the request never names is gone (practice task 14: perimeter()
    // replaced area() instead of going beside it). Once per message.
    if (this.turn.changed && !st.lostChecked && !signal?.aborted && this.hook('lost')) {
      st.lostChecked = true;
      const lost = this.lostSinceStart();
      if (lost) {
        this.emit('note', { text: `Removed without being asked: ${lost}.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(`Your changes removed ${lost}, and the request does not ask for that. Put it back with Edit and keep what you added, unless the request really needs it gone; then say why in one sentence.`) });
        return 'continue';
      }
    }
    // A page it made or changed: opened in a browser and measured
    // (flows/layoutcheck.mjs). What is broken goes back; after the fix
    // it looks again, and what is left goes back once more
    // (LAYOUT_ROUNDS); after that the turn ends with "Still broken".
    // Asking first (askPage), it looks only when you said "Check it", further down.
    if (this.turn.changed && !st.layoutDone && !signal?.aborted && this.hook('layout') && (!this.askFirst() || st.layoutSends >= LAYOUT_ROUNDS)) {
      const found = await this.checkLayout(st.layoutSends > 0, { send: st.layoutSends < LAYOUT_ROUNDS });
      if (found && st.layoutSends < LAYOUT_ROUNDS) {
        st.layoutSends++;
        this.messages.push({ role: 'user', content: auto(found) });
        return 'continue';
      }
      st.layoutDone = true;
    }
    // A page asked for "on my desktop" saved somewhere else, when the
    // Desktop is inside this folder: back once, with the command that
    // moves it (Qwen, 30 Sep: "download it to my desktop" became
    // ~/media-player-card.html, a cp onto itself, and "ready on your
    // Desktop"). Outside this folder, the end of the turn offers a copy.
    if (this.turn.changed && !st.desktopSent && !signal?.aborted && this.hook('desktop') && this.desktopInside() && asksForWork(this.turn.request) && wantsDesktop(this.turn.request)) {
      const away = this.pagesOffDesktop();
      if (away.length) {
        st.desktopSent = true;
        const shq = (p) => (/^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
        const moves = away.map((p) => `mv ${shq(relative(this.cwd, p.abs))} ${shq(relative(this.cwd, this.desktopTarget(p.abs)))}`);
        const names = away.map((p) => this.tilde(p.abs)).join(' and ');
        this.emit('note', { text: `Asked for on the Desktop, but ${names} ${away.length === 1 ? 'is' : 'are'} not there; asked it to move ${away.length === 1 ? 'it' : 'them'}.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(`The request asks for the file on the Desktop, but ${names} ${away.length === 1 ? 'is' : 'are'} not on the Desktop. Move ${away.length === 1 ? 'it' : 'them'} there with Bash: ${moves.join(', then ')}. Then say where ${away.length === 1 ? 'it is' : 'they are'} now, with the full path, in one sentence.`) });
        return 'continue';
      }
    }
    // What a reader sees (page-read.mjs): each page this message wrote, opened before the answer
    // stands; one mostly empty to a reader goes back once, and is read again after its fix.
    if ((st.pageReads === 0 || (st.pageReads === 1 && this.turn.pageSentBack)) && !signal?.aborted && this.hook('page-read') && pageReadOn()) {
      st.pageReads++;
      const back = await this.readPages({ send: st.pageReads === 1 });
      if (back) { this.turn.pageSentBack = true; this.messages.push({ role: 'user', content: auto(back) }); return 'continue'; }
    }
    // A page this message changed, and asking first: it is yours to look at before any check
    // (askPage), now that the model says it is done and the page is where it was asked for.
    if ((this.turn.changed || this.madePages().length) && !st.layoutDone && !signal?.aborted && this.askFirst() && st.layoutSends < LAYOUT_ROUNDS) {
      const pages = pagesToCheck(this.cwd, [...(this.turn.startTexts?.keys() ?? []), ...this.madePages()]);
      if (pages.length) {
        const fix = await this.polishPage(signal);
        if (signal?.aborted) { st.reason = 'interrupted'; return 'break'; }
        if (fix) { this.messages.push({ role: 'user', content: auto(fix) }); return 'continue'; }
        const a = await this.askPage(pages, signal, { again: st.layoutSends > 0 });
        if (a.end) { st.reason = a.end; return 'break'; }
        if (a.send) { if (a.fix) st.layoutSends++; this.messages.push({ role: 'user', content: a.send }); return 'continue'; }
        st.layoutDone = true;
      }
    }
    // A picture of a page it built, looked at by the model the window is on when it sees, or by
    // UI design · checks (/subagents); what looks off goes back once (after the measured layout
    // check). Asking first, it looked already, before you were asked (polishPage).
    if (this.turn.changed && !st.looked && !signal?.aborted && !this.turn.pageAsked && !this.turn.polish?.reviewed && this.pageReviewer()) {
      st.looked = true;
      const found = await this.lookAtPages(signal);
      if (found) { this.messages.push({ role: 'user', content: auto(found) }); return 'continue'; }
    }
    // The request's cases (cases.mjs): each case of its plan needs a test file changed in this message
    // that tries its example. Back twice with the ones still untested; then a line names them.
    if (this.turn.changed && this.model?.remote && this.hook('cases') && !this.turn.casesDone && !signal?.aborted) {
      const cases = this.turn.cases ?? [];
      if (cases.length) {
        const tests = [...(this.turn.wrote?.keys() ?? [])].filter(isTestPath).map((rel) => { try { return readFileSync(join(this.cwd, rel), 'utf8'); } catch { return ''; } }).join('\n');
        const missing = untested(cases, tests);
        if (!missing.length) this.turn.casesDone = true;
        else if ((this.turn.casesBacks ?? 0) < 2) {
          this.turn.casesBacks = (this.turn.casesBacks ?? 0) + 1;
          this.emit('note', { text: `${missing.length} of the ${cases.length} cases in its plan have no test yet: sent back (${this.turn.casesBacks} of 2).`, tone: 'warn' });
          this.messages.push({ role: 'user', content: auto(casesBack(missing)) });
          return 'continue';
        } else {
          this.turn.casesDone = true;
          this.emit('note', { text: `Untested cases from its plan: ${missing.map((c) => c.example).join(' · ')}`, tone: 'warn' });
        }
      }
    }
    // Case review (cases.mjs): once a message, when the cases have their tests or their send-backs are
    // used up, a call of its own reads the changed code against each case; what reads wrong goes back once.
    if (this.turn.changed && this.model?.remote && this.hook('case-review') && !this.turn.caseReviewed && this.turn.cases?.length && !signal?.aborted) {
      this.turn.caseReviewed = true;
      const read = await this.reviewCases(signal);
      if (read && !signal?.aborted) { this.messages.push({ role: 'user', content: auto(read) }); return 'continue'; }
    }
    // It changed files and says it is done: does the work cover every
    // part of the request? Once per message; a miss sends it back. Not
    // after you were asked to look at the page yourself (askPage).
    if (this.turn.changed && this.verify && !st.verified && !signal?.aborted && this.hook('done') && !this.turn.pageAsked) {
      st.verified = true;
      const miss = await this.verifyDone(text, signal);
      if (miss) {
        this.emit('note', { text: `Not finished: ${miss}`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto(`A quick check (it can be wrong) thinks this may be missing: ${miss}. Look once. If it is actually fine, say so in one sentence and stop; otherwise fix it with the tools, run the tests if there are any, then report.`) });
        return 'continue';
      }
    }
    // Second opinion (/subagents): another model on the service reads the request and
    // the diff; what it finds goes back once. It can be wrong, and the model is told so.
    // /agents asks it at its own moments instead (agents-run.mjs: reviewInTurn off).
    if (this.turn.changed && !st.reviewed && !signal?.aborted && this.turn.diffs && this.reviewInTurn !== false && this.helperUse('review')) {
      st.reviewed = true;
      const found = await this.secondOpinion(signal);
      if (found) { this.messages.push({ role: 'user', content: auto(found) }); return 'continue'; }
    }
    // Second look (second-look.mjs): the answer against what happened, once a message, after real work.
    if (!signal?.aborted && text.trim()) {
      const back = await this.lookDue(text, signal);
      if (signal?.aborted) { st.reason = 'interrupted'; return 'break'; }
      if (back) { this.messages.push({ role: 'user', content: auto(back) }); return 'continue'; }
    }
    // Your Stop hooks (user-hooks.mjs): exit 2 sends it back to work with what the hook says,
    // STOP_BACKS times at most in one message (stop_hook_active says it was sent back already).
    if (this.userHooks?.has('Stop') && !this.isHelper && !signal?.aborted && st.stopBacks < STOP_BACKS) {
      const r = await this.userHooks.run('Stop', { stop_hook_active: st.stopBacks > 0, last_assistant_message: text }, { signal, permissionMode: this.mode });
      if (r.block) {
        st.stopBacks++;
        this.emit('note', { text: `Your stop hook sent it back: ${(r.reason || 'it said no').split('\n')[0].slice(0, 160)}`, tone: 'dim' });
        this.messages.push({ role: 'user', content: auto(`A hook of the user's says the work is not done: ${r.reason || 'it said no'}. Carry on, then report.`) });
        return 'continue';
      }
    }
    // Working on itself (agent.mjs selfOn; the owner's pick, 8 Oct 2026): the app's own code changed
    // in this message and the tests passed after it, so the window starts again on that code once
    // the answer is in (app-self.mjs restart; the restarted conversation says what changed). Not
    // when the model already asked for it with the App tool, not after a failed or missing test run.
    // The app is built from GitHub's main only (18 Oct 2026): a change not pushed yet is not restarted
    // on, and the note says to push it first.
    if (this.turn.changed && this.turn.testedAfterChange && this.turn.checkOk && !this.turn.restarted && this.app?.restart && !this.isHelper && !signal?.aborted && this.selfOn()) {
      const files = appCodeChanged(this.cwd, this.happened?.files ?? []);
      if (files.length) {
        this.turn.restarted = true;
        const r = await this.app.restart(`${files.length === 1 ? files[0] : `${files.length} files of the app`} changed and the tests pass`, { files });
        if (r?.error) this.emit('note', { text: `Not restarted on the new code: ${r.error}`, tone: 'warn' });
      }
    }
    return 'break';
  }

  // The project's tests for this message's change: the test files that cover the files it changed in the project
  // (coveringTests, at most COVER_MAX), with the project's own runner; the whole suite when none does. Before 18 Oct
  // 2026 it was always the whole suite, which here takes 3 to 6 minutes, so the 2-minute limit cut it off.
  async changeTests() {
    if (!this.testCmd) return null;
    const inside = (p) => { const rel = isAbsolute(p) ? relative(this.cwd, p) : p; return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : null; };
    const changed = [...new Set([...(this.turn.startTexts?.keys() ?? []), ...(this.happened?.files ?? [])].map((p) => inside(String(p))).filter(Boolean))];
    if (!changed.length) return this.testCmd;
    try {
      const [{ coveringTests, projectFiles }, { coveringCommand }] = await Promise.all([import('../flows/localize.mjs'), import('./agents-run.mjs')]);
      return coveringCommand(this.testCmd, coveringTests(this.cwd, changed, projectFiles(this.cwd)));
    } catch { return this.testCmd; }
  }
}
