// The page's own scripts parse (a page whose script has a syntax error shows
// but does nothing). Scripts loaded with src are not the page's own.
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(process.argv[2], 'utf8');
let n = 0;
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  if (/\bsrc\s*=/.test(m[1]) || !m[2].trim()) continue;
  if (/type\s*=\s*["']?module/i.test(m[1])) { n++; continue; } // a module cannot be parsed this way; rare in a one-file page
  try { new vm.Script(m[2]); n++; } catch (e) { console.log(`a script in the page does not parse: ${e.message}`); process.exit(1); }
}
if (!n) { console.log('the page has no script of its own'); process.exit(1); }
