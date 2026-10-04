// A folder of data, as the model meets it (4 Oct 2026): what kind of folder it is, what it says
// about itself (a README, a manifest), and which of its names a request uses.
//
// Why: asked to backtest "the nq and es data" in a folder of 44 contract folders and a
// manifest.json, Qwen3.6 took the micro contracts (MNQ, MES) from the listing. The manifest, which
// names CON.F.US.ENQ.* "NQZ6 · E-mini NASDAQ-100" and says how to splice the months, was never
// opened: the opening read lists 40 entries, and it was the 45th. The owner's picks: the folder's
// own words go with the request, the names the request uses are matched against it, and you are
// asked only when the folder does not settle which one is meant.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CODE_EXT = /\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|vue|svelte|sh)$/i;
const DATA_EXT = /\.(csv|tsv|ndjson|jsonl|json|parquet|xlsx?|feather|arrow|h5|sqlite|db|xml)$/i;
const PROJECT_FILES = new Set(['package.json', 'pyproject.toml', 'setup.py', 'Cargo.toml', 'go.mod', 'Gemfile', 'pom.xml', 'build.gradle', 'Package.swift', 'Makefile']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', 'dist', 'build', 'target']);

// 'code' (a project: its own build file, 3 code files in its first two levels, or code files at
// least as many as data files), 'data' (3 data files or more, more than code), else 'other'. At most
// `max` files are looked at.
export function folderKind(dir, { max = 400 } = {}) {
  let code = 0, data = 0, seen = 0;
  const walk = (d, depth) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= max) return;
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { if (depth < 2 && !SKIP_DIRS.has(e.name)) walk(join(d, e.name), depth + 1); continue; }
      seen++;
      if (depth === 0 && PROJECT_FILES.has(e.name)) code += 3;
      else if (CODE_EXT.test(e.name)) code++;
      else if (DATA_EXT.test(e.name)) data++;
    }
  };
  walk(dir, 0);
  if (code >= 3 || (code > 0 && code >= data)) return 'code';
  return data >= 3 ? 'data' : 'other';
}

// ---- what the folder says about itself -------------------------------------------------------

const CARD_FILE = /^(readme|about|description)(\.(md|markdown|txt|rst))?$|^(manifest|datapackage|metadata|schema|catalog)\.json$|[-_.]manifest\.json$/i;
// The key that names an item of a list, and the one that says what it is.
const NAME_KEYS = ['contract', 'id', 'name', 'key', 'file', 'path', 'symbol', 'ticker', 'code'];
const LABEL_KEYS = ['display', 'title', 'label', 'description', 'desc', 'long_name', 'fullName'];
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

// A JSON file's card: its plain values, its small objects of plain values, and each list with what
// its items hold; a list whose items have a name and a label is listed item by item (an index), as
// far as `room` allows. labels: name → label, for matching names.
function jsonCard(v, room) {
  const lines = [];
  const labels = new Map();
  const plain = Object.entries(v).filter(([, x]) => scalar(x));
  if (plain.length) lines.push(plain.slice(0, 12).map(([k, x]) => `${k}: ${clip(JSON.stringify(x), 60)}`).join(' · '));
  for (const [k, x] of Object.entries(v)) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const vals = Object.entries(x);
      if (vals.length && vals.length <= 8 && vals.every(([, y]) => scalar(y))) lines.push(`${k}: ${vals.map(([a, y]) => `${a} ${clip(typeof y === 'string' ? y : JSON.stringify(y), 160)}`).join('; ')}`);
      else lines.push(`${k}: an object with ${clip(Object.keys(x).join(', '), 120)}`);
    } else if (Array.isArray(x)) {
      if (x.every(scalar)) { lines.push(`${k}: ${clip(x.map(String).join(', '), 160)}`); continue; }
      const first = x.find((y) => y && typeof y === 'object' && !Array.isArray(y));
      if (!first) { lines.push(`${k}: a list of ${x.length}`); continue; }
      const keys = Object.keys(first);
      const name = NAME_KEYS.find((n) => typeof first[n] === 'string');
      const label = LABEL_KEYS.find((n) => n !== name && typeof first[n] === 'string');
      lines.push(`${k}: a list of ${x.length}, each with ${clip(keys.join(', '), 120)}`);
      // One index only (the first list with names and labels): two would double the card.
      if (name && label && !labels.size) {
        const items = x.filter((y) => typeof y?.[name] === 'string');
        for (const y of items) labels.set(y[name], String(y[label] ?? ''));
        const shown = [];
        let used = lines.join('\n').length;
        for (const y of items) {
          const line = `  ${y[name]}${y[label] && y[label] !== y[name] ? ` — ${clip(y[label], 90)}` : ''}`;
          if (used + line.length > room) break;
          shown.push(line);
          used += line.length + 1;
        }
        lines.push(...shown);
        if (shown.length < items.length) lines.push(`  … and ${items.length - shown.length} more`);
      }
    }
  }
  return { text: lines.join('\n'), labels };
}

