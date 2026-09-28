# The model server Bonsai Code builds

Bonsai Code runs Prism ML's llama.cpp (branch `prism`, commit `adfffbe`), built on this Mac
with one change of ours, `pq2-multicol.patch`. `bonsai setup` runs `build.mjs`, which clones
that commit, applies the patch and builds static `llama-server` and `llama-bench` into
`~/.agentic-coder/engine/<tag>/` (tag and commit: `ENGINE` in `models/registry.mjs`). It takes
about 3 minutes on the M4 and needs git, cmake and Apple's command line tools. By hand:
`node models/runtime/engine/build-now.mjs`.

`patch.mjs` holds the same patch as text so the one-file `bonsai` binary carries it; after
changing the patch run `node models/runtime/engine/make-patch.mjs` (a test checks they match).

## Why a build of our own

Bonsai guesses ahead: a small helper model (DFlash2, see `draft` in
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
release that Bonsai used before stays in `~/.agentic-coder/bin/` and can be removed.
