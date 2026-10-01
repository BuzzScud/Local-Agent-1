// K2 Horizon 7B (MBZUAI's Institute of Foundation Models, 3 Sep 2026; Apache
// 2.0, fully open: weights, data and training code), IFM's own Q5_K_M: a third
// model to try beside Gemma and Qwen, added 30 Sep 2026. "7B" is its core; its
// own file counts 9.0B with the word table. Artificial Analysis Intelligence
// Index v4.3.2: 21, against Qwen3.5 9B's 11 and Gemma 4 12B's 14. Text only:
// it cannot look at pictures (a picture asks to switch model for that message).
// IFM's quality table for the GGUF files: Q5_K_M averages 80.1 over 7 tests,
// BF16 79.4, Q4_K_M 77.3, so the Q5 loses nothing measurable.
export default {
  folder: 'k2-horizon-7b',
  id: 'k2',
  name: 'K2 Horizon 7B',
  by: 'MBZUAI’s Institute of Foundation Models',
  // Tokens a second on this Mac, from the New model check of 30 Sep 2026 at 16k
  // (results/model-check-2026-09-30-2341): reading the app's instructions and
  // tools (2,491 tokens, not cached), and writing a small module, thinking off.
  // That check: 8 of 8, every tool call (off, Medium, High, json) a real call.
  measured: { read: 184, write: 15.1 },
  watch: [],
  // A new design ("k2-horizon"): only IFM's llama.cpp runs it so far (their
  // pull request to llama.cpp is not merged), so it keeps that engine even
  // when AGENTIC_ENGINE points the others at one.
  engine: 'ifm',
  engineOnly: true,
  file: 'K2-Horizon-7B-Q5_K_M.gguf',
  // Pinned to the repo's revision of 22 Sep 2026, so a later upload cannot
  // change the file under its checksum.
  url: 'https://huggingface.co/IFM/K2-Horizon-7B-GGUF/resolve/f6e1b25563ed4be3f4ff25d5950eaa59b1c85898/K2-Horizon-7B-Q5_K_M.gguf',
  sha256: '92a43adc88319346721e15bd8381ff7b6d31c4570a1c090ab8f75f665d92caee',
  bytes: 6_466_075_008,
  // Layout from the file's own header: 36 layers, every one full attention,
  // 8 kv heads of 128. ~76 KB a token at the 8-bit cache, 4.5 times Qwen's, so
  // 32k (about 8.6 GB in all) is as far as it goes on 16 GB; 64k would be 10.9.
  attnLayers: 36, kvHeads: 8, headDim: 128, maxCtx: 524_288,
  // Plain attention: no running state, and the cache can be cut back to a
  // shared start, so the server keeps no checkpoints.
  fixedStateBytes: 0,
  checkpoints: 0,
  slots: 2,
  // The share of its file a start takes out of the free memory (needBytes).
  // Measured 30 Sep 2026: free memory went down 5.71 GB loading it at 16k and
  // 4.39 at 8k, so 53–64% of the file in active use after the cache; the top
  // of that, rounded up, since memory a reply touches comes on top.
  fileInUse: 0.65,
  // n-grams already in the prompt speed up edits, as on the other models.
  spec: { type: 'ngram-simple', n: 12, m: 48 },
  // IFM's recommended settings (model card): temperature 1.0, top_p 0.95, as
  // vLLM and SGLang run it (no top_k, no min_p).
  sampling: { temperature: 1.0, top_p: 0.95, top_k: 0, min_p: 0 },
  thinkingSampling: { temperature: 1.0, top_p: 0.95, top_k: 0, min_p: 0 },
  // Its chat template has both switches: enable_thinking false answers at once,
  // and reasoning_effort picks how it thinks: "high" (its full thinking),
  // "medium" (a faster kind, <ifm|think_fast>) or "low" (<ifm|think_faster>).
  // Any other value makes the template stop with an error, so only these go.
  thinkingDefault: false,
  thinkingEffort: 'high',
  thinkingLevels: [
    { id: 'low', label: 'Low', effort: null, note: 'answers straight away (fastest)' },
    { id: 'medium', label: 'Medium', effort: 'medium', note: 'thinks in its faster mode first' },
    { id: 'high', label: 'High', effort: 'high', note: 'thinks fully first; can take minutes' },
  ],
  thinkingBudget: 4096,
  // Sent to its chat template with every request: the tool-call format it
  // writes (xml is its default; json and xml_typed are the others).
  templateKwargs: { tool_call_format: 'xml' },
  // Its thinking tags, for the client when the server leaves them in the text
  // (llama.cpp knows only the first pair from the template): agent/think-tags.mjs.
  thinkTags: [
    ['<ifm|think>', '</ifm|think>'],
    ['<ifm|think_fast>', '</ifm|think_fast>'],
    ['<ifm|think_faster>', '</ifm|think_faster>'],
  ],
};
