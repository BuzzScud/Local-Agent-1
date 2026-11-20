// The results page of the hearth door check (hearth-door-check.mjs): one self-contained HTML file for the DOCS folder,
// opened from the run's line in the hub's Tests tab, drawn by check-page.mjs (Result · The checks · Side by side · How it
// was measured).   hearthPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US'));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

// The page: the checks, then the two runs side by side.
export function hearthPage({ summary: s, rows, prev = null, raw = [] }) {
  const b = s.arms?.before, a = s.arms?.after;
  const line = (k, dir, x, y, show = n) => `<tr><td><b>${esc(k)}</b><small class="dim"> · ${esc(dir)}</small></td><td class="num">${show(x)}</td><td class="num">${show(y)}</td></tr>`;
  const side = b && a ? `<div class="table-wrap"><table><thead><tr><th>Measure</th><th class="num">Before (${esc(s.beforeCode)})</th><th class="num">After (${esc(s.code)})</th></tr></thead><tbody>
${line('The whole request', 'lower is faster', b.secs, a.secs, sec)}
${line('Working time (reading + writing)', 'lower is faster', b.workSecs, a.workSecs, sec)}
${line('Waiting (in hearth’s line, or one at a time here)', 'lower is better', b.waitSecs, a.waitSecs, sec)}
${line('Conversation steps', 'count', b.steps, a.steps)}
${line('Side jobs', 'count', b.side, a.side)}
${line('Side jobs that came back with words', 'higher is better', b.sideWords, a.sideWords)}
${line('Steps taken over by a newer job', 'lower is better', b.taken, a.taken)}
${line('Thinking in what the 27b wrote', 'lower is faster', b.thinkShare, a.thinkShare, pct)}
${line('Tokens written', 'count', b.wrote, a.wrote)}
${line('The change made, tests passing', 'yes is right', b.done ? 'yes' : 'no', a.done ? 'yes' : 'no', (x) => x)}
</tbody></table></div>` : '<p>Only one side ran.</p>';
  return buildCheckPage({
    title: `hearth door check · ${s.model}`, summary: s, rows, prev, raw,
    passRule: 'all 5 checks on the after side',
    more: [{ id: 'side', name: 'Side by side', html: side }],
    how: [`The same request twice through <code>coding -p</code>, each in a throwaway home on the owner's hearth key (the Keychain's, handed over as AGENTIC_REMOTE_KEY, never on a command line): ${esc(s.beforeCode)} first, then ${esc(s.code)}. The request: <i>${esc(s.task)}</i>`, 'Each request’s seconds, reading, writing and thinking come from that home’s activity record (the door passes Ollama’s own counts). Waiting is the request’s seconds less its reading and writing.', `Model: ${esc(s.model)}, so every request goes to hearth’s 27b on Poseidon, never the copy kept for customers.`],
  });
}

