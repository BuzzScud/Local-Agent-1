// Test material, not a model of the app: Bonsai 2 27B's settings as they were when it left /model
// (9 Oct 2026). The memory math and the server's flags are checked against them: a measured model
// with a helper in a file of its own (-md) and three thinking levels.
// Bonsai 2 27B (Prism ML, ternary PQ2_0): Qwen3.8 27B with every weight cut
// to -1, 0 or +1, keeping 98.2% of the full model's scores on Prism's 14 tests.
// It was the model Bonsai Code ran until 28 Sep 2026, then left /model to free
// the disk; back on 1 Oct 2026 as the fourth choice (Qwen stays the default).
// Everything about this model lives in this folder: its settings (below), what
// was measured (README.md), the report pages (reports/) and the raw test runs
// (results/, not in git). The terminal never reads this file directly; it asks
// models/index.mjs for a model by id.
export default {
  folder: 'bonsai-2-27b',
  // Its ternary file (PQ2_0) runs only on Prism's llama.cpp with our patch, so
  // it keeps that engine even when AGENTIC_ENGINE points the others at one.
  engine: 'prism',
  engineOnly: true,
  // 'bonsai': the id its runs already carry in the test record (models/evals/record.mjs).
  id: 'bonsai',
  name: 'Bonsai 2 27B',
  by: 'Prism ML, from Alibaba’s Qwen3.8 27B',
  // Tokens a second on this Mac, from the server log across the 28 practice
  // tasks of 25 Sep 2026 with the helper below (results/runs/2026-09-25-fast):
  // reading 52.3, writing 13.7.
  measured: { read: 52, write: 13.7 },
  watch: [],
  file: 'Ternary-Bonsai-2-27B-PQ2_0.gguf',
  // Its links (helper and vision too) are pinned to the repos' revisions of 24–25
  // Sep 2026 since 3 Oct 2026, so a later upload cannot change a file under its checksum.
  url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/resolve/b072e1d3b35a0a630cece372c2127528e0994386/Ternary-Bonsai-2-27B-PQ2_0.gguf',
  sha256: '3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1',
  bytes: 7_206_168_928,
  // The file's own chat template is used: it already handles tool calls and
  // the thinking switch (enable_thinking + reasoning_effort).
  // Layout read from the file (Qwen3.8-27B): 64 layers, but only every 4th
  // keeps a per-token cache (4 KV heads of 256); the other 48 keep a
  // fixed-size running state.
  attnLayers: 16, kvHeads: 4, headDim: 256, maxCtx: 262_144,
  fixedStateBytes: 0.16e9,
  // fileInUse is not measured for this model, so a start counts its whole file.
  // To pick a conversation up again, the server saves checkpoints of that
  // running state (150 MiB each). Its defaults (32 checkpoints plus an 8 GB
  // store of old prompts) grew to 9 GB in 13 prompts; 4 checkpoints and no
  // store stay at ~2.1 GB and still skip re-reading a try's shared start.
  checkpoints: 3, checkpointBytes: 0.157e9,
  // Two slots: the conversation keeps slot 0, side requests (sorting a
  // request, the tries) use slot 1, so they never wipe the conversation's
  // read-in instructions. Each slot has its own running state and checkpoints.
  slots: 2,
  // n-gram speculative decoding (see serverArgs): lookup 12 tokens, draft up to 48.
  // Used only when the helper below is missing.
  spec: { type: 'ngram-simple', n: 12, m: 48 },
  // The guessing helper: DFlash2 re-fitted to this ternary model (Apache 2.0). It
  // guesses the next words from the model's own hidden states; the model checks
  // them in one pass and keeps what it agrees with, so the output is the model's.
  // Needs our engine build (registry ENGINE): Prism's release checks 2-8 words as
  // slowly as writing them one by one on the M4. Measured 2026-09-25 on the M4,
  // temperature 0.7 (words/s, plain → helper): code 9.6 → 13.8, rewrite 9.6 → 13.9,
  // prose 9.5 → 10.6 with 1 guess per check (3 guesses: prose 9.0; 7: code 12.0,
  // prose 4.5). computeBytes: its working space at -ub 128 (372 MiB; 1.5 GB at the
  // default 512, which does not fit beside 32k) plus its own cache; with two slots at
  // 32k the server's footprint went 2.38 → 3.39 GB and the helper file adds 1.14.
  draft: {
    file: 'Qwen3.8-27B-DFlash2-r3-Q4_K_M.gguf',
    url: 'https://huggingface.co/naklitechie/Qwen3.8-27B-DFlash2-ternary-bonsai2/resolve/0059b38aa255698b1a87305eb3fbb5a3cfd616e2/Qwen3.8-27B-DFlash2-r3-Q4_K_M.gguf',
    sha256: '6c11956fde5f52867e3255991b30405ae931d205a35caf3fc87a2c3865aa6530',
    bytes: 1_143_006_912,
    type: 'draft-dflash',
    nMax: 1,
    ubatch: 128,
    computeBytes: 0.7e9,
  },
  // Its vision add-on (Prism's Q8_0 projector): loaded with the model only once
  // a picture is attached (--mmproj). Not tried on this Mac yet; computeBytes
  // and minTokens are Qwen3.5 9B's, the same family's vision.
  vision: {
    file: 'Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/resolve/b072e1d3b35a0a630cece372c2127528e0994386/Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf',
    sha256: '6807ede61d570bb86ba34b756a0fa109edc33668604de867c6ea6d8f1d631903',
    bytes: 629_246_976,
    computeBytes: 0.3e9,
    minTokens: 1024,
  },
  // Measured 2026-09-24 on the M4: 10.4 tokens/s writing, 61 reading.
  // Thinking starts off; /think on turns on PrismML's "medium" effort (about
  // 200 tokens on a small task). "xhigh", the model's default, can think for
  // minutes and "high" errors in this build.
  thinkingDefault: false,
  thinkingEffort: 'medium', // the level /think on (and --think) uses
  // The levels /model offers: Low answers straight away (no thinking), the
  // fastest and the default. effort is the chat template's reasoning_effort
  // (the template's own "low" acts like "xhigh" in this build, and "high"
  // errors, so Low sends no thinking at all and High sends "xhigh").
  thinkingLevels: [
    { id: 'low', label: 'Low', effort: null, note: 'answers straight away (fastest)' },
    { id: 'medium', label: 'Medium', effort: 'medium', note: 'thinks briefly first (about 200 tokens on a small task)' },
    { id: 'high', label: 'High', effort: 'xhigh', note: 'thinks carefully first; can take minutes (stopped at 2,048 tokens)' },
  ],
  // The template writes "Reasoning effort is set to xhigh…" as the first line of the prompt
  // (Medium writes nothing there), so a turn keeps one effort from step to step: a change reads
  // the whole conversation again (agent.mjs stepEffort; 1 Oct, three 3-minute reads in one turn).
  effortAtTop: true,
  thinkingBudget: 2048, // ~3 min at 10 tokens/s; the server ends thinking there
  // PrismML's instruct settings without its presence penalty (which would
  // push code away from repeating names and brackets); these are the
  // settings tested on real jobs.
  sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 },
  thinkingSampling: { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.05 },
};
