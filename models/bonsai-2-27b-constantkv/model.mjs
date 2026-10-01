// Bonsai 2 27B ConstantKV (tfwnotops, 30 Sep 2026): Prism ML's Bonsai 2 27B, the same ternary weights byte
// for byte (Prism's MLX pack), with a runtime whose 16 full-attention layers keep a memory of a fixed size:
// the last 1,024 tokens and 8,192 picked ones exactly, every other token folded into a small running state.
// 1.27 GB at any length, where Bonsai's own cache grows 34 KB a token, so long conversations fit: up to
// 9,216 tokens it is the model's own attention, past that its author measured +0.0084 nat a token on unseen
// books and 40 of 40 pass keys at 32k. Added 1 Oct 2026 as a fifth choice beside Bonsai (Qwen stays the
// default), at 64k. Text only: it cannot look at pictures (a picture asks to switch model for that message).
// It runs on Apple's MLX, not llama.cpp: the engine 'mlx' (models/registry.mjs) is its own Python with the
// author's closed runtime (crystal_runtime 2.0.0, a research license: personal and research use, no
// commercial use, no taking it apart; `coding setup --model constantkv` shows it and asks first), and
// models/runtime/mlx/mlx-server.py speaks llama-server's API to the app.
import files from './files.json' with { type: 'json' };

export default {
  folder: 'bonsai-2-27b-constantkv',
  engine: 'mlx',
  engineOnly: true,
  id: 'constantkv',
  name: 'Bonsai 2 27B ConstantKV',
  by: 'tfwnotops, from Prism ML’s Bonsai 2 27B (Alibaba’s Qwen3.8 27B)',
  // Tokens a second on this Mac, 1 Oct 2026 (the runtime's own reading routine, 3,000 tokens of a book; and
  // 20 tokens written at 1,200): reading 39, writing 6.4, the author's 155–157 ms a token. With the Mac short
  // of memory (macOS compressing 8 GB, 1.5 GB of swap) the server read the app's start at 15–31 and wrote at 2–6.
  measured: { read: 39, write: 6.4 },
  watch: [],
  // A folder, not one file: the model's whole repository at a pinned revision, every file checked against
  // files.json (SHA-256). The runtime itself refuses a pack with a byte changed or added (its bundle.json).
  format: 'mlx',
  file: 'Ternary-Bonsai-2-27B-ConstantKV',
  repo: 'tfwnotops/Ternary-Bonsai-2-27B-ConstantKV',
  revision: 'a9489cfeade8348247d2615deb4dac8d5dea9a1f',
  url: 'https://huggingface.co/tfwnotops/Ternary-Bonsai-2-27B-ConstantKV/tree/a9489cfeade8348247d2615deb4dac8d5dea9a1f',
  files,
  bytes: files.reduce((n, f) => n + f.bytes, 0),
  license: {
    name: 'Crystal Runtime Research License 1.1',
    file: 'crystal_runtime/LICENSE',
    says: 'The runtime is free for personal use, research, evaluation and teaching, unmodified. It may not be used for commercial purposes, decompiled or redistributed modified; results published with it cite the author’s two papers. Commercial licenses: Foss Intelligence Holdings Ltd. The weights stay Apache 2.0 (Prism ML, from Qwen3.8 27B).',
  },
  // Qwen3.8-27B's layout, as Bonsai: 64 layers, every 4th full attention (4 KV heads of 256).
  attnLayers: 16, kvHeads: 4, headDim: 256, maxCtx: 262_144,
  // Its memory does not grow with the context (memory.mjs): nothing a token, the same at 16k as at 256k.
  constantState: true,
  // So it starts at 64k (their pick, 1 Oct 2026), and a smaller context would save nothing.
  ctxWant: 65_536,
  ctxFloor: 65_536,
  // Measured 1 Oct 2026 on the M4: 7.7 GB in use once loaded (fileInUse, of the 8.6 GB pack), and a peak of
  // 12.8 GB (MLX's own count) reading 4,500 tokens with the conversation's checkpoint kept: the state (1.27 GB
  // plus 0.15 for the other 48 layers), the checkpoint (up to as much again) and the working space of a
  // 512-token read. The author's peak at 32k was 12.2 GB.
  fileInUse: 0.9,
  stateBytes: 4.9e9,
  fixedStateBytes: 0,
  checkpoints: 0,
  // Two slots, as the app sees it: the conversation's (its state and checkpoint) and the side requests'
  // (sorting, helpers), each read into a memory of its own and dropped after (mlx-server.py).
  slots: 2,
  // The same chat template as Bonsai's (copied from Prism's GGUF), so the same levels and the same effort line
  // at the top of the prompt. Its template takes low, medium and xhigh; Low here sends no thinking at all.
  thinkingDefault: false,
  thinkingEffort: 'medium',
  thinkingLevels: [
    { id: 'low', label: 'Low', effort: null, note: 'answers straight away (fastest)' },
    { id: 'medium', label: 'Medium', effort: 'medium', note: 'thinks briefly first' },
    { id: 'high', label: 'High', effort: 'xhigh', note: 'thinks carefully first; can take minutes (stopped at 2,048 tokens)' },
  ],
  effortAtTop: true,
  thinkingBudget: 2048, // ~5 min at 6.4 tokens/s; the server ends the thinking there
  // Bonsai's settings: the same weights.
  sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 },
  thinkingSampling: { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.05 },
};
