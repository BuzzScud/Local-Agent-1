// Loaded before every test file (bunfig.toml preload). A hub started by a test
// takes any free port, never 8757, the real hub's: an open Bonsai hub tab in
// the browser would otherwise be answered by the test's hub, which has no
// model file, and Weights would say the model is not on this Mac (27 Sep).
process.env.BONSAI_HUB_PORT = '0';
