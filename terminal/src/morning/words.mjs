// The brief's words: the headline, one sentence for each part of the day, and
// each picked item said in plain speech. The model writes them in one call,
// forced into a JSON shape; then every time and number it wrote is checked
// against the facts it was given, and anything that does not hold (a time
// that is not in the facts, a lost link phrase, a word the brief never uses)
// is swapped for the plain wording from code. No model → the plain words.
import { ACTS, ACT_TIMES, dayOf, myCommits, plainSubject, shapeOf } from './day.mjs';

const s = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

// ---- plain words -------------------------------------------------------------------------
export function plainWords(facts, picks) {
  const mine = myCommits(facts);
  const name = facts.name ?? '';
  const byProject = (list) => Object.entries(list.reduce((n, c) => ({ ...n, [c.project]: (n[c.project] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const top = byProject(mine);
  const headline = !mine.length ? `A still day in the repos, ${name}.`
    : top.length === 1 ? `${s(mine.length, 'commit')}, all in ${top[0][0]}, ${name}.`
      : `${s(mine.length, 'commit')} across ${top.length} projects, ${name}.`;
  const acts = ACTS.map(([a, b]) => {
    const list = mine.filter((c) => c.h >= a && c.h < b);
    if (!list.length) return { text: 'Quiet.' };
    return { text: `${s(list.length, 'commit')}, mostly ${byProject(list)[0][0]}; the last: ${plainSubject(list.at(-1).subject)}.` };
  });
  const strip = ({ id, title, text, href, sourceHref }) => ({ id, title, text, href, sourceHref });
  return { headline, acts, attention: picks.attention.map(strip), resolved: picks.resolved.map(strip), by: 'plain' };
}

// ---- what the model reads ----------------------------------------------------------------
export function digest(facts, picks) {
  const d = dayOf(facts);
  const mine = myCommits(facts);
  const hours = new Set(mine.map((c) => Math.floor(c.h))).size;
  const lines = [
    `The brief is for ${d.label}. The reader is ${facts.name ?? 'the developer'}.`,
    `The day's shape: ${shapeOf(mine)} — ${s(mine.length, 'commit')} of their own, in ${s(hours, 'different hour')}.`,
    '',
    'Their commits by part of the day (time · project · what it did):',
  ];
  ACTS.forEach(([a, b], i) => {
    const list = mine.filter((c) => c.h >= a && c.h < b);
    lines.push(`${ACT_TIMES[i]}:`);
    if (!list.length) lines.push('- none');
    for (const c of list.slice(0, 18)) lines.push(`- ${d.clock(c.time)} · ${c.project} · ${plainSubject(c.subject).slice(0, 120)}`);
    if (list.length > 18) lines.push(`- and ${list.length - 18} more`);
  });
  const item = (x) => {
    const phrase = /\[\[(.+?)\]\]/.exec(x.text)?.[1];
    return [`${x.id} · ${x.project}`, `  title: ${x.title}`, `  sentence: ${x.text}`, phrase ? `  keep the link phrase exactly: [[${phrase}]]` : '  no link phrase', ...(x.facts?.length ? [`  what it holds: ${x.facts.join('; ')}`] : [])].join('\n');
  };
  lines.push('', 'Needs attention (write every one):', ...(picks.attention.length ? picks.attention.map(item) : ['- none']));
  lines.push('', 'Resolved (write every one):', ...(picks.resolved.length ? picks.resolved.map(item) : ['- none']));
  return lines.join('\n');
}

export const SYSTEM = `You write the words for a one-page morning brief about a developer's own projects.
Voice: observe and hand over, like a friend handing someone their day. Plain, warm, specific.
Never command ("you need to", "make sure"), never apologize, never pad ("you've got this"), never judge ("still", "again", "finally", "genuinely"), never talk about yourself or the brief.
Use only the facts given. Copy every time and number exactly as written; add no new ones.
- headline: one line under 90 characters that names the reader. Name the one thing that made the day distinct, or else its shape — not both.
- acts: three sentences, one for each part of the day in order (until 12 PM, 12–6 PM, 6 PM onward). Say what landed and when, in your own words, not pasted commit messages. A part with no commits gets a short sentence such as "Quiet until noon."
- attention and resolved: every item, by its id. title: at most 10 words, in your own words. text: one sentence that keeps every fact of the plain sentence and contains its link phrase exactly once, in double square brackets.`;

export function schemaFor(picks) {
  const items = (list) => (list.length
    ? { type: 'array', minItems: list.length, maxItems: list.length, items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'text'], properties: { id: { enum: list.map((x) => x.id) }, title: { type: 'string', maxLength: 80 }, text: { type: 'string', maxLength: 320 } } } }
    : { type: 'array', maxItems: 0 });
  return {
    type: 'object', additionalProperties: false, required: ['headline', 'acts', 'attention', 'resolved'],
    properties: {
      headline: { type: 'string', minLength: 8, maxLength: 110 },
      acts: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', minLength: 3, maxLength: 260 } },
      attention: items(picks.attention),
      resolved: items(picks.resolved),
    },
  };
}

// ---- the check ---------------------------------------------------------------------------
const TIME = /\b(\d{1,2})(?::(\d{2}))?\s?([AP])\.?M\.?\b/gi;
const times = (t) => [...String(t).matchAll(TIME)].map((m) => `${Number(m[1])}:${m[2] ?? '00'} ${m[3].toUpperCase()}M`);
const numbers = (t) => (String(t).replace(TIME, ' ').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', ''));
const BANNED = /\b(still|again|finally|genuinely|you need to|you should|make sure|don't forget|remember to|sorry|unfortunately)\b|you've got this/i;

export function checkWords(json, facts, picks, text = digest(facts, picks)) {
  const plain = plainWords(facts, picks);
  const okTimes = new Set(times(text));
  // Numbers inside the given times count too ("1:14" of "1:14 PM")
  const okNumbers = new Set((String(text).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '')));
  const swaps = [];
  const good = (field, value, { max = 400 } = {}) => {
    const v = typeof value === 'string' ? value.trim() : '';
    let why = null;
    if (!v) why = 'empty';
    else if (v.length > max) why = 'too long';
    else if (BANNED.test(v)) why = `used "${BANNED.exec(v)[0]}"`;
    else if (/<|>/.test(v)) why = 'markup';
    else {
      const t = times(v).find((x) => !okTimes.has(x));
      const n = numbers(v).find((x) => !okNumbers.has(x));
      if (t) why = `the time ${t} is not in the facts`;
      else if (n) why = `the number ${n} is not in the facts`;
    }
    if (why) swaps.push({ field, why });
    return why ? null : v;
  };

  const words = { headline: good('headline', json?.headline, { max: 110 }) ?? plain.headline, by: 'coding' };
  words.acts = ACTS.map((_, i) => ({ text: good(`act ${i + 1}`, json?.acts?.[i], { max: 260 }) ?? plain.acts[i].text }));
  for (const list of ['attention', 'resolved']) {
    words[list] = plain[list].map((p) => {
      const m = (json?.[list] ?? []).find((x) => x?.id === p.id);
      let title = good(`${p.id} title`, m?.title, { max: 80 });
      if (title && title.split(/\s+/).length > 10) { swaps.push({ field: `${p.id} title`, why: 'more than 10 words' }); title = null; }
      if (title && /\[\[|\]\]/.test(title)) { swaps.push({ field: `${p.id} title`, why: 'a link phrase in the title' }); title = null; }
      let sentence = good(`${p.id} text`, m?.text, { max: 320 });
      const phrase = /\[\[(.+?)\]\]/.exec(p.text)?.[1];
      if (sentence && phrase) {
        const marked = [...sentence.matchAll(/\[\[(.+?)\]\]/g)].map((x) => x[1]);
        if (marked.length === 1 && marked[0].toLowerCase() === phrase.toLowerCase()) sentence = sentence.replace(/\[\[(.+?)\]\]/, `[[${phrase}]]`);
        else if (!marked.length && sentence.toLowerCase().includes(phrase.toLowerCase())) {
          const at = sentence.toLowerCase().indexOf(phrase.toLowerCase());
          sentence = `${sentence.slice(0, at)}[[${phrase}]]${sentence.slice(at + phrase.length)}`;
        } else { swaps.push({ field: `${p.id} text`, why: 'lost its link phrase' }); sentence = null; }
      } else if (sentence && /\[\[|\]\]/.test(sentence)) sentence = sentence.replace(/\[\[|\]\]/g, '');
      return { ...p, title: title ?? p.title, text: sentence ?? p.text };
    });
  }
  return { words, swaps };
}

// ---- one call ----------------------------------------------------------------------------
// complete: flows/llm.mjs complete(), passed in so tests can stand in for the model
export async function writeWords({ facts, picks, complete, url, model, slot, signal, onToken }) {
  const text = digest(facts, picks);
  const items = picks.attention.length + picks.resolved.length;
  try {
    const r = await complete({ url, model, slot, signal, onToken, system: SYSTEM, user: text, schema: schemaFor(picks), temperature: 0.3, maxTokens: 500 + items * 120 });
    if (!r.json) return { words: plainWords(facts, picks), swaps: [], secs: r.secs, error: 'the reply was not the JSON asked for' };
    const { words, swaps } = checkWords(r.json, facts, picks, text);
    return { words, swaps, secs: r.secs, tokens: r.tokens };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { words: plainWords(facts, picks), swaps: [], error: e.message };
  }
}
