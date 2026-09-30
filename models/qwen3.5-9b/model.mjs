// Qwen3.5 9B (Alibaba's Qwen team, Feb 2026; Apache 2.0), Unsloth's UD-Q5_K_XL:
// a second model to try beside Gemma, added 29 Sep 2026 (their pick of file:
// the Q5, a bit smarter than Q4 and about Gemma's size). Since the speed test
// the same day it is Unsloth's MTP build of that file: the same weights plus
// Qwen's own MTP layer, its speed helper (see draft below). Same family as the
// Bonsai 27B's base: mostly Gated DeltaNet layers with a full-attention layer
// every 4th, so both engines run it (they list qwen35).
export default {
  folder: 'qwen3.5-9b',
  id: 'qwen',
  name: 'Qwen3.5 9B',
  // Who made it, and its speed on this Mac in tokens a second: the hub's Harness
  // tab shows these beside the other models'. read: the quick check of 29 Sep
  // 2026 (results/quick-check-2026-09-29). write: with its MTP helper, the mean
  // of the four kinds of writing in the speed test below.
  by: 'Alibaba’s Qwen team',
  measured: { read: 190, write: 18.1 },
  // What to watch for, seen in use by hand: the Harness tab's verdict says it.
  watch: ['Said “done” when it was not, three times on pages tried by hand (29 Sep 2026).'],
  // Kept under its own name here: Unsloth's MTP repo names it like the plain file.
  file: 'Qwen3.5-9B-MTP-UD-Q5_K_XL.gguf',
  url: 'https://huggingface.co/unsloth/Qwen3.5-9B-MTP-GGUF/resolve/main/Qwen3.5-9B-UD-Q5_K_XL.gguf',
  sha256: 'bb0aa4bf2acf4b6d97eca051a7af91200729e9e97449ce98785af9e70f6d703c',
  bytes: 6_874_345_824,
  // Layout from Qwen's config.json: 32 layers, every 4th full attention (8),
  // 4 kv heads of 256. ~17 KB a token at the 8-bit cache: about twice
  // Gemma's, so long contexts cost more here.
  attnLayers: 8, kvHeads: 4, headDim: 256, maxCtx: 262_144,
  // The 24 DeltaNet layers keep a fixed-size running state instead of a cache
  // (32 heads × 128 × 128 in f32 ≈ 2 MB each), counted per slot.
  fixedStateBytes: 0.05e9,
  // A running state cannot be rolled back, so the server keeps a few
  // checkpoints to reuse a shared start (like the 27B's).
  checkpoints: 3, checkpointBytes: 0.05e9,
  slots: 2,
  // The share of its file a start takes out of the free memory (needBytes).
  // Measured on this Mac 29 Sep 2026 at 64k, 2 slots, 5 requests
  // (results/quick-check-2026-09-29): free memory dropped 4.7 GB at load and
  // 5.1 at most, of which 1.55 was its own working memory; so ~52% of the
  // file stayed in active use. 0.55 as Gemma's, with the same small margin.
  fileInUse: 0.55,
  // n-grams already in the prompt speed up edits, as on the other models; the
  // fallback when the helper is off (AGENTIC_HELPER=off).
  spec: { type: 'ngram-simple', n: 12, m: 48 },
  // Qwen's own MTP layer, inside the model file (inFile: nothing extra to
  // download or load). It guesses the next word from Qwen's own state; Qwen
  // checks it and keeps only what it agrees with, so the output is Qwen's.
  // Speed test on this Mac 29 Sep 2026, app code, 64k, 2 slots, 2 runs each
  // (results/mtp-speed-2026-09-29, the rule fixed before the run in rule.md):
  // tokens/s plain → MTP: edit 22.6→24.0 · new code 14.0→17.3 · prose 13.9→15.0
  // · thinking 14.1→16.0; 1.12× over the four (the bar was 1.10×), no kind
  // slower, 2 conversations at once work. Its own working memory 1.61 → 2.03
  // GB (+0.42): computeBytes + a running-state copy per slot covers it.
  draft: {
    inFile: true,
    file: 'Qwen3.5-9B-MTP-UD-Q5_K_XL.gguf',
    bytes: 0,
    type: 'draft-mtp,ngram-simple',
    nMax: 1,
    helpsThinking: true,
    computeBytes: 0.35e9,
  },
  // Qwen's own settings (model card): non-thinking 0.7/0.8/20, thinking for
  // precise coding 0.6/0.95/20. Their presence_penalty 1.5 for general chat is
  // left out: it pushes against repeating a name, which code needs.
  sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 },
  thinkingSampling: { temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0 },
  // The template has one switch, enable_thinking (it thinks unless told not
  // to); there is no effort dial, so Low / High like Gemma.
  thinkingDefault: false,
  thinkingEffort: 'high',
  thinkingLevels: [
    { id: 'low', label: 'Low', effort: null, note: 'answers straight away (fastest)' },
    { id: 'high', label: 'High', effort: 'high', note: 'thinks first; stopped at 4,096 tokens' },
  ],
  thinkingBudget: 4096,
};
