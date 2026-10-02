// Part 1 of Agentic Coder: the terminal. The models part (part 2) imports only
// this file, for its bench, its tools and its probes. What it gets:
//   - the agent: one request run headless, the agent itself, and the
//     instructions and tools it is given;
//   - the client: one chat, or one short side request, against a server;
//   - the flows and their scratch copy, for the probes that watch a flow work;
//   - the memory: the facts, and bringing them back for a request;
//   - the context helpers: which are on, and the code search, for the bench.
//   - the saved settings and the limits /effort keeps, for a probe that runs
//     the way the app does (models/evals/tools/long-task.mjs).
//   - the design examples and the layout check, for the before/after test
//     (models/evals/bench/design/).
export { runHeadless } from './src/headless.mjs';
// THINK_BUDGET_SECS and STEP_DOWN_CAP: the step-down the Thinking old vs new test (models/evals/tools/think-ab.mjs) names.
// toolCallInText: a tool call written as text, read the way the app reads it (the New model check, models/evals/tools/model-check.mjs).
export { Agent, claimsAlreadyThere, claimsDone, asksForWork, THINK_BUDGET_SECS, STEP_DOWN_CAP, toolCallInText } from './src/agent/agent.mjs';
// WORK_HABITS and NOTES_RANK: what the old/new prompt test (models/evals/tools/prompt-ab.mjs) shows it compared.
export { systemPrompt, projectNotes, gitSummary, SESSION_MARK, WORK_HABITS, NOTES_RANK } from './src/agent/prompt.mjs';
export { toolSchemas } from './src/agent/tools.mjs';
export { outsidePath } from './src/agent/permissions.mjs';
// Auto mode's check, for the Auto & Screen check (models/evals/tools/auto-screen-check.mjs).
export { autoCheck, AUTO_SYSTEM } from './src/agent/auto-check.mjs';
export { streamChat } from './src/agent/client.mjs';
export { complete, decide, SETUP_THINK_CAP } from './src/flows/llm.mjs';
// The request sorter and the lines of its test, for the sorting check (models/evals/tools/sort-check.mjs).
export { modelSort, routeByRules, sortQuestion, KINDS as SORT_KINDS } from './src/flows/index.mjs';
export { LINES as SORT_LINES } from './test/sort-lines.mjs';
export { changeFlow } from './src/flows/change.mjs';
export { fixFlow } from './src/flows/fix.mjs';
export { Scratch } from './src/flows/scratch.mjs';
export { readResults } from './src/flows/results.mjs';
export { memoryDirs, readFacts, applyChanges, changeTrust, tidy, undoLast, openMemory, memoryNotes, filesIn } from './src/agent/facts.mjs';
export { recall, recallNotes } from './src/agent/recall.mjs';
export { notesDir, readNotes, leftOut, holdsSecret, bestPart, recallClaude, claudeText, notesCount, CUT as NOTES_CUT, MARGIN as NOTES_MARGIN } from './src/agent/claude-notes.mjs';
export { CLAUDE_RULES } from './src/agent/claude-rules.mjs';
export { helpersOn, HELPER_NAMES, CODENAMES, codenameOf } from './src/agent/helpers.mjs';
export { MODEL_HOOKS } from './src/agent/way.mjs';
export { CodeIndex, partsOf, partKey, CUT as CODE_CUT, MARGIN as CODE_MARGIN } from './src/tools/codeindex.mjs';
// How the pieces that come along are chosen, for the code search check (models/evals/bench/code/).
export { choose } from './src/agent/search.mjs';
export { loadSettings } from './src/app/store.mjs';
// The Weights tab's file reader, for the weights reader check (models/evals/tools/reader-check.mjs)
// and the edited copy check, which reads the words an edit changes (models/evals/tools/edited-check.mjs).
export { weightsCore } from './src/app/weights-core.mjs';
// panelData: the Arena's control panel (/effort's rows, their steps and notes), which its runner hands to the page.
export { readLimits, modelWithLimits, testSettings, testLimits, testDefaults, TEST_CTX, panelData } from './src/app/limits.mjs';
// pickCards, designNotes and scoreCard: which cards go along with a request, for the UI component battle's card pick (models/evals/bench/design/components.mjs).
export { designDir, readCards, isDesignRequest, pickCards, designNotes, scoreCard } from './src/agent/design.mjs';
// The design studio's pieces and its build, for the studio check and the UI component battle's studio part.
export { studioDir, readPieces, pickPieces, studioNotes, buildStyles, readTheme, PIECE_CHARS } from './src/agent/studio.mjs';
export { layoutCheck, findChrome, PASSES as LAYOUT_PASSES } from './src/flows/layoutcheck.mjs';
// Pictures and PDFs drawn for the Vision check (models/evals/tools/vision-check.mjs), and the
// real app in a pseudo-terminal for its window check (loaded only when a check calls it).
export { textImage, textPdf, pdfText, mediaTool } from './src/tools/media.mjs';
export const runInPty = async (o) => (await import('./test/pty.mjs')).runInPty(o);
