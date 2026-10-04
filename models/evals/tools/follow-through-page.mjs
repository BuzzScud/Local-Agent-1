// The results page of the Follow-through replay (follow-through-replay.mjs): one self-contained HTML file for
// the DOCS folder, opened from the run's line in the hub's Tests tab, drawn by check-page.mjs (Result · The
// checks · Each run · What it said · How it was measured). The runs' words come cleaned by the runner: no
// address, the throwaway home as ~.
//   replayPage({ summary, rows, prev, raw }) → html
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCheckPage, sec } from './check-page.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mins = (x) => (x == null ? '—' : x >= 90 ? `${(x / 60).toFixed(1)} min` : sec(x));
const num = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'));

export function replayPage({ summary: s, rows, prev = null, raw = [] }) {
  let runs = [];
  try { runs = JSON.parse(readFileSync(join(raw[0]?.startsWith('/') ? raw[0] : join(import.meta.dirname, '..', '..', '..', raw[0] ?? ''), 'runs.json'), 'utf8')); } catch { /* a page drawn without its runs: the tabs say so */ }
  const both = s.sides.includes('before');
  const a = s.avg?.after ?? {};
  const b = s.avg?.before ?? {};
  const cards = [
    { k: 'Time a run', v: mins(a.secs), sub: both ? `before: ${mins(b.secs)}` : 'this code only', dir: 'reported, not judged' },
    { k: 'Steps a run', v: num(a.steps), sub: both ? `before: ${num(b.steps)}` : 'this code only', dir: 'reported, not judged' },
    { k: 'Tokens written a run', v: num(a.outTokens), sub: both ? `before: ${num(b.outTokens)}` : 'this code only', dir: 'reported, not judged' },
    { k: 'Questions to you a run', v: a.asked == null ? '—' : a.asked.toFixed(1), sub: both ? `before: ${b.asked == null ? '—' : b.asked.toFixed(1)}` : 'this code only', dir: 'asking at a wall is the point' },
  ];
  const eachRun = runs.length ? `<div class="table-wrap"><table><thead><tr><th>Run</th>${rows.map((r) => `<th>${esc(r.name)}<small>a slip is ✗</small></th>`).join('')}<th class="num">Time<small>lower is faster</small></th><th class="num">Steps</th></tr></thead><tbody>${runs.map((r) => `<tr><td><b>${esc(r.side === 'before' ? 'Before' : 'This code')} ${r.n}</b></td>${r.slips ? rows.map((row) => { const x = r.slips.find((y) => y.id === row.id); return `<td class="${x?.hit ? 'no' : 'ok'}">${x?.hit ? '✗' : '✓'} <span class="dim small">${esc(x?.detail ?? '')}</span></td>`; }).join('') : `<td colspan="${rows.length}" class="no">${esc(r.broken)}</td>`}<td class="num">${mins(r.secs)}</td><td class="num">${num(r.steps)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dim">The runs’ own file was not found beside this page’s results.</p>';
  const said = runs.length ? runs.map((r) => `<h3>${esc(r.side === 'before' ? 'Before' : 'This code')} ${r.n} · ${mins(r.secs)}</h3>${r.asks?.length ? `<p class="dim small">Asked you: ${r.asks.map((q) => `“${esc(q.text)}” → “${esc(q.answer)}”`).join(' · ')}</p>` : '<p class="dim small">It asked you nothing.</p>'}<blockquote>${esc(r.final || '(no answer)').replace(/\n/g, '<br>')}</blockquote>${r.notes?.length ? `<details><summary class="dim small">The app’s lines (${r.notes.length})</summary><ul class="small">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}`).join('') : '';
  return buildCheckPage({
    title: 'Follow-through replay · the 4 Oct calculator task, before and after', summary: s, rows, prev, raw, cards, first: false,
    passRule: 'none of slips 1–5 in any run of this code',
    verdict: s.pass ? `Yes: in ${s.runs === 1 ? 'its run' : `all ${s.runs} runs`}, this code made none of the five slips${both ? '; the code before made the ones counted in tab 2' : ''}.` : `No: this code still made ${rows.filter((r) => !r.ok).map((r) => esc(r.name).toLowerCase()).join('; ')}.`,
    more: [
      { id: 'runs', name: 'Each run', html: eachRun },
      { id: 'said', name: 'What it said', html: `<div class="said">${said}</div>` },
    ],
    how: [
      'The request, word for word as typed on 4 Oct 2026 (typos kept), with the calculator’s page and the folder: “analyze the link …/index.html . can we use the calcualtor to validate out math in this folder? can you check? ‘…/forecast export work 3OCT’ can you take all of the formulas from the link and test them all locally?”',
      'The model: the same one on the same Ollama service, with the same settings (thinking on, effort High, a 4,096-token thinking cap, 40 output lines, Look first 30 s), in Bypass permissions, started in the home folder, as that run was. Each run starts fresh in a throwaway home whose Desktop holds a copy of the folder: the three exports and the three pages. (The original folder held 8 entries; the two not known are left out.)',
      'Questions are answered as the owner would: “Work in that folder?” → stay; a question about the login → “I don’t have a login for it. Use the calculator’s public calculate endpoint to check the formulas from the report in my folder instead.”; anything else → “Use your judgment, and tell me plainly what you found.”',
      'Each run goes through <code>coding -p --loop-events</code> (the loops’ own way of answering questions) and leaves its whole conversation (<code>AGENTIC_TRANSCRIPT</code>); the slips are counted from it. 1: a Read, Search, List or Edit of a path that is not there, answered “does not exist” although a close name was in its folder. 2: a long page, table or JSON file read as an outline with no parts. 3: the calculator answered that it needs a login and the run neither asked about it nor said it in the answer. 4: the answer says all passed or it works while the last run of checks (a command whose output counts passed and failed) failed. 5: no TodoWrite. 6: a reply that says it found what it needs while files were seen only as outlines with none of their lines.',
      'The rule, written before the first run: this code passes when none of slips 1–5 happens in any of its runs. Slip 6 is counted, not judged. Time, steps and tokens are reported, not judged: asking at the login is meant to change what a run does.',
      'Not measured here: whether its numbers are right. That is the second look’s job, and what it said is under each run in tab 4.',
    ],
  });
}
