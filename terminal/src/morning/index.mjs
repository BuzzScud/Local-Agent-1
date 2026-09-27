// The morning brief, start to finish: read the repos, pick what earns a line,
// have the model write the words (checked against the facts), draw the page
// with every saved day, and open it. /morning in the app and `bonsai morning`
// in a shell both land here; Claude's /repo-morning uses the same pieces
// through cli.mjs.
import { spawn } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { gather } from './gather.mjs';
import { pick } from './sort.mjs';
import { plainWords, writeWords } from './words.mjs';
import { writeBrief } from './render.mjs';

export { loadConfig, gather, pick, plainWords, writeWords, writeBrief };

// complete + url + model (+ slot): write the words with the model; without them, plain words.
// onStep(kind, text) reports progress: 'gather', 'words', 'done'.
export async function runMorning({ day = 'auto', fetch = true, complete, url, model, slot, signal, onStep = () => {}, onToken, open = !process.env.BONSAI_NO_OPEN, config = loadConfig() } = {}) {
  const t0 = Date.now();
  onStep('gather', 'Reading the repos');
  const facts = await gather({ config, day, fetch });
  const picks = pick(facts, config);
  const gatherSecs = (Date.now() - t0) / 1000;
  const n = facts.projects.length;
  onStep('gather', `Read ${n} repo${n === 1 ? '' : 's'} in ${Math.round(gatherSecs)} s · ${picks.attention.length} need attention, ${picks.resolved.length} resolved`);

  let words, swaps = [], error = null, wordSecs = 0;
  if (complete && url && model) {
    onStep('words', 'Writing the words');
    const r = await writeWords({ facts, picks, complete, url, model, slot, signal, onToken });
    ({ words, swaps, error } = r);
    wordSecs = r.secs ?? 0;
  } else words = plainWords(facts, picks);

  const brief = writeBrief({ config, facts, words });
  if (open) spawn('open', [brief.out], { stdio: 'ignore', detached: true }).unref();
  const result = { ...brief, facts, picks, words, swaps, error, secs: (Date.now() - t0) / 1000, gatherSecs, wordSecs, by: error ? 'plain' : words.by };
  onStep('done', summary(result));
  return result;
}

// One line for the terminal: which day, what it holds, who wrote the words, where the page is
export function summary(r) {
  const home = process.env.HOME ?? '';
  const where = r.out.startsWith(home) ? `~${r.out.slice(home.length)}` : r.out;
  const who = r.error ? `plain words (the model's reply was not used: ${r.error})`
    : r.by === 'bonsai' ? `Bonsai wrote the words${r.swaps.length ? ` (${r.swaps.length} swapped for plain wording: ${r.swaps.map((x) => `${x.field}, ${x.why}`).join('; ')})` : ', all checked against the facts'}`
      : 'plain words';
  return `Morning brief for ${r.day.label} · ${r.picks.attention.length} need attention, ${r.picks.resolved.length} resolved · ${who} · ${r.days.length} day${r.days.length === 1 ? '' : 's'} in the calendar · ${where} · ${Math.round(r.secs)} s`;
}
