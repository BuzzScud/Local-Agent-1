import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs in its own process with its own BONSAI_HOME (the slot folder comes
// from the home folder when models.mjs loads; see server.test.mjs).
function inChild(body) {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-warm-'));
  const src = (p) => JSON.stringify(join(import.meta.dir, '..', '..', p));
  const script = `
    import { createServer } from 'node:http';
    import { writeFileSync, existsSync, readdirSync, utimesSync, mkdirSync } from 'node:fs';
    import { join } from 'node:path';
    const { MODELS, DEFAULT_MODEL, SLOT_DIR, HOME } = await import(${src('models/registry.mjs')});
    if (HOME !== process.env.BONSAI_HOME) { console.log(JSON.stringify({ error: 'wrong home' })); process.exit(1); }
    const { warmUp, pruneSaved } = await import(${src('models/runtime/warmup.mjs')});
    const { systemPrompt, SESSION_MARK } = await import(${src('terminal/src/agent/prompt.mjs')});
    const model = MODELS[DEFAULT_MODEL];
    // A stand-in llama-server: renders a simple template, "reads" prompts and saves slot files.
    function fake({ template = true } = {}) {
      const calls = [];
      const srv = createServer(async (req, res) => {
        let body = ''; for await (const c of req) body += c;
        const j = body ? JSON.parse(body) : {};
        calls.push({ path: req.url, body: j });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/apply-template') {
          if (!template) { res.statusCode = 404; res.end('{"error":{"message":"not found"}}'); return; }
          const [sys, user] = j.messages;
          res.end(JSON.stringify({ prompt: '<|im_start|>system\\n# Tools\\n' + JSON.stringify(j.tools) + '\\n\\n' + sys.content + '<|im_end|>\\n<|im_start|>user\\n' + user.content + '<|im_end|>\\n<|im_start|>assistant\\n' }));
          return;
        }
        const m = /^\\/slots\\/(\\d+)\\?action=(save|restore)$/.exec(req.url);
        if (m && m[2] === 'save') { writeFileSync(join(SLOT_DIR, j.filename), 'state'); res.end('{"n_saved":10}'); return; }
        if (m && m[2] === 'restore') { if (!existsSync(join(SLOT_DIR, j.filename))) { res.statusCode = 400; res.end('{"error":{"message":"no file"}}'); return; } res.end('{"n_restored":10}'); return; }
        res.end('{}');
      });
      return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: 'http://127.0.0.1:' + srv.address().port, calls, close: () => srv.close() })));
    }
    mkdirSync(SLOT_DIR, { recursive: true });
    const out = {};
    ${body}
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  const r = spawnSync('bun', ['-e', script], { env: { ...process.env, BONSAI_HOME: home }, encoding: 'utf8', timeout: 30000 });
  const line = r.stdout.trim().split('\n').pop();
  if (!line) throw new Error(r.stderr);
  return JSON.parse(line);
}

test('the first start reads the shared instructions and saves them; the next start restores them', () => {
  const out = inChild(`
    const f = await fake();
    const tools = [{ type: 'function', function: { name: 'Read' } }];
    const phases1 = [];
    const system = systemPrompt({ cwd: '/tmp/a', git: 'x', date: new Date('2026-09-25') });
    const r1 = await warmUp({ sessionMark: SESSION_MARK, url: f.url, model, system, tools, thinking: false, slot: 0, onPhase: (p) => phases1.push(p) });
    const reads1 = f.calls.filter((c) => c.path === '/completion').map((c) => c.body.prompt);
    // another project, another day: the shared part is the same, so it restores
    const phases2 = [];
    const system2 = systemPrompt({ cwd: '/tmp/b', git: 'y', date: new Date('2027-01-02'), notes: 'Use tabs.' });
    f.calls.length = 0;
    const r2 = await warmUp({ sessionMark: SESSION_MARK, url: f.url, model, system: system2, tools, thinking: false, slot: 0, onPhase: (p) => phases2.push(p) });
    const reads2 = f.calls.filter((c) => c.path === '/completion').map((c) => c.body.prompt);
    Object.assign(out, {
      r1, r2, phases1, phases2,
      firstReadEndsBeforeSession: reads1[0].endsWith('\\n\\n') && !reads1[0].includes(SESSION_MARK),
      secondReadHasSession: reads1[1].includes('Today: 2026-09-25') && reads1[1].endsWith('<|im_start|>user\\n'),
      restoredThenOnlySession: reads2.length === 1 && reads2[0].includes('Use tabs.'),
      slotsUsed: [...new Set(f.calls.filter((c) => c.body?.id_slot !== undefined).map((c) => c.body.id_slot))],
      files: readdirSync(SLOT_DIR),
    });
    f.close();
  `);
  expect(out.phases1).toEqual(['reading']);
  expect(out.r1.restored).toBe(false);
  expect(out.phases2).toEqual(['restoring']);
  expect(out.r2.restored).toBe(true);
  expect(out.r2.file).toBe(out.r1.file);
  expect(out.firstReadEndsBeforeSession).toBe(true);
  expect(out.secondReadHasSession).toBe(true);
  expect(out.restoredThenOnlySession).toBe(true);
  expect(out.slotsUsed).toEqual([0]);
  // the shared part once, plus each start's whole first read
  expect(out.files.filter((f) => f.startsWith('warm-'))).toEqual([out.r1.file]);
  expect(out.files.filter((f) => f.startsWith('warmw-')).length).toBe(2);
});

test('the same instructions again (same folder, day and git state) restore in one step, with nothing read', () => {
  const out = inChild(`
    const f = await fake();
    const system = systemPrompt({ cwd: '/tmp/a', git: 'x', date: new Date('2026-09-25') });
    const r1 = await warmUp({ sessionMark: SESSION_MARK, url: f.url, model, system, tools: [], thinking: false, slot: 0 });
    f.calls.length = 0;
    const phases = [];
    const r2 = await warmUp({ sessionMark: SESSION_MARK, url: f.url, model, system, tools: [], thinking: false, slot: 0, onPhase: (p) => phases.push(p) });
    Object.assign(out, { r1, r2, phases, reads: f.calls.filter((c) => c.path === '/completion').length, restores: f.calls.filter((c) => /restore/.test(c.path)).map((c) => c.body.filename) });
    f.close();
  `);
  expect(out.r1.whole).toBeUndefined();
  expect(out.r2).toEqual({ restored: true, whole: true, file: out.restores[0] });
  expect(out.restores).toHaveLength(1);
  expect(out.restores[0]).toMatch(/^warmw-[0-9a-f]{16}\.bin$/);
  expect(out.phases).toEqual(['restoring']);
  expect(out.reads).toBe(0);
});

test('a server without the template endpoint falls back to a plain first read', () => {
  const out = inChild(`
    const f = await fake({ template: false });
    const phases = [];
    const r = await warmUp({ sessionMark: SESSION_MARK, url: f.url, model, system: systemPrompt({ cwd: '/tmp/a' }), tools: [], thinking: true, effort: 'high', slot: 0, onPhase: (p) => phases.push(p) });
    const chat = f.calls.find((c) => c.path === '/v1/chat/completions');
    Object.assign(out, { r, phases, kwargs: chat?.body.chat_template_kwargs, slot: chat?.body.id_slot });
    f.close();
  `);
  expect(out.r.restored).toBe(false);
  expect(out.r.fallback).toBeTruthy();
  expect(out.phases).toEqual(['reading']);
  expect(out.kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'xhigh' });
  expect(out.slot).toBe(0);
});

test('only the two most recently used saved warm-ups are kept', () => {
  const out = inChild(`
    const now = Date.now() / 1000;
    ['a', 'b', 'c'].forEach((n, i) => { const p = join(SLOT_DIR, 'warm-' + n.repeat(16) + '.bin'); writeFileSync(p, 'x'); utimesSync(p, now - 100 * i, now - 100 * i); });
    writeFileSync(join(SLOT_DIR, 'other.bin'), 'x');
    pruneSaved();
    out.files = readdirSync(SLOT_DIR).sort();
  `);
  expect(out.files).toEqual(['other.bin', 'warm-' + 'a'.repeat(16) + '.bin', 'warm-' + 'b'.repeat(16) + '.bin']);
});
