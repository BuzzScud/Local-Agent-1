// The Weights tab's file reader (the <script id="core"> in weights.html), outside the page: the
// one place that builds it from the page's text, so the page and everything that reads a model
// file the same way (the edit writer, gguf-edit.mjs; the weights reader check,
// models/evals/tools/reader-check.mjs) can never disagree.
//   coreFrom(html)   from the page's text (gguf-edit.mjs imports the page as text, which works
//                    inside the built app but only under Bun)
//   weightsCore()    from the page's own file, read here (for Node as well as Bun)
import { readFileSync } from 'node:fs';

export function coreFrom(html) { const mod = { exports: {} }; new Function('module', html.match(/<script id="core">([\s\S]*?)<\/script>/)[1])(mod); return mod.exports; }
let core = null;
export const weightsCore = () => (core ??= coreFrom(readFileSync(new URL('./weights.html', import.meta.url), 'utf8')));
