import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_INSTRUCTIONS, instructionFile, readInstructions, saveInstructions, validateInstructions, focusedInstructions } from '../src/agent/instructions.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { toolSchemas } from '../src/agent/tools.mjs';
import { TOP, recall } from '../src/agent/recall.mjs';
import { memoryDirs, applyChanges, readFacts } from '../src/agent/facts.mjs';
import { FakeEmbedder } from './fake-embedder.mjs';
import { runHeadless } from '../src/headless.mjs';
import { instructionsData, recallHooks } from '../src/app/instructions-hub.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { complete } from '../src/flows/llm.mjs';
import { pickFile } from '../src/flows/localize.mjs';
import { runFlows } from '../src/flows/index.mjs';
import { planFiles } from '../src/flows/multi.mjs';
import { startWeightsServer } from '../src/app/weights.mjs';
import { startFakeServer } from './fake-server.mjs';
import { MODELS, DEFAULT_MODEL, EMBEDDERS, DEFAULT_EMBEDDER } from '../../models/index.mjs';
let home, oldHome;
beforeEach(() => { oldHome = process.env.AGENTIC_HOME; home = mkdtempSync(join(tmpdir(), 'agentic-instructions-')); process.env.AGENTIC_HOME = home; });
afterEach(() => { if (oldHome === undefined) delete process.env.AGENTIC_HOME; else process.env.AGENTIC_HOME = oldHome; });
const changed = { general: 'Read evidence first. Report verified outcomes.', planning: 'Inspect, plan, check, revise.' };

