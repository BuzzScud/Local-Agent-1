# BGE-M3

The small model that matches a request to the saved facts of Agentic Coder's memory
(`terminal/src/agent/recall.mjs`). By BAAI, MIT license; the GGUF file is
gpustack's (`bge-m3-Q8_0.gguf`, 605 MB). It runs in Agentic Coder's own engine in its
embedding mode (`llama-server --embedding --pooling cls`), beside the 27B.

`coding setup` downloads it. Without it the memory still works: facts are then
matched by their words.

## Why this one

Measured on 26 Sep 2026 on the M4: 20 saved facts and 30 requests, written
before any matcher was run. A request is right when the fact it needs comes
back (or nothing, when it needs nothing), and wrong when a fact that has
nothing to do with it comes back. Cut-offs were set on 15 other requests.

| How the facts were picked | Right, of 30 | Wrong, of 30 | Time per request |
|---|---|---|---|
| Qwen3-Embedding 0.6B (processor only) | 27 | 7 | 22 ms |
| The 27B picks from all 20 | 25 | 1 | 3.5 s |
| **BGE-M3** | **23** | **1** | **17 ms** |
| Words alone | 18 | 0 | under 1 ms |
| Julia 1 (Supersonic Labs) | 5 | 0 | 28 ms |

BGE-M3 used 214 MB and ran on the graphics chip with a 27B loaded.
Qwen3-Embedding 0.6B ran out of graphics memory there and needed 789 MB on
the processor. The bar was 27 right and at most 3 wrong; nothing reached both.

The test is small, written by hand and run once: it shows the order of the
methods more than their exact scores. Its files are in
`models/evals/dev/experiments/julia-recall/`; raw results stay on the Mac beside them, in
`results-embed-test/` (and the 27B picker's in `results-julia-1/`).
