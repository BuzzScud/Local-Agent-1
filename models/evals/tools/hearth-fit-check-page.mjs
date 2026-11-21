// The results page of the hearth fit check (hearth-fit-check.mjs): one self-contained HTML file for the DOCS folder, opened from
// the run's line in the hub's Tests tab, drawn by check-page.mjs (Result · The checks · Each task · How it was measured).
// fitPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US'));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function fitPage({ summary: s, rows, prev = null, raw = [] }) {
  const B = s.arms?.before ?? [], A = s.arms?.after ?? [];
  const cell = (r, f) => (r ? f(r) : '—');
  const tasks = (s.tasks ?? []).map((t) => {
    const b = B.find((r) => r.task === t.id), a = A.find((r) => r.task === t.id);
    const line = (k, dir, f) => `<tr><td><b>${esc(k)}</b><small class="dim"> · ${esc(dir)}</small></td><td class="num">${cell(b, f)}</td><td class="num">${cell(a, f)}</td></tr>`;
    return `<h3>${esc(t.name)}</h3><p class="dim"><i>${esc(t.prompt)}</i></p><div class="table-wrap"><table><thead><tr><th>Measure</th><th class="num">Main (${esc(s.beforeCode ?? '—')})</th><th class="num">This code (${esc(s.code)})</th></tr></thead><tbody>
${line('The whole run', 'lower is faster', (r) => `${sec(r.secs)}${r.killed ? ' (stopped at its limit)' : ''}`)}
${line('Waiting after its last request', 'lower is better', (r) => (r.killed ? 'never ended' : sec(r.idleAfter)))}
${line('Working time (reading + writing)', 'lower is faster', (r) => sec(r.workSecs))}
${line('Steps · side jobs', 'count', (r) => `${n(r.steps)} · ${n(r.side)}`)}
${line('Side jobs back with words', 'higher is better', (r) => `${n(r.sideWords)} of ${n(r.side)}`)}
${line('Requests that left hearth', 'lower is better', (r) => (r.offHearth.length ? esc(r.offHearth.join(', ')) : '0'))}
${line('Taken over · failed', 'lower is better', (r) => `${n(r.taken)} · ${n(r.failed)}`)}
${line('Thinking in what was written', 'lower is faster', (r) => pct(r.thinkShare))}
${line('The work', 'right is right', (r) => `${r.ok ? 'right' : 'wrong'}<br><small class="dim">${esc(r.why)}</small>`)}
</tbody></table></div>`;
  }).join('\n');
  return buildCheckPage({
    title: `hearth fit check · ${s.model}`, summary: s, rows, prev, raw,
    passRule: 'all 6 checks on this code’s side',
    more: [{ id: 'tasks', name: 'Each task', html: tasks || '<p>No task ran.</p>' }],
    how: [
      `Four pieces of work, each in a fresh copy of the small shop through <code>coding -p</code>, first on GitHub's main (${esc(s.beforeCode ?? '—')}), then on this code (${esc(s.code)}), one task at a time so both sides see the same hour on hearth.`,
      `Each run had a throwaway home on the owner's hearth key (the Keychain's, handed over as AGENTIC_REMOTE_KEY), with the owner's saved thinking (${esc(String(s.thinking))}) and effort (${esc(String(s.effort))})${s.profiles ? ' and a copy of their /profiles in which every server other than hearth is a closed port, so a job that would leave hearth fails where it can be counted and runs nowhere' : ''}.`,
      'Seconds, reading, writing and thinking come from each home’s activity record. Waiting after its last request is the run’s end less the end of its last request: a run that finished its work and did not end shows there.',
      `Model: ${esc(s.model)}, so every request goes to hearth’s 27b on Poseidon, never the copies kept for customers.`,
    ],
  });
}
