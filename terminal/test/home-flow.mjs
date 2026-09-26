// Run by home.test.mjs in its own process with HOME set to a pretend home
// folder (Bun keeps the real home for the whole process). Prints [label, passed] pairs.
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt, projectNotes, gitSummary } from '../src/agent/prompt.mjs';
import { startFakeServer } from './fake-server.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
const home = homedir();
const results = [];
const proj = join(home, 'Desktop', 'MAIN2026');
mkdirSync(join(proj, 'desks/chart'), { recursive: true });
writeFileSync(join(proj, 'package.json'), '{"name":"main2026"}');
writeFileSync(join(proj, 'AGENTS.md'), 'MARKER-PROJECT-RULES: house rules for MAIN2026');
writeFileSync(join(proj, 'desks/chart/index.html'), '<div class="hud"><div id="sym-menu"></div></div>');
writeFileSync(join(home, 'AGENTS.md'), 'MARKER-HOME-RULES');
mkdirSync(join(home, 'mathbits'), { recursive: true });
for (let i = 0; i < 12; i++) writeFileSync(join(home, 'mathbits', `m${i}.py`), `def mul${i}(a, b):\n    return a * b\n`);
const model = MODELS[DEFAULT_MODEL];
const make = (url, events, asks) => {
  const a = new Agent({ url, model, cwd: home, system: systemPrompt({ cwd: home, notes: projectNotes(home).text, git: gitSummary(home) }), thinking: false, mode: 'edits', flows: true,
    ask: async (req) => { asks.push(req.args?.question ?? req.name); const q = req.args?.question ?? '';
      if (q.startsWith('Work in')) return { choice: 'answer', text: 'Yes, work in MAIN2026' };
      if (req.kind === 'plan') return { choice: 'yes' };
      return { choice: 'answer', text: 'in desks/chart/index.html; the list should be on top of the legend' }; } });
  for (const t of ['note', 'tool', 'cwd', 'assistant']) a.on(t, (e) => events.push({ type: t, ...e }));
  return a;
};
const ok = (label, cond) => results.push([label, Boolean(cond)]);

// 1 · A general question at home
{
  const fake = await startFakeServer([{ text: 'Multiply digit by digit and add the rows: 23 × 45 = 1035. If you actually meant how multiplication is implemented here rather than the general concept, tell me and I\'ll dig into the specific file(s).' }, { text: 'SHOULD NOT BE ASKED FOR' }]);
  const events = [], asks = [];
  const a = make(fake.url, events, asks);
  const reason = await a.send('how does multiplication work?');
  const chats = fake.requests.filter((r) => r.stream);
  ok('general question: ends after the answer (one model request, no "go ahead")', reason === 'done' && chats.length === 1 && fake.remaining() === 1);
  ok('general question: no file list of the home folder', !events.some((e) => e.type === 'tool' && /project map/.test(e.arg ?? '')));
  ok('general question: told it is the home folder', a.messages[0].content.includes("Here: the user's home folder, not a project."));
  ok('general question: no "Work in …?" question', asks.length === 0);
  await fake.close();
}
// 2 · A named project from home
{
  const fake = await startFakeServer([{ text: 'Raised the strip above the legend. Checked by reading the page.' }]);
  const events = [], asks = [];
  const a = make(fake.url, events, asks);
  const reason = await a.send('the symbol dropdown is hidden behind the legend in MAIN2026, fix it');
  const notes = events.filter((e) => e.type === 'note').map((e) => e.text);
  ok('project: asked once "Work in ~/Desktop/MAIN2026?"', asks.filter((q) => q.startsWith('Work in ~/Desktop/MAIN2026?')).length === 1);
  ok('project: moved in (cwd + event)', realpathSync(a.cwd) === realpathSync(proj) && events.some((e) => e.type === 'cwd'));
  ok("project: reads MAIN2026's AGENTS.md and home's", a.messages[0].content.includes('MARKER-PROJECT-RULES') && a.messages[0].content.includes('MARKER-HOME-RULES'));
  ok('project: the home-folder note is gone', !a.messages[0].content.includes('not a project'));
  ok('project: sorted as a Layout bug', notes.some((n) => /This looks like a Layout bug/.test(n)));
  ok('project: skipped the test suite, went step by step', notes.some((n) => /can't see a Layout bug.*step by step/.test(n)));
  const chat = fake.requests.filter((r) => r.stream).at(-1);
  const sent = chat?.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n') ?? '';
  ok('project: the Layout steps went with the request to the model', sent.includes('How to fix a Layout bug'));
  ok('project: but are not stored in the conversation', !a.messages.some((m) => typeof m.content === 'string' && m.content.includes('How to fix a Layout bug')));
  await fake.close();
}
console.log(JSON.stringify(results));
