// The Arena's Look first check and Tool habits check end to end (models/evals/tools/look-check.mjs,
// habits-check.mjs): each runner through the real `coding -p`, on a scripted stand-in model (--url),
// without a line in the test record or a page (--no-record). The real-model runs are the owner's,
// from ▶ Run a test.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { startFakeServer } from './fake-server.mjs';

const REPO = join(import.meta.dir, '..', '..');
const RUNNERS = join(REPO, 'models', 'evals', 'tools');
const facts = { 'tax rate': 'It uses RATE = 0.0825, set in src/config.mjs.', 'shipping free': 'Free from 50; otherwise 5.99.', 'checkout call': 'checkout calls total, withTax and shippingFor.', rounded: 'With roundCents, to whole cents.' };
// A stand-in that searches for the free-shipping question, reads config.mjs for the others, then answers.
const script = (req) => {
  if (!req.tools?.length) return { text: '{}' };
  const q = String(req.messages.find((m) => m.role === 'user')?.content ?? '');
  const tooled = req.messages.some((m) => m.role === 'tool' && !String(m.content).startsWith('Code files'));
  if (/free-shipping limit/.test(q)) return tooled ? { text: 'The limit is 50, set in src/config.mjs.' } : { tool: { name: 'Search', args: { pattern: 'FREE_SHIPPING' } } };
  const k = Object.keys(facts).find((x) => q.includes(x));
  return { text: k ? facts[k] : 'Done.' };
};
// Run without stopping this process: the stand-in answers from here, and a
// spawnSync holds every server in the process until the command ends on Bun 1.4 (1.2 kept serving).
// ms and extra (2 Oct, the Agents check): its own time limit, and more arguments for the runner.
async function runCheck(file, url, { ms = 230_000, extra = [] } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'agentic-arena-check-'));
  const r = await new Promise((resolve) => {
    const p = spawn('node', [join(RUNNERS, file), '--model', 'qwen', '--url', url, '--no-record', '--out', out, ...extra], { env: { ...process.env, AGENTIC_HOME: mkdtempSync(join(tmpdir(), 'agentic-arena-home-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    const t = setTimeout(() => p.kill('SIGKILL'), ms);
    p.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
  return { ...r, out, rows: JSON.parse(readFileSync(join(out, 'rows.json'), 'utf8')), summary: JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) };
}

test('the Look first check: 8 runs, Look first starts and sends early answers back on the on side only, a verdict', async () => {
  const fake = await startFakeServer([], { delayMs: 0, route: script });
  try {
    const r = await runCheck('look-check.mjs', fake.url);
    expect(r.stdout.split('\n').filter((l) => /^(PASS|FAIL)\s/.test(l))).toHaveLength(8);
    expect(r.stdout).toContain('a look only: no results page, no line in the test record');
    expect(r.rows.map((x) => x.arm)).toEqual(['off', 'on', 'off', 'on', 'off', 'on', 'off', 'on']);
    expect(r.rows.every((x) => x.ok)).toBe(true); // the stand-in's answers have every fact
    expect(r.rows.filter((x) => x.arm === 'on').every((x) => x.started && x.backs === 3)).toBe(true); // instant answers: sent back 3×
    expect(r.rows.filter((x) => x.arm === 'off').every((x) => !x.started && x.backs === 0)).toBe(true);
    expect(r.summary).toMatchObject({ checks: 8, of: 8, page: '', verdict: { holds: true, off: { right: 4 }, on: { right: 4 } } });
    expect(r.status).toBe(0);
  } finally { await fake.close(); }
}, 240_000);

test('the Tool habits check: 8 runs with the shortcuts off, the search habit from the model’s own first look', async () => {
  const fake = await startFakeServer([], { delayMs: 0, route: script });
  try {
    const r = await runCheck('habits-check.mjs', fake.url);
    expect(r.stdout.split('\n').filter((l) => /^(PASS|FAIL)\s/.test(l))).toHaveLength(8);
    expect(r.rows.map((x) => `${x.task}-${x.arm}`)).toEqual(['testfile-old', 'testfile-new', 'search-old', 'search-new', 'done-old', 'done-new', 'skill-old', 'skill-new']);
    expect(r.rows.filter((x) => x.task === 'search').every((x) => x.ok && x.habit)).toBe(true);
    expect(r.rows.filter((x) => x.task !== 'search').every((x) => !x.ok)).toBe(true); // the stand-in changes nothing
    expect(r.summary.verdict).toMatchObject({ holds: false, old: { habits: 1, passed: 1 }, new: { habits: 1, passed: 1 } });
    expect(r.status).toBe(1); // the rule does not hold on a stand-in that does no work
  } finally { await fake.close(); }
}, 240_000);

// The Agents check (agents-ab.mjs): 6 runs, each task plain and through --agents, step by step
// (--no-flows: a stand-in that only says done would keep a focused path trying for minutes); a
// stand-in that answers /agents' focused calls (the interview, SPEC.md, the plan, the reviews).
const agentsScript = (req) => {
  const sys = String(req.messages?.[0]?.content ?? '');
  if (/Ask the 3 to 5 questions/.test(sys)) return { text: '{"questions":[{"q":"What counts as done?","options":["the tests pass","it runs"]}]}' };
  if (/Write SPEC\.md/.test(sys)) return { text: '## Goal\nThe change.\n\n## Acceptance checks\n1. it works' };
  if (/Break the spec/.test(sys)) return { text: '{"tasks":[{"title":"The change","check":"it works"}]}' };
  if (/one area:|You are the /.test(sys)) return { text: '{"findings":[]}' };
  if (/review work another assistant/.test(sys)) return { text: 'LGTM' };
  return { text: 'Done.' };
};
test('the Agents check: 6 runs, each task as a plain request and through /agents, a verdict', async () => {
  const fake = await startFakeServer([], { delayMs: 0, route: agentsScript });
  try {
    const r = await runCheck('agents-ab.mjs', fake.url, { extra: ['--no-flows'] });
    expect(r.stdout.split('\n').filter((l) => /^(PASS|FAIL)\s/.test(l))).toHaveLength(6);
    expect(r.stdout).toContain('a look only: no results page, no line in the test record');
    expect(r.rows.map((x) => `${x.task}-${x.arm}`)).toEqual(['discount-plain', 'discount-agents', 'tax-plain', 'tax-agents', 'shipping-plain', 'shipping-agents']);
    expect(r.rows.filter((x) => x.arm === 'agents').every((x) => /^(GO|NO-GO|STOPPED)/.test(x.verdict))).toBe(true);
    expect(r.rows.filter((x) => x.arm === 'agents').every((x) => /wrote SPEC\.md/.test(x.detail))).toBe(true);
    expect(r.summary).toMatchObject({ checks: 6, of: 6, page: '', pass: false }); // nothing right on either side is not a pass
    expect(r.status).toBe(1);
  } finally { await fake.close(); }
}, 300_000);
