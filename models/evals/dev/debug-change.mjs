import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const R = new URL('../../../', import.meta.url).pathname.replace(/\/$/, ''); // the repo
const { Agent } = await import(`${R}/terminal/src/agent/agent.mjs`);
const { systemPrompt } = await import(`${R}/terminal/src/agent/prompt.mjs`);
const { MODELS, DEFAULT_MODEL } = await import(`${R}/models/registry.mjs`);
const task = process.argv[2];
const work = join(mkdtempSync(join(tmpdir(), 'dbg-')), 'project');
cpSync(`${R}/models/evals/tasks/${task}/project`, work, { recursive: true });
const prompt = readFileSync(`${R}/models/evals/tasks/${task}/task.txt`, 'utf8').trim();
const agent = new Agent({ url: 'http://127.0.0.1:17650', model: MODELS[DEFAULT_MODEL], cwd: work, system: systemPrompt({ cwd: work }), thinking: false, ctx: 16384, mode: 'edits',
  ask: async (req) => { if (req.name === 'Test') { console.log('--- TEST FOR APPROVAL:\n' + req.prepared.after.split('\n').slice(-18).join('\n')); } return { choice: 'yes' }; } });
agent.on('tries-done', (e) => console.log('tries:', e.label, e.marks.join(''), e.summary));
agent.on('note', (e) => console.log('note:', e.text));
agent.flows = true;
const orig = (await import(`${R}/terminal/src/flows/tries.mjs`));
await agent.send(prompt);
console.log('--- FINAL', readFileSync(join(work, task.startsWith('3') ? 'strings.mjs' : 'export.mjs'), 'utf8').slice(-400));
process.exit(0);
