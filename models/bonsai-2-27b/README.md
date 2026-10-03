# Bonsai 2 27B

Prism ML's ternary Bonsai 2 27B, `Ternary-Bonsai-2-27B-PQ2_0.gguf` (7.21 GB, sha256
`3907dc16…62ec1`), run with Prism's llama.cpp built from source with our Metal patch
([`models/runtime/engine`](../runtime/engine/README.md)), and a 1.14 GB helper that guesses
the next word. The model Bonsai Code uses today. Settings: [`model.mjs`](model.mjs).

## Measured on the M4 (16 GB)

| | |
|---|---|
| Writing | 10.8 tokens/s one word at a time (llama-bench); with the helper 13.8 on code, 13.9 on a rewrite, 10.6 on prose (was 9.6, 10.0, 9.8 with n-gram guessing) |
| Reading | 58–62 tokens/s |
| Memory | ~11.7 GB at 32k context with two slots and the helper (7.21 + 1.14 files, 3.4 working); 32k needs 11.9 GB free, else 16k. Without the helper (`AGENTIC_HELPER=off`) 9.3–9.8 GB |
| Start | first start ~90 s; later starts restore the saved warm-up in 0.1 s, a first reply in ~10 s |
| Effort | off by default: medium and high passed the same tasks and only cost time |

## Guessing ahead (25 Sep 2026)

The helper is DFlash2 re-fitted to this model (`naklitechie/Qwen3.8-27B-DFlash2-ternary-bonsai2`,
Q4_K_M, Apache 2.0). It reads the 27B's hidden states and guesses the next word; the 27B checks
the guess in the same pass as its own next word and keeps it when it agrees, so the text is
still the 27B's. One guess per check, measured at temperature 0.7 (tokens/s):

| Setup | Code | Rewrite | Prose | Guesses kept (code) |
|---|---|---|---|---|
| No guessing | 9.6 | 9.6 | 9.5 | |
| n-gram guessing (before) | 9.6 | 10.0 | 9.8 | 37% |
| **Helper, 1 guess (now)** | **13.8** | **13.9** | **10.6** | 96% |
| Helper, 3 guesses | 14.1 | 15.5 | 9.0 | 89% |
| Helper, 7 guesses | 12.0 | 14.0 | 4.5 | 71% |

It pays because of our engine patch: checking 2 words now costs 1.16× one word (2.48× in
Prism's release). More guesses win on code and lose on prose, where wrong guesses make each
check longer. The helper needs `-ub 128`: at the default 512 its working space (1.5 GB) ran
the GPU out of memory. On the 28 practice tasks (one run each, same code): 2,277 → 1,974 s,
27 → 28 passing; across the run the server wrote 10.6 → 13.7 tokens/s and read 52 either way.
Details: `bonsai-faster-2026-09-25.html` in the DOCS folder.

## Effort levels

The model's chat template has thinking off, or on at one of three efforts: `low`, `medium`
or `xhigh` (its default when thinking is on). Any other value, `high` included, is an
error in the template itself. Bonsai Code offers three:

| In Bonsai | Sent to the model | Code job (isPalindrome) | Arithmetic job | Right |
|---|---|---|---|---|
| Off | thinking off | 7 s | 3 s | 1 of 2 |
| Medium | `medium` | 184 thinking tokens, 19 s | 80 tokens, 15 s | 2 of 2 |
| High | `xhigh` | 517 tokens, 61 s | 86 tokens, 15 s | 2 of 2 |
| (not offered) | `low` | 466 tokens, 63 s | 50 tokens, 9 s | 2 of 2 |

One run each, 25 Sep 2026 (`results/effort-probe-2026-09-25.json`). Low thought about as
long as xhigh on the code job, so it adds nothing over Medium. The server stops any
thinking at 2,048 tokens. On the 18 practice tasks, Medium and High passed everything Off
did and only took longer, so Off stays the default.

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
| [`docs/bonsai-smart-2026-09-25.html`](../../docs/bonsai-smart-2026-09-25.html) | The "smarter and faster" round: grade, launch table, before/after charts, every task |
| [`docs/bonsai-night-2026-09-25.html`](../../docs/bonsai-night-2026-09-25.html) | The overnight check: practice at three thinking levels, screens, soak, speed, trigger words |
| [`docs/bonsai-code-27b-report.html`](../../docs/bonsai-code-27b-report.html) | The switch from the 8B to the 27B |
| [`docs/bonsai-8b-vs-27b-v2.html`](../../docs/bonsai-8b-vs-27b-v2.html) | 8B vs 27B, measured, with real outputs |

Raw results stay on the Mac in `results/` (not in git): `runs/` per practice run,
`night/` per night check, `words/` per real-request run.
