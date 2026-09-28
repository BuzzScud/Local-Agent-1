// BGE-M3 (BAAI, MIT): the small model that finds the saved facts of Agentic Coder's
// memory that fit a request. It writes nothing: it turns a text into 1,024
// numbers, and two texts that mean the same get numbers that are close, so
// "run the suite" lands next to "the tests". It runs in the same engine as
// the 27B, in its embedding mode, beside it.
// Measured 2026-09-26 on the M4 with a 27B loaded (20 facts, 30 requests, see
// README.md): 23 right and 1 wrong of 30, 17 ms a request, 214 MB.
export default {
  folder: 'bge-m3',
  id: 'bge-m3',
  kind: 'embedding',
  name: 'BGE-M3',
  file: 'bge-m3-Q8_0.gguf',
  url: 'https://huggingface.co/gpustack/bge-m3-GGUF/resolve/main/bge-m3-Q8_0.gguf',
  sha256: '950f4a8e5e19477a6d3c26d2f162233c20002c601f75e4b002e3239997821167',
  bytes: 634_553_760,
  pooling: 'cls',
  ctx: 2048,
  dims: 1024,
  // A fact comes back when it is this close to the request (1 = the same
  // meaning), and no further than `margin` behind the closest one. Both were
  // set on 15 requests kept apart from the 30 that were scored.
  cut: 0.56,
  margin: 0.02,
};