// What the folder says about itself: its README and its manifest (two files at most), cut to
// `chars`. null when it has neither. { files, text, labels }.
export function folderCard(dir, { chars = 4000 } = {}) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => CARD_FILE.test(n)); } catch { return null; }
  names = names.filter((n) => { try { return statSync(join(dir, n)).isFile(); } catch { return false; } })
    .sort((a, b) => Number(/\.json$/i.test(a)) - Number(/\.json$/i.test(b)) || a.localeCompare(b)).slice(0, 2);
  if (!names.length) return null;
  const parts = [];
  let labels = new Map();
  const room = Math.floor(chars / names.length);
  for (const n of names) {
    let text = '';
    try { text = readFileSync(join(dir, n), 'utf8'); } catch { continue; }
    if (/\.json$/i.test(n)) {
      let v;
      try { v = JSON.parse(text); } catch { continue; }
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const c = jsonCard(v, room);
      if (!labels.size) labels = c.labels;
      parts.push(`${n}:\n${c.text}`);
    } else {
      const lines = [];
      let used = 0;
      for (const l of text.split('\n')) { if (used + l.length > room) break; lines.push(l); used += l.length + 1; }
      parts.push(`${n}:\n${lines.join('\n').trim()}${lines.length < text.split('\n').length ? '\n…' : ''}`);
    }
  }
  if (!parts.length) return null;
  return { files: names, text: parts.join('\n\n'), labels };
}

// ---- the names a request uses ----------------------------------------------------------------

// Words that are never a name of the folder's.
const STOP = new Set(('a an and are as at be but by can could do does did for from get give had has have he how i if in into is it its '
  + 'just let like make me my need no not now of off on one or our out over please run see she show so some than that the their them '
  + 'then there these they this those to too try up us use was we what when where which who why will with would you your all any each '
  + 'file files folder data here want look check create done html self contained example examples chart charts result results test '
  + 'tests backtest analyze analyse download desktop downloads form price using new old also about after before into').split(' '));
const EXT_WORDS = new Set(['csv', 'tsv', 'json', 'ndjson', 'jsonl', 'html', 'htm', 'md', 'txt', 'py', 'js', 'mjs', 'zip', 'png', 'pdf', 'xlsx', 'parquet']);
const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// The words of a request that could be names: no paths or addresses, no common words.
export function requestWords(text) {
  const plain = String(text ?? '').replace(/(?:file|https?):\/\/\S+/gi, ' ').replace(/(['"])[^'"\n]*\/[^'"\n]*\1/g, ' ').replace(/\S*\/\S*/g, ' ');
  const words = [...new Set((plain.match(/\b[A-Za-z][A-Za-z0-9]{1,11}\b/g) ?? []).map((w) => w.toLowerCase()))];
  return words.filter((w) => !STOP.has(w) && !EXT_WORDS.has(w));
}

// The entries of the folder, each with its tokens and the group it belongs to: its tokens with no
// digits, less the ones most entries share ("CON.F.US.ENQ.Z26" → ENQ).
function entriesOf(dir, max = 500) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => !n.startsWith('.')).slice(0, max); } catch { return []; }
  const all = names.map((n) => ({ name: n, tokens: tokens(n).filter((t) => !EXT_WORDS.has(t)) }));
  const count = new Map();
  for (const e of all) for (const t of new Set(e.tokens)) count.set(t, (count.get(t) ?? 0) + 1);
  const common = new Set(all.length >= 5 ? [...count].filter(([, c]) => c >= all.length * 0.6).map(([t]) => t) : []);
  return all.map((e) => {
    const own = e.tokens.filter((t) => !common.has(t));
    const kind = own.filter((t) => !/\d/.test(t));
    return { ...e, own, group: (kind.length ? kind.join('.') : e.name).toUpperCase() };
  });
}

