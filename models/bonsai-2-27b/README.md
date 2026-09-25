# Bonsai 2 27B

Prism ML's ternary Bonsai 2 27B, `Ternary-Bonsai-2-27B-PQ2_0.gguf` (7.21 GB, sha256
`3907dc16…62ec1`), run with Prism's llama.cpp build `prism-b10735`. The model Bonsai
Code uses today. Settings: [`model.mjs`](model.mjs).

## Measured on the M4 (16 GB)

| | |
|---|---|
| Writing | 10.8 tokens/s (llama-bench); 10–11 on rewrites with n-gram speculation, 8.2 without under load |
| Reading | 58–62 tokens/s |
| Memory | 9.3–9.8 GB at 32k context with two slots (7.21 file + cache + checkpoints); drops to 16k when the Mac is short |
| Start | first start ~90 s; later starts restore the saved warm-up in 0.1 s, a first reply in ~10 s |
| Thinking | off by default: medium and high passed the same tasks and only cost time |

Engine settings that were tried and made no difference: batch sizes 128–2048, flash
attention off, an f16 cache. PTQ1_0 was ~10% slower. Writing several answers at once is
slower in total on this engine.

## As a coding agent (25 Sep 2026)

Overall grade **B+**: a dependable junior for small, tested changes in a project it can
read whole; slow and still unproven on big projects.

| Area | Grade |
|---|---|
| Small tasks with tests (18 of 18, 41 s average) | A |
| Asking when unclear | A− |
| Safety | A |
| Several files at once (137–375 s) | B |
| Real-sized projects | C+ |
| Speed (the model's ceiling) | C+ |
| Knowing when it is done (27 of 28) | B− |

## Reports

| Page | What it shows |
|---|---|
| [`reports/bonsai-smart-2026-09-25.html`](reports/bonsai-smart-2026-09-25.html) | The "smarter and faster" round: grade, launch table, before/after charts, every task |
| [`reports/bonsai-night-2026-09-25.html`](reports/bonsai-night-2026-09-25.html) | The overnight check: practice at three thinking levels, screens, soak, speed, trigger words |
| [`reports/bonsai-code-27b-report.html`](reports/bonsai-code-27b-report.html) | The switch from the 8B to the 27B |
| [`reports/bonsai-8b-vs-27b-v2.html`](reports/bonsai-8b-vs-27b-v2.html) | 8B vs 27B, measured, with real outputs |

Raw results stay on the Mac in `results/` (not in git): `runs/` per practice run,
`night/` per night check, `words/` per real-request run.
