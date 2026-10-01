// Part 2 of Agentic Coder: the models it runs and tests. The terminal (part 1)
// imports only this file. What it gets:
//   - the registry: every model's settings (one folder each), where the files
//     live on this Mac, and how to ask a model to think;
//   - the runtime: starting and sharing llama-server, choosing a context size
//     that fits the Mac's memory, the saved warm-up, and coding setup;
//   - the embedder: the small model that compares meanings, for the memory;
//   - the reranker: the small model that orders what the search found (/effort);
//   - a remote: a model on another machine (/remote), its key, its SSH tunnel,
//     and `coding serve`, which opens this Mac's model to another one;
//   - the Arena: starting its runner, and whether a run there holds the memory;
//   - the Test builder: making tests of your own (the hub's Test builder, over the Arena).
export { HOME, ENGINE, ENGINES, DEFAULT_ENGINE, engineOf, serverBinOf, SERVER_BIN, MODELS_DIR, LOG_DIR, SLOT_DIR, DEFAULT_PORT, MODELS, DEFAULT_MODEL, EMBEDDERS, DEFAULT_EMBEDDER, RERANKERS, DEFAULT_RERANKER, thinkingLevel, thinkingKwargs, modelPath, draftPath, visionPath, withVision, modelFolder } from './registry.mjs';
export { ModelServer, scanServers, serverArgs, hasDraft, stopIdleServers, stopServer, otherCopies, serverProcesses, runningServer, liveUsers, footprintOf, LINGER_SECS } from './runtime/server.mjs';
export { availableBytes, macMemory, gib, kvBytesPerToken, needBytes, draftBytes, freeWithHandBack, freeAfterQuit, loadedBytesOf, searchBytes, visionBytes, chooseContext, contextCheck, topMemoryUsers, appName, OVERHEAD } from './runtime/memory.mjs';
export { warmUp, pruneSaved, KEEP_SAVED } from './runtime/warmup.mjs';
export { REMOTE_KINDS, REMOTE_SOURCES, sourceOf, keyIdOf, CONNECTS, SERVE_PORT, DEFAULT_REMOTE, parseAddress, isPrivateHost, validSshDest, directUrl, remoteLabel, remoteProblem, remoteRisk, setEndpoint, dropEndpoint, endpointOf, authHeaders, modelFetch, keyStore, validKey, readKey, saveKey, removeKey, keyEnd, sshArgs, openTunnel, probe, GENERIC_REMOTE, remoteModel, connectRemote } from './runtime/remote.mjs';
export { serve, serveArgs, serveKey, lanAddresses, SERVE_KEY_FILE } from './runtime/serve.mjs';
export { CLAUDE_HOST, DEFAULT_CLAUDE_MODEL, CLAUDE_CTX, CLAUDE_MODELS, claudeName, claudeKeyProblem, claudeSdk, claudeClient, claudeCaps, claudeProbe } from './runtime/claude.mjs';
export { setup, getVision, RUNTIME } from './runtime/setup.mjs';
export { Embedder, embedderReady } from './runtime/embed.mjs';
export { Reranker, rerankerReady } from './runtime/rerank.mjs';
export { recordTest, readRecord, recordData, recordFile, writeSnapshot, codeLabel, sideBySide, KINDS as TEST_KINDS } from './evals/record.mjs';
export { readEdited, readEditedAll, writeEdited, removeEdited, editedModel, editedModels, editedFileName, editedManifest, modelById, EDITED_MANIFEST } from './runtime/edited.mjs';
// The Arena (a test on one model, or a battle of Gemma and Qwen): its runner, and the hold that makes an app window wait.
export { startBattle, battleHold, battleUrl } from './evals/battle/start.mjs';
export { RUN_TESTS, runCatalog, findRunTest, runTestById } from './evals/run-tests.mjs';
export { battleCounts } from './evals/battle/store.mjs';
// Every test prompt this Mac knows, so the memory never learns from a test pasted into the app.
export { testPrompts } from './evals/prompts.mjs';
// The Test builder: your own tests, read and changed straight in the arena's store (no runner needed).
export { builderData, suggestFor, readList, saveOwn, pasteTests, setLevel, duplicateOwn, deleteOwn, restoreOwn, exportOwn, importOwn, tryChecks } from './evals/battle/builder.mjs';
