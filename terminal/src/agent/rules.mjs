// Bonsai's bug-fixing rules. terminal/rules/bug-fixing.md is the only copy:
// its "Every time" steps go into the system prompt, and a bug's kind (sorted
// by the kind's Words) adds that kind's steps to the request.
import { readFileSync } from 'node:fs';

async function load() {
  try {
    if (typeof Bun !== 'undefined') {
      const text = (await import('../../rules/bug-fixing.md', { with: { type: 'text' } })).default;
      // Inside the one-file app the import gives the embedded file's path.
      return text.startsWith('/$bunfs/') ? readFileSync(text, 'utf8') : text;
    }
    return readFileSync(new URL('../../rules/bug-fixing.md', import.meta.url), 'utf8');
  } catch (e) {
    return { error: e.message };
  }
}

// "## Every time" → always; each "### N · Name" under "## Steps for each kind"
// → a kind with its "- Key: value" lines and its numbered steps.
export function parseRules(text) {
  const sections = {};
  for (const part of text.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    sections[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  const kinds = [];
  for (const block of (sections['Steps for each kind'] ?? '').split(/^### /m).slice(1)) {
    const [head, ...lines] = block.split('\n');
    const m = /^(\d+)\s*·\s*(.+)$/.exec(head.trim());
    if (!m) continue;
    const field = (key) => lines.find((l) => l.startsWith(`- ${key}:`))?.slice(key.length + 3).trim() ?? '';
    kinds.push({
      num: Number(m[1]),
      name: m[2].trim(),
      words: field('Words').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean),
      looks: field('Looks like'),
      tool: field('Main tool'),
      testsSeeIt: !/^no\b/i.test(field('Tests see it')),
      runs: Math.max(1, Number(field('Runs of the check')) || 1),
      steps: lines.filter((l) => /^\d+\.\s/.test(l)).join('\n'),
    });
  }
  return { always: sections['Every time'] ?? '', kinds };
}

const loaded = await load();
export const RULES = typeof loaded === 'string' ? parseRules(loaded) : { always: '', kinds: [], error: loaded.error };

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The kind whose Words the request uses most (a phrase counts twice); null when none.
// A clarifying question joined to the request ('(This answers the question "What
// is wrong? …" about the request: …)') is not the user's words, so it is left out.
export function sortBug(text, kinds = RULES.kinds) {
  const t = text.replace(/the question "[^"]*"/g, '').toLowerCase().replace(/[‘’]/g, "'");
  let best = null;
  for (const k of kinds) {
    let score = 0;
    for (const w of k.words) if (new RegExp(`(^|[^a-z0-9])${escape(w)}(?=$|[^a-z0-9])`).test(t)) score += w.includes(' ') ? 2 : 1;
    if (score > (best?.score ?? 0)) best = { ...k, score };
  }
  return best;
}

// A kind's steps as they go with a request.
export function kindText(kind) {
  return `How to fix a ${kind.name} bug (${kind.looks}; main tool: ${kind.tool}):\n${kind.steps}`;
}