test('defaults, atomic persistence, version conflicts and undo preserve both sections', () => {
 const first = readInstructions(); expect(first.sections).toEqual(DEFAULT_INSTRUCTIONS); expect(existsSync(instructionFile())).toBe(false);
 const saved = saveInstructions(changed, first.revision);
 expect(readInstructions().sections).toEqual(changed); expect(saved.history).toHaveLength(1);
 expect(() => saveInstructions(DEFAULT_INSTRUCTIONS, first.revision)).toThrow('changed in another window');
 expect(readInstructions().sections).toEqual(changed);
 const restored = saveInstructions(null, saved.revision, {undo:true}); expect(restored.sections).toEqual(DEFAULT_INSTRUCTIONS); expect(restored.history).toHaveLength(0);
 expect(() => saveInstructions(null, restored.revision, {undo:true})).toThrow('no previous');
});
test('invalid input and corrupt files cannot silently replace saved policy', () => {
 for (const sections of [{...changed, general:''}, {...changed,planning:'x'.repeat(6001)}, {...changed,general:'Shared working instructions\r\nother'}, {...changed,general:'bad\u0000text'}]) expect(() => validateInstructions(sections)).toThrow();
 const initial = readInstructions(); expect(() => saveInstructions({...changed,general:''}, initial.revision)).toThrow(); expect(readInstructions().revision).toBe(initial.revision);
 writeFileSync(instructionFile(), '{broken'); expect(() => saveInstructions(changed, initial.revision)).toThrow('Could not read');
});
test('hub saves, previews, undoes; rejects stale, cross-origin and oversized writes', async () => {
 writeFileSync(join(home,'AGENTS.md'), 'Use the project formatter.');
 const s = startWeightsServer({path:null,docsDir:null,port:0,cwd:home,instructionsHome:home});
 const post = (route, data, extra = {}) => fetch(s.url + route, {method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(data)});
 try {
  const hub = await (await fetch(s.url)).text(); expect(hub).toContain('data-tab="instructions"');
  expect((await fetch(s.url+'instructions')).status).toBe(200);
  const state = await (await fetch(s.url+'instructions.json')).json(); expect(state.sources).toContain(join(home,'AGENTS.md'));
  const body = {sections:changed,revision:state.revision};
  expect((await post('instructions/save',body,{origin:'https://example.org'})).status).toBe(403);
  expect((await post('instructions/save',body,{'sec-fetch-site':'cross-site'})).status).toBe(403);
  expect((await post('instructions/save',{...body,pad:'x'.repeat(80000)})).status).toBe(413);
  expect(readInstructions().customized).toBe(false);
  const savedResponse = await post('instructions/save',body,{origin:s.url.slice(0,-1)}); expect(savedResponse.status).toBe(200);
  const saved = await savedResponse.json(); expect(saved.sections).toEqual(changed);
  for (const prompt of [saved.preview,saved.focusedPreview]) { expect(prompt).toContain(changed.general); expect(prompt).toContain(changed.planning); expect(prompt).toContain('Use the project formatter.'); }
  expect((await post('instructions/save',body)).status).toBe(409);
  const restored = await (await post('instructions/undo',{revision:saved.revision})).json(); expect(restored.sections).toEqual(DEFAULT_INSTRUCTIONS);
 } finally { s.stop(); }
});
test('a saved policy reaches the next task and focused JSON calls with project rules', async () => {
 writeFileSync(join(home, 'AGENTS.md'), 'Project policy: use local tests.');
 const model = MODELS[DEFAULT_MODEL], fake = await startFakeServer([{text:'Ready.'},{text:'{"files":["main.mjs"]}'}],{delayMs:0});
 try {
  const agent = new Agent({url:fake.url,model,cwd:home,system:systemPrompt({cwd:home,notes:'Project policy: use local tests.',tests:null}),memory:false,flows:false,mode:'plan',verify:false});
  const before = agent.flowContext().instructions;
  saveInstructions(changed, readInstructions().revision);
  expect(agent.flowContext().instructions).toBe(before); // no mid-task mutation
  agent.moveTo(home); expect(agent.flowContext().instructions).toContain(DEFAULT_INSTRUCTIONS.general);
  await agent.send('hello');
  expect(agent.messages[0].content).toContain(changed.general);
  const instructions = agent.flowContext().instructions;
  const r = await complete({url:fake.url,model,instructions,system:'Return JSON only.',user:'Pick the file.',schema:{type:'object',properties:{files:{type:'array',items:{type:'string'}}},required:['files']}});
  expect(r.json).toEqual({files:['main.mjs']});
  const sent = fake.requests.at(-1); expect(sent.messages[0].content).toContain(changed.planning); expect(sent.messages[0].content).toContain('Project policy: use local tests.'); expect(sent.messages[0].content).toContain('Return JSON only.'); expect(sent.response_format.type).toBe('json_schema');
  expect(focusedInstructions(agent.messages[0].content)).toBe(instructions);
 } finally { await fake.close(); }
});
test('named scope is not silently cut to the four-file focused limit', async () => {
 const names = ['a.mjs','b.mjs','c.mjs','d.mjs','e.mjs']; for (const n of names) writeFileSync(join(home,n), 'export const x = 1;');
 expect(await planFiles({cwd:home}, 'Change ' + names.join(', '), names)).toEqual(names);
 const notes = []; const result = await runFlows({cwd:home,emit:()=>{},note:text=>notes.push(text)}, 'Add a helper to ' + names.join(', '));
 expect(result).toBeNull(); expect(notes.join(' ')).toContain('more files');
});

test('file selection receives shared instructions without breaking its constrained output', async () => {
 for (const n of ['left.mjs','right.mjs']) writeFileSync(join(home,n), 'export const answer = 42;');
 const fake = await startFakeServer([{text:'{"file":"right.mjs"}'}],{delayMs:0});
 try {
  const file = await pickFile({cwd:home,url:fake.url,model:MODELS[DEFAULT_MODEL],instructions:'Use project evidence.',task:'fix the calculation',files:['left.mjs','right.mjs']});
  expect(file).toBe('right.mjs'); expect(fake.requests[0].messages[0].content).toContain('Use project evidence.');
 } finally { await fake.close(); }
});

