// Qwen3-Reranker 0.6B (Qwen, Apache 2.0): the model /effort's Reranker row
// turns on. It writes nothing: it reads the request together with each piece
// the search found (a function, a file's card, a saved fact, a note) and says
// how well that piece answers it, so the best ones can go first. The
// embedder (BGE-M3) reads the two apart, which is why it is fast and why it
// can be fooled by a piece that only shares the request's words.
// Measured 29 Sep 2026 on the M4 (README.md): on 12 code requests the right
// function came in the first 3 for 10 (8 without it), ~1.9 s a search for 15
// pieces; on the 30 memory requests it did not beat BGE-M3 alone.
export default {
  folder: 'qwen3-reranker-0.6b',
  id: 'qwen3-reranker-0.6b',
  kind: 'rerank',
  name: 'Qwen3-Reranker 0.6B',
  short: 'Qwen3 0.6B',
  file: 'qwen3-reranker-0.6b-q8_0.gguf',
  url: 'https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/a02f48bb4f057028298c21fa033da2b30d7742d5/qwen3-reranker-0.6b-q8_0.gguf',
  sha256: '22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48',
  bytes: 639_153_184,
  // Room for one piece at a time with the request and the model's own
  // template (~300 tokens; a 2,000-character request fits too). Measured 29
  // Sep: 8k took 1.56 GB and 2k 1.08 GB with the same choices and speed.
  ctx: 2048,
  // How many of the search's best it reads, and how much of each. 25 pieces
  // of 1,500 characters took ~4 s and chose no better than 15 of 700 (~1.9 s).
  pool: 15,
  chars: 700,
};
