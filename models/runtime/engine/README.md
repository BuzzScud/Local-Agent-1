# The model servers Agentic Coder builds

Agentic Coder builds llama.cpp's `llama-server` from source, on this Mac, as one of two
engines (`ENGINES` in `models/registry.mjs`). Each model names the engine it runs on
(`engine` in its `model.mjs`); a model that names none runs on `DEFAULT_ENGINE`.

| Engine | Source | Runs |
|---|---|---|
| `official` | llama.cpp's own release (`ggml-org/llama.cpp`, v0.5.0, commit `7fe450e`), as released | what Google's guide for Gemma 4 asks for |
| `prism` | Prism ML's llama.cpp (branch `prism`, commit `adfffbe`) plus one change of ours, `pq2-multicol.patch` | the Bonsai 27B's ternary file (PQ2_0), which only Prism's build reads |

`coding setup` runs `build.mjs` for the engines the model in use and the memory's matcher
need: it clones the engine's commit, applies our patch when the engine has one, and builds
static `llama-server` and `llama-bench` into `~/.agentic-coder/engine/<tag>/`. It takes about
3 minutes on the M4 and needs git, cmake and Apple's command line tools. By hand:
`node models/runtime/engine/build-now.mjs [official|prism]`.

`AGENTIC_ENGINE=official` (or `prism`) runs everything on one engine: for a comparison, or
as a way back. A saved warm-up belongs to the engine that saved it
(`models/runtime/warmup.mjs`), so switching reads the instructions again once.

`patch.mjs` holds the same patch as text so the one-file `agentic-coder` binary carries it; after
changing the patch run `node models/runtime/engine/make-patch.mjs` (a test checks they match).

## Why a build of our own

With the 27B model, Agentic Coder guesses ahead: a small helper model (DFlash2, see `draft` in
`models/bonsai-2-27b/model.mjs`) proposes the next word and the 27B checks the guess in the
same pass as its own next word. That only pays if checking two words costs about what writing
one does. In Prism's release it did not: on the M4's GPU the model file's format (PQ2_0) fell
back to a general routine that spent the same time per word whether words came one at a time
or in a batch.

The patch adds a PQ2_0 routine for 2 to 8 words at once (`kernel_mul_mv_pq2_0_multicol` in
`ggml/src/ggml-metal/kernels/mul_mv.metal`): each weight byte is decoded once and used for
two words. Whole model on the M4, time for a batch compared with one word:

| Words at once | Prism's release | With the patch |
|---|---|---|
| 2 | 2.5× | 1.16× |
| 4 | 4.1× | 1.75× |
| 8 | 8.3× | 3.2× |

Results match the CPU reference on all 151 PQ2_0 multiply checks in `test-backend-ops`.
`GGML_METAL_PQ2_MULTICOL=0` switches the routine off; `GGML_METAL_PQ2_MC_NR0` (4 or 8) and
`GGML_METAL_PQ2_MC_MAXC` (2 to 8) retune it for another chip.

A new build gets a new tag, so an old build is never replaced while it is in use. Prism's
release that Agentic Coder used before stays in `~/.agentic-coder/bin/` and can be removed.
