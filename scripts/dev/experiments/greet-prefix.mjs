// Does a greeting sent with tool_choice "none" reuse the saved warm-up?
// Measures how many prompt tokens the server had to read for "hello" with
// tools on (auto) and off (none), each right after a fresh warm-up.
//   node scripts/dev/experiments/greet-prefix.mjs
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL } from '../../../src/server/models.mjs';
import { ModelServer } from '../../../src/server/server.mjs';
import { warmUp } from '../../../src/server/warmup.mjs';
import { streamChat } from '../../../src/agent/client.mjs';
import { systemPrompt, projectNotes, gitSummary } from '../../../src/agent/prompt.mjs';
import { toolSchemas } from '../../../src/agent/tools.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const model = MODELS[DEFAULT_MODEL];
const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-greet-')), 'demo');
cpSync(join(root, 'demo-project'), cwd, { recursive: true });
const srv = new ModelServer(model);
const st = await srv.start({ ctx: 32768, share: false });
const system = systemPrompt({ cwd, notes: projectNotes(cwd).text, git: gitSummary(cwd) });
const out = {};
try {
  for (const choice of ['auto', 'none', 'none']) {
    const w = await warmUp({ url: srv.url, model, system, tools: toolSchemas(), thinking: false, slot: 0 });
    const t0 = Date.now();
    let text = '';
    let timings = null;
    for await (const ev of streamChat({ url: srv.url, model, messages: [{ role: 'system', content: system }, { role: 'user', content: 'hello' }], tools: toolSchemas(), toolChoice: choice, thinking: false, sampling: model.sampling, maxTokens: 200, slot: 0 })) {
      if (ev.type === 'text') text += ev.text;
      if (ev.type === 'done') timings = ev.timings;
    }
    const row = { restored: w.restored, promptRead: timings?.prompt_n, secs: (Date.now() - t0) / 1000, reply: text.slice(0, 80) };
    (out[choice] ??= []).push(row);
    console.log(`tool_choice ${choice}: read ${row.promptRead} prompt tokens, ${row.secs}s, restored=${row.restored}: ${JSON.stringify(row.reply)}`);
  }
} finally { await srv.stop(); }
console.log(JSON.stringify(out));
