// Part 2 of Bonsai Code: the models it runs and tests. The terminal (part 1)
// imports only this file. What it gets:
//   - the registry: every model's settings (one folder each), where the files
//     live on this Mac, and how to ask a model to think;
//   - the runtime: starting and sharing llama-server, choosing a context size
//     that fits the Mac's memory, the saved warm-up, and bonsai setup.
export { HOME, ENGINE, SERVER_BIN, MODELS_DIR, LOG_DIR, SLOT_DIR, DEFAULT_PORT, MODELS, DEFAULT_MODEL, thinkingLevel, thinkingKwargs, modelPath, draftPath, modelFolder } from './registry.mjs';
export { ModelServer, scanServers, serverArgs, hasDraft } from './runtime/server.mjs';
export { availableBytes, kvBytesPerToken, needBytes, draftBytes, chooseContext, OVERHEAD } from './runtime/memory.mjs';
export { warmUp, pruneSaved, KEEP_SAVED } from './runtime/warmup.mjs';
export { setup, RUNTIME } from './runtime/setup.mjs';
