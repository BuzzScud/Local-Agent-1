// Part 1 of Bonsai Code: the terminal. The models part (part 2) imports only
// this file, for its bench, its tools and its probes. What it gets:
//   - the agent: one request run headless, the agent itself, and the
//     instructions and tools it is given;
//   - the client: one chat, or one short side request, against a server;
//   - the flows and their scratch copy, for the probes that watch a flow work.
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