// How a word names an entry: 'strong' (one of its own words, a word of its label, or a label's code
// that starts with it: "nq" and "NQZ6"), 'weak' (a short word inside one of its short words: "nq"
// in MNQ), else null.
function matchOf(w, e, label) {
  if (e.own.includes(w)) return 'strong';
  const lt = label ? tokens(label) : [];
  if (lt.includes(w) || lt.some((t) => t.startsWith(w) && /^[a-z]?\d{1,2}$/.test(t.slice(w.length)))) return 'strong';
  if (w.length <= 4 && /^[a-z]+$/.test(w) && e.own.some((t) => /^[a-z]+$/.test(t) && t !== w && t.length <= w.length + 2 && t.includes(w))) return 'weak';
  return null;
}

// The names a request uses that are in the folder. { note, unclear, matched } or null. A word is settled
// when exactly one group matches it strongly; otherwise, with any match, it is unclear and its
// groups are listed (unclear: [{ word, groups: [{ key, names, labels }] }]).
export function namesInRequest(text, dir, { labels = new Map(), maxWords = 6 } = {}) {
  const entries = entriesOf(dir);
  if (!entries.length) return null;
  const lines = [];
  const unclear = [];
  const matched = [];
  const groupOf = (list) => {
    const m = new Map();
    for (const e of list) {
      if (!m.has(e.group)) m.set(e.group, { key: e.group, names: [], labels: [] });
      const g = m.get(e.group);
      g.names.push(e.name);
      const l = labels.get(e.name);
      if (l && l !== e.name) g.labels.push(l);
    }
    return [...m.values()];
  };
  const said = (g) => `${g.key}: ${g.names.slice(0, 4).join(', ')}${g.names.length > 4 ? ` and ${g.names.length - 4} more` : ''}${g.labels.length ? ` (${g.labels.slice(0, 2).map((l) => clip(l, 60)).join('; ')})` : ''}`;
  for (const w of requestWords(text)) {
    if (lines.length >= maxWords) break;
    const strong = entries.filter((e) => matchOf(w, e, labels.get(e.name)) === 'strong');
    const weak = entries.filter((e) => !strong.includes(e) && matchOf(w, e, labels.get(e.name)) === 'weak');
    if (!strong.length && !weak.length) continue;
    const sg = groupOf(strong);
    const wg = groupOf(weak).filter((g) => !sg.some((s) => s.key === g.key));
    if (sg.length === 1) {
      matched.push({ word: w, to: sg[0].key });
      lines.push(`"${w}" → ${said(sg[0])}${wg.length ? `. Near it, not the same: ${wg.slice(0, 4).map(said).join('; ')}` : ''}`);
    } else {
      const groups = [...sg, ...wg];
      lines.push(`"${w}" is not settled by the folder: it could be ${groups.slice(0, 5).map(said).join('; ')}`);
      unclear.push({ word: w, groups });
      matched.push({ word: w, to: null });
    }
  }
  if (!lines.length) return null;
  return { note: `Names in the request, found in this folder:\n${lines.map((l) => `- ${l}`).join('\n')}`, unclear, matched };
}

// The question for an unclear word, and its choices (the groups, then all of them).
export function namesQuestion(u) {
  const groups = u.groups.slice(0, 3);
  const named = (g) => `${g.key}${g.labels[0] ? ` (${clip(g.labels[0], 50)})` : ''}`;
  return {
    question: u.groups.length === 1
      ? `Your request says "${u.word}". The closest name in this folder is ${named(groups[0])}. Is that the one?`
      : `Your request says "${u.word}". In this folder that could be ${groups.map(named).join(', ')}${u.groups.length > 3 ? ' or more' : ''}. Which one did you mean?`,
    options: [...groups.map((g) => g.key), ...(u.groups.length > 1 ? ['All of them'] : [])],
    about: [...groups.map((g) => `${g.names.slice(0, 3).join(', ')}${g.names.length > 3 ? ', …' : ''}`), ...(u.groups.length > 1 ? ['Use every match.'] : [])],
    typeLabel: 'Something else…',
    typeAbout: 'Name the folder or file you meant.',
  };
}
