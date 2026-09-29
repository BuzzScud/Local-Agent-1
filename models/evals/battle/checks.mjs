// The Battle arena's pass checks: the ones you tick in the New test form, and a test's own
// check.sh (the tests that come with the arena have one). Each gives { label, pass, why }. A run passes when every
// check holds; a test with no checks is decided by your vote alone (pass: null).
//   tests         the project's tests pass (value: the command; empty = found: npm test, node --test, pytest)
//   only-named    only the files named in the prompt, test files and new files changed
//   file-has      a changed or new file has this text
//   answer-has    the answer has each of these words (commas between them)
//   no-change     no file was changed, added or removed
//   saved         this file exists (a path from the test's folder; Desktop/x.html for a page)
//   scripts-valid every script in the page parses (checked without a browser)
//   offline       the page loads nothing from the internet
//   page-has      the page has this text (words on it, or a button's label)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CHECKS = {
  tests: { label: 'The tests pass', value: 'the command (empty: found by itself)' },
  'only-named': { label: 'Nothing else changed', value: null },
  'file-has': { label: 'A file says', value: 'the text' },
  'answer-has': { label: 'The answer mentions', value: 'words, commas between' },
  'no-change': { label: 'No file was changed', value: null },
  saved: { label: 'The file is saved', value: 'where, e.g. Desktop/page.html' },
  'scripts-valid': { label: 'Its scripts are valid', value: null },
  offline: { label: 'Nothing from the internet', value: null },
  'page-has': { label: 'The page has', value: 'the text' },
};
const SKIP = new Set(['node_modules', '.git', '.DS_Store', '.agentic', '.bonsai', '.agentic-check', '__pycache__', '.pytest_cache']);

