// Gemma 4 12B it QAT (Google, quantization-aware 4-bit): the swap-in candidate
// measured against the 27B on 2026-09-28. Live-checked on this Mac the same
// morning: clean OpenAI tool calls through our engine, reads 126-128 tok/s,
// writes 13.2, 7.69 GB at 16k. The file was downloaded and sha-checked here.
export default {
  folder: 'gemma-4-12b',
  id: 'gemma',
  name: 'Gemma 4 12B QAT',
  // Who made it, and its speed on this Mac in tokens a second: the hub's Harness
  // tab shows these beside the other models'. read: the live check of 28 Sep
  // 2026 (126-128). write: with both speed helpers, the mean of the four kinds
  // of writing in the speed probe below.
  by: 'Google',
  measured: { read: 127, write: 17.2 },
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
  // The share of its files a start takes out of the free memory (needBytes).
  // Measured on this Mac 28 Sep 2026 with the app's flags, both slots used, the
  // MTP helper on (models/gemma-4-12b/results/memory-calibration-2026-09-28):
  // Gemma's own total was 9.2 GB at 32k and 9.6 at 64k (7.2 of it the files),
  // but the free memory dropped only 4.5 and 5.3 GB: macOS kept 35-51% of the
  // file pages in active use (the most right after loading), the rest counted
  // as free. With 7.3 GB free the start caused no memory pressure and no swap.
  // 0.55 = the most seen plus a margin; the working parts stay as estimated
  // (0.2-0.3 GB above what was measured).
  fileInUse: 0.55,
  // Speed helpers (speculative decoding), measured on this Mac 28 Sep 2026
  // (models/gemma-4-12b/results/speed-probe-2026-09-28). Checking 2 words at
  // once costs Gemma 1.19× one word (4 words: 2.4×), so guesses stay short.
  // Words/s, plain → helper (edit a function · new code · prose · thinking):
  //   n-gram alone     12.6→25.0 · 13.3→13.3 · 13.2→13.3 · 12.8→11.7
  //   MTP, 1 guess     12.6→12.5 · 13.3→15.7 · 13.2→13.6 · 12.8→15.4
  //   both (this one)  12.6→24.3 · 13.3→16.2 · 13.2→14.0 · 12.8→14.2–15.4
  // 2 or 3 guesses were slower on edits and prose. n-gram alone is the
  // fallback when the helper file is missing or AGENTIC_HELPER=off.
  spec: { type: 'ngram-simple', n: 12, m: 48 },
  // Google's MTP drafter for Gemma 4 12B (works with any quant of it). It
  // guesses the next word from Gemma's own state; Gemma checks it and keeps
  // only what it agrees with, so the output is Gemma's. Unlike the 27B's
  // helper it speeds up thinking too, so it stays on at High (helpsThinking).
  // It shares Gemma's cache: no draft cache flags, default micro-batch.
  // Footprint beside Gemma at 32k: +0.4–0.5 GB.
  draft: {
    file: 'mtp-gemma-4-12b-it.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/mtp-gemma-4-12b-it.gguf',
    sha256: '145db9094bc0f85f1701e255a2ed216dcc9800fc8bc8631ad00905b456bd451b',
    bytes: 465_109_248,
    type: 'draft-mtp,ngram-simple',
    nMax: 1,
    ownCache: false,
    helpsThinking: true,
    computeBytes: 0.1e9,
  },
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
    { id: 'high', label: 'High', effort: 'high', note: 'thinks first; stopped at 4,096 tokens' },
  ],
  // Raised from 2,048 on 28 Sep: in test 2 its thinking ran into 2,048 before
  // it had finished. ~5 min at 13 tokens/s; the reply room follows it (agent.mjs).
  thinkingBudget: 4096,
};
