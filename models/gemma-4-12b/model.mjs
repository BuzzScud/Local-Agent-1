// Gemma 4 12B it QAT (Google, quantization-aware 4-bit): the swap-in candidate
// measured against the 27B on 2026-09-28. Live-checked on this Mac the same
// morning: clean OpenAI tool calls through our engine, reads 126-128 tok/s,
// writes 13.2, 7.69 GB at 16k. The file was downloaded and sha-checked here.
export default {
  folder: 'gemma-4-12b',
  id: 'gemma',
  name: 'Gemma 4 12B QAT',
  file: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
  url: 'https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
  sha256: '90fd44e29e0d7cffeb0fd00dc73cfdab9ed0b0e95306ecf7821ea634c940c370',
  bytes: 6_716_356_800,
  // Layout read from the file's header: 48 layers, 5 of 6 sliding-window
  // (1024 tokens, a fixed-size cost), every 6th global. Only the 8 global
  // layers grow with the conversation: 1 kv head of 512, both k and v.
  // ~8.7 KB a token at the 8-bit cache: cheaper per token than the 27B.
  attnLayers: 8, kvHeads: 1, headDim: 512, maxCtx: 262_144,
  // The 40 sliding-window layers' caches are small and fixed (~1024 tokens
  // each); counted here per slot, like a running state.
  fixedStateBytes: 0.18e9,
  // Like the 27B's running state, a sliding-window cache cannot be rolled
  // back, so the server keeps a few checkpoints to reuse a shared start.
  checkpoints: 3, checkpointBytes: 0.18e9,
  slots: 2,
  // No guessing helper (draft) for this model yet; no n-gram spec either
  // until it is measured — the 27B's numbers do not carry over.
  // Google's sampling for the Gemma line.
  sampling: { temperature: 1.0, top_p: 0.95, top_k: 64, min_p: 0 },
  thinkingSampling: { temperature: 1.0, top_p: 0.95, top_k: 64, min_p: 0 },
  // Thinking is a plain on/off in Gemma 4's template (enable_thinking);
  // there is no effort dial. Low = off (default). /think on sends
  // enable_thinking true and the server's reasoning budget caps it.
  thinkingDefault: false,
  thinkingEffort: 'high',
  // Gemma has no effort dial, so there is no Medium: High turns thinking on
  // (reasoning_effort is ignored by its template; enable_thinking is what counts).
  thinkingLevels: [
    { id: 'low', label: 'Low', effort: null, note: 'answers straight away (fastest)' },
    { id: 'high', label: 'High', effort: 'high', note: 'thinks first; stopped at 2,048 tokens' },
  ],
  thinkingBudget: 2048,
};
