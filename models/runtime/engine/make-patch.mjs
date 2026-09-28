// Regenerates patch.mjs from pq2-multicol.patch (run after changing the patch):
//   node models/runtime/engine/make-patch.mjs
// The patch itself comes from `git diff` in a checkout of Prism's llama.cpp at ENGINE.commit.
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const patch = readFileSync(new URL('pq2-multicol.patch', here), 'utf8');
if (/[`\\]|\$\{/.test(patch)) throw new Error('the patch has a backtick, backslash or ${ that a template string would change');
writeFileSync(new URL('patch.mjs', here), `// The Metal patch as text, so the one-file \`agentic-coder\` binary carries it: the same bytes as
// pq2-multicol.patch (a test checks). Made by make-patch.mjs; do not edit by hand.
export const PATCH = \`${patch}\`;
`);
console.log('wrote patch.mjs');