// Every file under a folder with a hash of its bytes: { 'src/a.mjs': 'sha…' }.
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const p = join(d, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (st.size < 5e6) out[relative(dir, p)] = createHash('sha1').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}
export function changes(before, after) {
  const added = Object.keys(after).filter((f) => !(f in before));
  const removed = Object.keys(before).filter((f) => !(f in after));
  const changed = Object.keys(after).filter((f) => f in before && before[f] !== after[f]);
  return { added, removed, changed };
}
const isTest = (f) => /(^|\/)(tests?|__tests__|spec)\/|(\.|_|-)(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/i.test(f);
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
// The line that says what went wrong: what the check printed, else the error (not Node's version or a stack line).
export function whyOf(r) {
  const useful = (t) => String(t ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^Node\.js v\d/.test(l) && !/^at\s/.test(l) && !/^\^+$/.test(l) && !/^\s*$/.test(l));
  const out = useful(r.stdout), err = useful(r.stderr);
  return (out.at(-1) ?? err.find((l) => /(Error|Exception)\b.*:/.test(l)) ?? err.at(-1) ?? `exit ${r.status ?? r.signal}`).slice(0, 200);
}
const htmlFiles = (work, ch) => [...ch.added, ...ch.changed].filter((f) => /\.html?$/i.test(f));

// The test command a project has, or null.
export function testCommand(work) {
  const pkg = (() => { try { return JSON.parse(read(join(work, 'package.json'))); } catch { return null; } })();
  if (pkg?.scripts?.test && !/no test specified/.test(pkg.scripts.test)) return 'npm test --silent';
  const files = Object.keys(snapshot(work));
  if (files.some((f) => /\.test\.(m?js|cjs)$/.test(f))) return 'node --test';
  if (files.some((f) => /(^|\/)test_[^/]+\.py$|_test\.py$/.test(f))) return spawnSync('python3', ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status === 0 ? 'python3 -m pytest -q' : 'python3 -m unittest discover -q';
  return null;
}

// Every script in a page parses: a page whose script has a syntax error shows but does nothing.
export function scriptsParse(html) {
  let n = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].trim()) continue;
    if (/type\s*=\s*["']?(module|application\/json|text\/template)/i.test(m[1])) { n += 1; continue; }
    // new Function parses without running, the same in Node and Bun (Bun's vm.Script parses late).
    try { new Function(m[2]); n += 1; } catch (e) { return { ok: false, why: `a script does not parse: ${e.message}` }; }
  }
  return n ? { ok: true } : { ok: false, why: 'the page has no script of its own' };
}
const external = (html) => /<(script|link|img|iframe)\b[^>]+(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html) || /@import\s+url\(\s*["']?(https?:)?\/\//i.test(html);

// Runs the checks. work: the model's folder after its run; before: its snapshot at the start.
export function runChecks({ checks = [], script = null, work, before, answer = '', prompt = '', env = process.env, timeoutMs = 120_000 }) {
  const after = snapshot(work);
  const ch = changes(before, after);
  const all = [...ch.added, ...ch.changed];
  const out = [];
  for (const c of checks) {
    const v = String(c.value ?? '').trim();
    const label = `${CHECKS[c.type]?.label ?? c.type}${v ? `: ${v}` : ''}`;
    let pass = false; let why = '';
    switch (c.type) {
      case 'tests': {
        const cmd = v || testCommand(work);
        if (!cmd) { why = 'the project has no tests to run'; break; }
        const r = spawnSync('/bin/zsh', ['-c', cmd], { cwd: work, encoding: 'utf8', timeout: timeoutMs, env });
        pass = r.status === 0;
        why = pass ? '' : `${cmd} failed: ${whyOf(r)}`;
        break;
      }
      case 'only-named': {
        const named = new Set(all.concat(ch.removed).filter((f) => prompt.includes(basename(f)) || prompt.includes(f)));
        const bad = [...ch.changed.filter((f) => !named.has(f) && !isTest(f)), ...ch.removed.filter((f) => !named.has(f))];
        pass = !bad.length; why = pass ? '' : `also changed: ${bad.slice(0, 4).join(', ')}`;
        break;
      }
      case 'file-has': {
        pass = Boolean(v) && all.some((f) => read(join(work, f)).includes(v));
        why = pass ? '' : v ? `no changed or new file has "${v}"` : 'no text given to look for';
        break;
      }
      case 'answer-has': {
        const words = v.split(',').map((w) => w.trim()).filter(Boolean);
        const miss = words.filter((w) => !answer.toLowerCase().includes(w.toLowerCase()));
        pass = words.length > 0 && !miss.length; why = pass ? '' : words.length ? `the answer lacks ${miss.map((w) => `"${w}"`).join(', ')}` : 'no words given to look for';
        break;
      }
      case 'no-change': {
        const n = ch.added.length + ch.changed.length + ch.removed.length;
        pass = n === 0; why = pass ? '' : `files changed: ${[...ch.changed, ...ch.added, ...ch.removed].slice(0, 4).join(', ')}`;
        break;
      }
      case 'saved': {
        const p = v ? join(work, v) : null;
        pass = Boolean(p) && existsSync(p); why = pass ? '' : v ? `no ${v}` : 'no file named';
        break;
      }
      case 'scripts-valid': {
        const pages = v ? [v] : htmlFiles(work, ch);
        if (!pages.length) { why = 'it made no page'; break; }
        const bad = pages.map((f) => [f, scriptsParse(read(join(work, f)))]).find(([, r]) => !r.ok);
        pass = !bad; why = pass ? '' : `${bad[0]}: ${bad[1].why}`;
        break;
      }
      case 'offline': {
        const pages = htmlFiles(work, ch);
        if (!pages.length) { why = 'it made no page'; break; }
        const bad = pages.find((f) => external(read(join(work, f))));
        pass = !bad; why = pass ? '' : `${bad} loads something from the internet`;
        break;
      }
      case 'page-has': {
        const pages = htmlFiles(work, ch);
        pass = Boolean(v) && pages.some((f) => read(join(work, f)).toLowerCase().includes(v.toLowerCase()));
        why = pass ? '' : !pages.length ? 'it made no page' : v ? `no page has "${v}"` : 'no text given to look for';
        break;
      }
      default: why = `unknown check ${c.type}`;
    }
    out.push({ label, pass, why });
  }
  if (script && existsSync(script)) {
    const r = spawnSync('/bin/zsh', [script], { cwd: work, encoding: 'utf8', timeout: timeoutMs, env });
    out.push({ label: 'The test\'s own check', pass: r.status === 0, why: r.status === 0 ? '' : whyOf(r) });
  }
  return { checks: out, pass: out.length ? out.every((c) => c.pass) : null, files: ch };
}