test('the preview shows the rest of what the model receives: folder, the tools, memory, both models, what focused calls leave out', async () => {
 writeFileSync(join(home,'AGENTS.md'), 'Use the project formatter.');
 const s = startWeightsServer({path:null,docsDir:null,port:0,cwd:home,instructionsHome:home});
 try {
  const { sees, preview, focusedPreview } = await (await fetch(s.url+'instructions.json')).json();
  expect(sees.folder.path).toBe(home);
  expect(sees.tools).toEqual(JSON.parse(JSON.stringify(toolSchemas())));
  expect(sees.models.map((m) => m.id).sort()).toEqual(Object.keys(MODELS).sort());
  expect(sees.recall.top).toBe(TOP); expect(sees.recall.example).toContain('From your memory');
  expect(sees.focusedLeftOut).toContain('Tool use');
  for (const h of sees.focusedLeftOut) { expect(preview).toContain(`\n${h}\n`); expect(focusedPreview).not.toContain(`\n${h}\n`); }
  const page = await (await fetch(s.url+'instructions')).text();
  for (const view of ['main','focused','tools','added','models']) expect(page).toContain(`<option value="${view}">`);
 } finally { s.stop(); }
});

test('the reply limit and thinking switch on the page are what a real request carries, for both models and both levels', async () => {
 writeFileSync(join(home,'main.mjs'), 'export const x = 1;\n');
 const { sees } = instructionsData(home, home);
 for (const m of sees.models) for (const [thinking, level] of [[true, m.levels.find((l) => l.effort)], [false, m.levels.find((l) => !l.effort)]]) {
  const fake = await startFakeServer([{text:'Done.'}],{delayMs:0});
  try {
   await runHeadless({prompt:'Rename x to count in main.mjs',cwd:home,url:fake.url,model:MODELS[m.id],thinking,effort:thinking?level.effort:undefined,flows:false,rank:false,memory:false,autoApprove:true});
   const sent = fake.requests.find((r) => r.stream && r.messages?.length);
   expect(sent.max_tokens).toBe(level.replyLimit); expect(sent.chat_template_kwargs).toEqual(level.kwargs);
   expect(sent.temperature).toBe((thinking ? m.thinkingSampling : m.sampling).temperature);
  } finally { await fake.close(); }
 }
});

test('Try a request shows which saved facts would be attached, with closeness, and never counts as using them', async () => {
 const dirs = memoryDirs(home);
 applyChanges(dirs.project, { add: [{ kind: 'project', text: 'Run the tests with `node --test`.' }, { kind: 'project', text: 'Every page about Agentic Coder is saved in the DOCS folder.' }] }, { today: '2026-09-26' });
 const before = JSON.stringify(readFacts(dirs.project)), original = recallHooks.embedder;
 recallHooks.embedder = () => new FakeEmbedder();
 const s = startWeightsServer({path:null,docsDir:null,port:0,cwd:home,instructionsHome:home});
 const post = (data, extra = {}) => fetch(s.url + 'instructions/recall', {method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(data)});
 try {
  const r = await (await post({request:'can you check the suite still passes'})).json();
  expect(r.how).toBe('meaning'); expect(r.cut).toBe(EMBEDDERS[DEFAULT_EMBEDDER].cut);
  expect(r.attached.map((f) => f.text)).toEqual(['Run the tests with `node --test`.']); expect(r.attached[0].close).toBeGreaterThanOrEqual(r.cut);
  expect(r.near.length).toBe(1); expect(r.near[0].close).toBeLessThan(r.attached[0].close);
  expect(r.goesAlong).toContain('From your memory'); expect(r.goesAlong).toContain('node --test');
  expect(JSON.stringify(readFacts(dirs.project))).toBe(before); // trying a request is not a use
  expect((await post({request:'   '})).status).toBe(400);
  expect((await post({request:'x'},{'sec-fetch-site':'cross-site'})).status).toBe(403);
  expect('near' in await recall(home, 'check the suite', { embedder: new FakeEmbedder(), mark: false })).toBe(false); // the agent's own call is unchanged
 } finally { recallHooks.embedder = original; s.stop(); }
});
