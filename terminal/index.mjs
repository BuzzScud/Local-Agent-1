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
export { runHeadless } from './src/headless.mjs';
export { Agent, claimsAlreadyThere } from './src/agent/agent.mjs';
export { systemPrompt, projectNotes, gitSummary, SESSION_MARK } from './src/agent/prompt.mjs';
export { toolSchemas } from './src/agent/tools.mjs';
export { outsidePath } from './src/agent/permissions.mjs';
export { streamChat } from './src/agent/client.mjs';
export { complete } from './src/flows/llm.mjs';
export { changeFlow } from './src/flows/change.mjs';
export { fixFlow } from './src/flows/fix.mjs';
export { Scratch } from './src/flows/scratch.mjs';
export { readResults } from './src/flows/results.mjs';
export { memoryDirs, readFacts, applyChanges, changeTrust, tidy, undoLast, openMemory, memoryNotes, filesIn } from './src/agent/facts.mjs';
export { recall, recallNotes } from './src/agent/recall.mjs';
export { notesDir, readNotes, leftOut, holdsSecret, bestPart, recallClaude, claudeText, notesCount, CUT as NOTES_CUT, MARGIN as NOTES_MARGIN } from './src/agent/claude-notes.mjs';
export { CLAUDE_RULES } from './src/agent/claude-rules.mjs';
export { helpersOn, HELPER_NAMES, CODENAMES, codenameOf } from './src/agent/helpers.mjs';
export { CodeIndex } from './src/tools/codeindex.mjs';
export { loadSettings } from './src/app/store.mjs';
export { readLimits, modelWithLimits } from './src/app/limits.mjs';
