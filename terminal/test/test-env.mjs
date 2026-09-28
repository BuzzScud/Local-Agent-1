// Loaded before every test file (bunfig.toml preload). A hub started by a test
// takes any free port, never 8757, the real hub's: an open Agentic Coder hub tab in
// the browser would otherwise be answered by the test's hub, which has no
// model file, and Weights would say the model is not on this Mac (27 Sep).
process.env.AGENTIC_HUB_PORT = '0';
// The context helpers (src/agent/helpers.mjs) are off in the tests unless a
// test turns them on: each test checks the steps it expects, and a helper's
// test run or read would add steps of its own.
process.env.AGENTIC_HELPERS ??= 'off';
