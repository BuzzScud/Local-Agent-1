// Focused-job probe: can the model do each failed task as one small, focused
// request (file + task [+ failing test] → corrected code)? 8 samples each,
// every answer applied to a copy and checked by running it.
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { MODELS, DEFAULT_MODEL } from '../../index.mjs';
import { serverArgs } from '../../index.mjs';
import { join } from 'node:path';
const T = new URL('../bench/tasks', import.meta.url).pathname; // models/evals/bench/tasks
const H = join(homedir(), '.agentic-coder');
const N = Number(process.argv[2] ?? 8);
const srv = spawn(`${H}/bin/llama-server`, serverArgs(MODELS[DEFAULT_MODEL], { ctx: 16384, port: 17650 }), { stdio: 'ignore' });
process.on('exit', () => srv.kill());
for (let i = 0; i < 120; i++) { try { if ((await fetch('http://127.0.0.1:17650/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

async function ask(system, user, temperature = 0.7) {
  const t0 = Date.now();
  const r = await fetch('http://127.0.0.1:17650/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, top_p: 0.8, top_k: 20, max_tokens: 1500, chat_template_kwargs: { enable_thinking: false } }) });
  const j = await r.json();
  const text = j.choices[0].message.content ?? '';
  const m = /```(?:js|javascript|mjs)?\n([\s\S]*?)```/.exec(text);
  return { code: m ? m[1] : null, secs: (Date.now() - t0) / 1000, tokens: j.usage?.completion_tokens };
}
const run = (cwd, cmd) => spawnSync('/bin/zsh', ['-c', cmd], { cwd, encoding: 'utf8', timeout: 20000 });
const copy = (task) => { const d = mkdtempSync(join(tmpdir(), 'probe-')); cpSync(join(T, task, 'project'), d, { recursive: true }); return d; };
const SYS = 'You are an expert programmer. Reply with only the complete new file in one ```js code block, nothing else.';

const probes = {
  'fix-bug (file + failing test → fixed file)': async () => {
    const d = copy('2-fix-bug');
    const fail = run(d, 'node --test 2>&1 | head -40').stdout;
    const r = await ask(SYS, `The tests fail:\n${fail}\n\nstats.test.mjs:\n\`\`\`js\n${readFileSync(join(d, 'stats.test.mjs'), 'utf8')}\`\`\`\n\nstats.mjs:\n\`\`\`js\n${readFileSync(join(d, 'stats.mjs'), 'utf8')}\`\`\`\n\nFix the bug in stats.mjs (not the tests). Reply with the complete corrected stats.mjs.`);
    if (!r.code) return { ...r, pass: false, why: 'no code block' };
    writeFileSync(join(d, 'stats.mjs'), r.code);
    const ok = /ℹ fail 0/.test(run(d, 'node --test 2>&1').stdout);
    rmSync(d, { recursive: true, force: true });
    return { ...r, pass: ok };
  },
  '--json flag (file + task → new file)': async () => {
    const d = copy('1-json-flag');
    const r = await ask(SYS, `export.mjs:\n\`\`\`js\n${readFileSync(join(d, 'export.mjs'), 'utf8')}\`\`\`\n\nTask: add a --json flag to export.mjs that prints the rows as JSON. Reply with the complete new export.mjs.`);
    if (!r.code) return { ...r, pass: false, why: 'no code block' };
    writeFileSync(join(d, 'export.mjs'), r.code);
    const json = run(d, `node export.mjs --json trades.json | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); process.exit(r.length===3?0:1)'`).status === 0;
    const csv = /^symbol,side,qty,price$/m.test(run(d, 'node export.mjs trades.json').stdout);
    const tests = /ℹ fail 0/.test(run(d, 'node --test 2>&1').stdout);
    rmSync(d, { recursive: true, force: true });
    return { ...r, pass: json && csv && tests, why: [!json && 'json', !csv && 'csv', !tests && 'tests'].filter(Boolean).join(',') };
  },
  '--json test (test file + task → new test file)': async () => {
    const d = copy('1-json-flag');
    // give it a correct export.mjs; judge only the test it writes
    writeFileSync(join(d, 'export.mjs'), readFileSync(join(d, 'export.mjs'), 'utf8').replace('  return toCsv(rows);', "  if (argv.includes('--json')) return JSON.stringify(rows, null, 2);\n  return toCsv(rows);"));
    const r = await ask(SYS, `export.mjs:\n\`\`\`js\n${readFileSync(join(d, 'export.mjs'), 'utf8')}\`\`\`\n\nexport.test.mjs:\n\`\`\`js\n${readFileSync(join(d, 'export.test.mjs'), 'utf8')}\`\`\`\n\nTask: add a test to export.test.mjs for the --json flag (main(['trades.json', '--json']) returns the rows as JSON). Keep the existing tests. Reply with the complete new export.test.mjs.`);
    if (!r.code) return { ...r, pass: false, why: 'no code block' };
    writeFileSync(join(d, 'export.test.mjs'), r.code);
    const out = run(d, 'node --test 2>&1').stdout;
    const n = Number(/ℹ tests (\d+)/.exec(out)?.[1] ?? 0);
    const ok = /ℹ fail 0/.test(out) && n >= 3 && /json/i.test(r.code);
    rmSync(d, { recursive: true, force: true });
    return { ...r, pass: ok, why: ok ? '' : `${n} tests, ${/ℹ fail 0/.test(out) ? 'pass' : 'fail'}` };
  },
  'titleCase (file + task → new file)': async () => {
    const d = copy('3-add-function');
    const r = await ask(SYS, `strings.mjs:\n\`\`\`js\n${readFileSync(join(d, 'strings.mjs'), 'utf8')}\`\`\`\n\nTask: add a titleCase(text) function to strings.mjs that capitalizes the first letter of every word and lowercases the rest, and export it. Reply with the complete new strings.mjs.`);
    if (!r.code) return { ...r, pass: false, why: 'no code block' };
    writeFileSync(join(d, 'strings.mjs'), r.code);
    const hidden = run(d, `node -e 'import("./strings.mjs").then(({ titleCase }) => { const c=[["hello world","Hello World"],["hELLO wORLD","Hello World"],["nq futures","Nq Futures"],["a","A"]]; for (const [i,o] of c) if (titleCase(i)!==o) process.exit(1); })'`).status === 0;
    const tests = /ℹ fail 0/.test(run(d, 'node --test 2>&1').stdout);
    rmSync(d, { recursive: true, force: true });
    return { ...r, pass: hidden && tests, why: [!hidden && 'wrong result', !tests && 'old tests'].filter(Boolean).join(',') };
  },
};

for (const [name, fn] of Object.entries(probes)) {
  const rs = [];
  for (let i = 0; i < N; i++) rs.push(await fn());
  const pass = rs.filter((r) => r.pass).length;
  console.log(`${name.padEnd(48)} ${pass}/${N} correct  · ${Math.round(rs.reduce((s, r) => s + r.secs, 0) / N)}s each · ${rs.map((r) => (r.pass ? '✓' : '✗')).join('')}  ${[...new Set(rs.filter((r) => !r.pass).map((r) => r.why).filter(Boolean))].slice(0, 3).join(' | ')}`);
}
srv.kill();
process.exit(0);
