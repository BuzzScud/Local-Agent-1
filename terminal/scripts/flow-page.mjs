// Saves a dated copy of the hub's Flow tab: one self-contained HTML file.
//   bun terminal/scripts/flow-page.mjs                   writes cli docs/diagrams/agentic-coder-flow-diagram-<today>.html
//   bun terminal/scripts/flow-page.mjs <file.html>       writes that file instead
// The tab itself is drawn by the app each time it opens (src/app/flow-hub.mjs),
// from the model list, the settings in use and the newest test the models share.
// This keeps what it showed on one day: the same page, with the date in its header.
// To change a drawing, change flow-hub.mjs (the steps are in src/app/steps.mjs).
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { flowData, flowPage } from '../src/app/flow-hub.mjs';

const repo = join(import.meta.dir, '..', '..');
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const out = process.argv[2] ?? (await import('../../docs/tools/to-docs.mjs')).docsPath(`diagrams/agentic-coder-flow-diagram-${day}.html`);
const html = flowPage(flowData(repo), { dated: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) });
// The diagrams are mirrored to the public repo: a page that names this Mac's home folder is not written.
if (html.includes(homedir())) { console.error('not written: the page names the home folder of this Mac'); process.exit(1); }
writeFileSync(out, html);
console.log('wrote', out.replace(homedir(), '~'), html.length, 'bytes');
