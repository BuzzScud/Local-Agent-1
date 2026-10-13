// One effort for a whole turn on a model whose template writes it at the top of the prompt
// (agent.mjs stepEffort): a new effort there is a new prompt from its first word.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, GENERIC_REMOTE, setEndpoint, dropEndpoint } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';
import { startFakeAnthropic } from './fake-anthropic.mjs';

const folder = () => mkdtempSync(join(tmpdir(), 'agentic-step-effort-'));

// Bonsai's template wrote "Reasoning effort is set to xhigh…" first: a new effort mid-turn
// made the server read the whole conversation again (1 Oct: 3 minutes, three times). Bonsai left
// the list on 9 Oct 2026 and no model left has effortAtTop, so a stand-in (K2 with it set) is that model.
test('a turn keeps one effort when the template writes it at the top (a stand-in with effortAtTop); others step down after a change', async () => {
  const kwargs = async (m) => {
    const cwd = folder();
    const fake = await startFakeServer([
      { tool: { name: 'Write', args: { path: 'notes.txt', content: 'a\n' } } },
      { text: 'Saved notes.txt.' },
    ]);
    const agent = new Agent({ url: fake.url, model: m, cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: true, effort: 'high', mode: 'edits', flows: false, verify: false, confirmPlan: false, checkIns: false, ask: async () => ({ choice: 'yes' }) });
    await agent.send('write a notes file');
    await fake.close();
    const sent = fake.requests.map((r) => r.chat_template_kwargs?.reasoning_effort);
    expect(sent.length).toBeGreaterThan(1);
    return [...new Set(sent)];
  };
  const atTop = { ...MODELS.k2, effortAtTop: true };
  expect(await kwargs(atTop)).toEqual(['high']);
  expect(await kwargs(MODELS.k2)).toEqual(['high', 'medium']); // K2's effort sits at the end of its prompt
});

// The Claude API keys its prompt cache on the effort too: the Cache check of 13 Oct 2026 found the step after the first
// change (High → Medium) reading 0% from the cache in both tasks that changed a file.
test('on the Claude API a turn keeps one effort after a change, so its prompt cache holds', async () => {
  const cwd = folder();
  const fake = await startFakeAnthropic([
    { tool: { name: 'Write', args: { path: 'notes.txt', content: 'a\n' } } },
    { tool: { name: 'Read', args: { path: 'notes.txt' } } },
    { text: 'Saved notes.txt.' },
  ]);
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: 'claude-opus-5-5', label: 'claude' });
  try {
    const agent = new Agent({ url: fake.url, model: { ...GENERIC_REMOTE, remote: { kind: 'claude' } }, cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: true, effort: 'high', mode: 'edits', flows: false, verify: false, confirmPlan: false, checkIns: false, memory: false, ask: async () => ({ choice: 'yes' }) });
    await agent.send('write a notes file');
    expect(agent.turn?.changed ?? true).toBeTruthy();
    const sent = fake.seen.filter((x) => x.path.startsWith('/v1/messages')).map((x) => x.body.output_config?.effort);
    expect(sent.length).toBeGreaterThan(2);
    expect([...new Set(sent)]).toEqual(['high']);
  } finally { dropEndpoint(fake.url); await fake.close(); }
});
