// The results page of the Bonsai helpers check (bonsai-helpers.mjs): one self-contained HTML file for the DOCS folder,
// opened from the run's line in the hub's Tests tab, drawn by check-page.mjs
// (Result · The checks · Side by side · How it was measured).
//   helpersPage({ summary, rows, prev, raw }) → html
import { buildCheckPage, sec } from './check-page.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US'));

export function helpersPage({ summary: s, rows, prev = null, raw = [] }) {
  const w = s.arms?.with, a = s.arms?.alone;
  if (!w || !a) return buildCheckPage({ title: `Bonsai helpers check · ${s.model} with ${s.helper}`, summary: s, rows, prev, raw });
  const H = s.helper, M = s.model;
  const runs = w.helperRuns ?? [];
  const steps = runs.reduce((k, h) => k + (h.steps ?? 0), 0);
  // One row a measure: with helpers, on its own, which way is better (the better cell in bold).
  const line = (k, dir, x, y, show = n, better = null) => {
    const b = better ?? (dir.startsWith('lower') ? (x < y ? 'x' : y < x ? 'y' : '') : dir.startsWith('higher') ? (x > y ? 'x' : y > x ? 'y' : '') : '');
    return `<tr><td><b>${esc(k)}</b><small class="dim"> · ${esc(dir)}</small></td><td class="num">${b === 'x' ? `<b>${show(x)}</b>` : show(x)}</td><td class="num">${b === 'y' ? `<b>${show(y)}</b>` : show(y)}</td></tr>`;
  };
  const right = (r) => `${r.right?.secs ? '✓' : '✗'} 6 s · ${r.right?.saves ? '✓' : '✗'} the function`;
  const side = `<div class="table-wrap"><table><thead><tr><th>Measure</th><th class="num">With helpers on ${esc(H)}</th><th class="num">${esc(M)} on its own</th></tr></thead><tbody>
${line('The whole request', 'lower is faster', w.secs, a.secs, sec)}
${line(`${M}'s conversation at its largest`, 'lower leaves more room', w.main.peakTok, a.main.peakTok, (x) => `${n(x)} tokens`)}
${line(`${M} replies`, 'count', w.main.calls, a.main.calls)}
${line(`${M} reading`, 'lower is faster', w.main.readSecs, a.main.readSecs, sec)}
${line(`${M} writing (and thinking)`, 'lower is faster', w.main.writeSecs, a.main.writeSecs, sec)}
${line(`${M} tokens written`, 'count', w.main.wroteTok, a.main.wroteTok)}
${line(`${H} replies (the helper)`, 'count', w.helper.calls, a.helper.calls)}
${line(`${H} reading`, 'time', w.helper.readSecs, a.helper.readSecs, sec)}
${line(`${H} writing (and thinking)`, 'time', w.helper.writeSecs, a.helper.writeSecs, sec)}
${line('Loading a model', 'lower is faster', (w.main.loadSecs ?? 0) + (w.helper.loadSecs ?? 0), (a.main.loadSecs ?? 0) + (a.helper.loadSecs ?? 0), sec)}
${line('Memory Ollama held at most', 'GB of 16', w.heldPeakGb, a.heldPeakGb, (x) => `${x} GB`, '')}
${line('The answers', 'both right is the bar', right(w), right(a), (x) => x, '')}
${line('How it ended', '', w.reason ?? w.error, a.reason ?? a.error, (x) => esc(x ?? '—'), '')}
</tbody></table></div>
<div class="cards"><div class="card"><div class="k">${esc(M)}'s answer · with helpers</div><p class="small">${esc(String(w.answer ?? '').slice(0, 420)) || '—'}</p></div><div class="card"><div class="k">${esc(M)}'s answer · on its own</div><p class="small">${esc(String(a.answer ?? '').slice(0, 420)) || '—'}</p></div></div>`;
  const ratio = w.secs / Math.max(1, a.secs);
  // The first line in plain words when no helper ran: the checks after it could not be tested.
  const both = (r) => Boolean(r.right?.secs && r.right?.saves);
  const answers = both(w) && both(a) ? 'Both ways got both answers right.' : `With helpers ${both(w) ? 'both answers were right' : 'not both answers were right'}; on its own ${both(a) ? 'both were right' : 'not both were right'}.`;
  // A run on the code before 28 Oct's fix: after the helper the conversation went on on the helper's model.
  const spoiled = (x) => x.arms?.alone?.main?.calls === 0 && x.arms?.alone?.helper?.calls > 0;
  const verdict = spoiled(s)
    ? `Not a fair run: after the helper, the conversation went on on ${esc(H)} (a bug, fixed after this run), so ${esc(M)}'s answer and the whole “on its own” half came from ${esc(H)}. The helper itself ran: ${runs.map((h) => `${h.steps} steps, ${h.secs} s`).join('; ')}.`
    : w.offered && !runs.length
    ? `No: ${esc(M)} was offered the Agent tool but did the searching itself (${w.main.calls} replies), so the helper on ${esc(H)} never ran. ${answers}`
    : !w.offered ? `No: ${esc(M)} was not offered the Agent tool, so no helper could run.` : null;
  return buildCheckPage({
    verdict,
    title: `Bonsai helpers check · ${M} with ${H}${s.asked ? ' · asked to use it' : ''}`, summary: s, rows, prev, raw,
    yes: `${M} handed the searching to ${H}, kept its own conversation smaller, and got both answers right.`,
    passRule: 'all 8 checks',
    cards: [
      { k: 'The whole request', v: sec(w.secs), sub: `on its own: ${sec(a.secs)} (${ratio.toFixed(2)}×)`, dir: 'lower is faster' },
      { k: `${M}'s conversation at its largest`, v: `${n(w.main.peakTok)} tokens`, sub: `on its own: ${n(a.main.peakTok)} tokens`, dir: 'lower leaves more room' },
      { k: `Helpers on ${H}`, v: runs.length ? `${runs.length} · ${steps} steps` : 'none ran', sub: runs.length ? runs.map((h) => `${h.kind} ${h.secs} s`).join(', ') : `${M} read and searched itself`, dir: 'what ran' },
      { k: 'Memory Ollama held at most', v: `${w.heldPeakGb} GB`, sub: `${w.bothHeld ? 'both models at once' : 'never both at once'}; on its own ${a.heldPeakGb} GB`, dir: 'of 16 GB' },
    ],
    more: [{ id: 'side', name: 'Side by side', html: side }],
    how: [
      `One question, asked twice in a fresh conversation each time, about a copy of this commit's <code>terminal/src/app</code> folder (outside any repo): “${esc(s.question)}” The answers are in the code: <code>KEEP_DONE_MS</code> = 6000 in <code>helpers-panel.mjs</code>, and <code>useHelperModel</code> in <code>subagents-cmd.mjs</code> (with <code>helpersTo</code>); an answer counts when it names them.${s.asked ? ` With helpers the question ended with one more sentence: “${esc(s.asks)}”` : ''}`,
      `First with helpers: a throwaway home whose <code>profiles.json</code> sends the helpers it starts to <code>${esc(H)}</code> on the same service, as <code>/subagents ${esc(H)}</code> writes it, and the window's profile router (<code>ProfileRouter</code>, lent the conversation's connection). Then on its own: no profiles, so the Agent tool is not offered and ${esc(M)} reads and searches itself.`,
      `${esc(M)} on <code>${esc(s.url)}</code> at ${n(s.ctx)} tokens of context, thinking as the model has it (on), Accept edits, the app's sorting on, the memory and the read-ahead off. Each way stops at 15 minutes.`,
      'Every reply’s figures are Ollama’s own, read from the reply itself: prompt_eval_count (the conversation’s size as sent: its largest is the peak), prompt_eval_duration (reading), eval_count and eval_duration (writing, thinking included), load_duration. Which model held memory: <code>/api/ps</code> every 2 s.',
      'The rules, written before the first run: with helpers, the Agent tool offered and used, the helper on the smaller model with the main one kept loaded, both answers right; on its own, both right too (the baseline); with helpers the main conversation peaks smaller and the request takes at most 1.5× the time. One run of each: the times say what happened this once, not an average.',
      ...(prev ? [`Before is the run of ${esc(prev.s.sub)} on the same two models${s.asked ? ', asked the same way' : ''}.${spoiled(prev.s) ? ` That run met a bug fixed since: after the helper, the conversation went on on ${esc(H)}.` : ''}`] : []),
      `The whole run took ${sec(s.secs)}. Code: ${esc(s.code)}.`,
    ],
  });
}
