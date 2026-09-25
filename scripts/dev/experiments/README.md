# Experiments with Bonsai 2 27B (24–25 Sep 2026)

Run against the real model on the M4 (16 GB). Each starts its own llama-server
on a spare port and stops it; don't run two at once (two copies don't fit).

| Script | Question | What it found |
|---|---|---|
| `gguf-meta.mjs <file>` | What's inside the model file? | qwen35, 64 layers, full attention every 4th, 4 KV heads × 256 → 34,816 bytes per token at q8 |
| `thinking-cap.mjs` | Does `--reasoning-budget` stop the 27B's thinking? | Yes: a cap of 40 stopped at ~42 tokens and the answer followed |
| `checkpoint-memory.mjs <label> [flags]` | Why did memory grow to 5 GB? | Server defaults (32 checkpoints of 150 MiB + an 8 GB prompt store) reached 9.2 GB in 13 prompts; `--ctx-checkpoints 4 --cache-ram 0` stayed at 2.1 GB and a try still re-read only 540 of 2,049 tokens |
| `two-slots-and-saved-warmup.mjs` | Keep the instructions when a request is sorted; start fast next time? | Two slots: "hello" after a sorting request read 10 tokens (2.3 s, was a 26 s re-read). Saved warm-up: 0.14 s to save (210 MB), 0.09 s to restore, then "hello" in 2.5 s |

`../27b-realuse.mjs <port> <pid>` measures speed and memory against a running
server and runs 4 real checks (results from 24 Sep in `../27b-realuse-2026-09-24.json`).
