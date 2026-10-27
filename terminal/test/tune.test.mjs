// /tune (27 Oct 2026, the owner: "can u add a command to tune bonsai?"): the model in use in one panel, its
// presets and its own rows (src/app/limits.mjs), its own instructions (the instructions' "For this model"
// part), its Thinking time, Bonsai's suggested values and the command in the / menu. The Arena's side (its
// settings and the set "tune") is models/test/tune-arena.test.mjs and arena-remote.test.mjs.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, PRESETS, presetOf, readLimits, moveLimit, limitsToSave, limitChanges, modelWithLimits, applyLimits, shownLimits, tuneGroup, TUNE_ROWS, OWN_ROWS, cleanNotes, NOTES_MAX, showLimit, limitNote } from '../src/app/limits.mjs';
import { instructionBlock, withModelNotes, replaceInstructionBlock } from '../src/agent/instructions.mjs';
import { suggestedFor } from '../src/app/remote-suggested.mjs';
import { COMMANDS, WHEN_ROOM, matchCommands } from '../src/app/commands.mjs';
import { MODEL_COMMANDS } from '../src/app/slash-model.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { THINK_BUDGET_SECS } from '../src/agent/agent-said.mjs';

// A model on an Ollama service, as remoteModel makes one (only what the rows read).
const on = (name) => ({ id: 'remote', name, remote: { kind: 'openai', model: name, ollama: '0.40.11' }, maxCtx: 262144, thinkingLevels: [{ id: 'off', label: 'Off' }, { id: 'on', label: 'On', effort: 'on' }] });
const bonsai = on('bonsai-2:9b');
const project = () => { const d = mkdtempSync(join(tmpdir(), 'agentic-tune-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };

test('presets move the sampling rows together; a row moved by hand reads as Custom; Preset itself is never saved or listed as a change', () => {
  const v = readLimits({}, bonsai);
  // Bonsai's defaults: every sampling row its own (its Modelfile), so Maker's own; Qwen3.6 starts on Coding (qwenCoding)
  expect(v.preset).toBe('own');
  expect(readLimits({}, on('qwen3.6:35b-a3b')).preset).toBe('coding');
  expect(Object.keys(PRESETS)).toEqual(['coding', 'own', 'steady']);
  const coding = moveLimit(v, 'preset', -1, bonsai);
  expect(coding).toMatchObject({ preset: 'coding', temperature: 0.6, presence: 0, topP: 'own', topK: 'own', repeatPenalty: 'own' });
  const steady = moveLimit(moveLimit(coding, 'preset', 1, bonsai), 'preset', 1, bonsai);
  expect(steady).toMatchObject({ preset: 'steady', temperature: 0.2, presence: 0 });
  expect(moveLimit(steady, 'preset', 1, bonsai)).toBe(steady); // the last one: nowhere further
  const custom = moveLimit(coding, 'topK', 1, bonsai);
  expect(custom).toMatchObject({ preset: 'custom', topK: 10, temperature: 0.6 });
  expect(showLimit('preset', 'custom')).toBe('Custom');
  expect(limitNote('preset', { values: custom })).toContain('your own mix');
  // from Custom, → picks the first preset again
  expect(moveLimit(custom, 'preset', 1, bonsai).preset).toBe('coding');
  // saved: the rows, never the preset; the note after a save names the rows
  expect(limitsToSave(custom, bonsai)).toEqual({ temperature: 0.6, presence: 0, topK: 10 });
  expect(limitChanges(v, custom).map((c) => c.id)).toEqual(['temperature', 'presence', 'topK']);
  expect(presetOf({ temperature: 0.6, presence: 0, topP: 'own', topK: 'own', repeatPenalty: 'own' })).toBe('coding');
});

test('/tune shows its rows in its own order under two headings; /effort and /model’s menu keep theirs', () => {
  expect(shownLimits(bonsai, { tune: true }).map((l) => l.id)).toEqual(TUNE_ROWS);
  expect(TUNE_ROWS[0]).toBe('preset');
  expect(TUNE_ROWS.map(tuneGroup)).toEqual(['How it writes', 'How it writes', 'How it writes', 'How it writes', 'How it writes', 'How it writes', 'Limits', 'Limits', 'Limits', 'Limits', 'Limits', 'Limits']);
  const tuneOnly = LIMITS.filter((l) => l.tune).map((l) => l.id);
  expect(tuneOnly).toEqual(['preset', 'topP', 'topK', 'repeatPenalty', 'thinkTime']);
  for (const opts of [{}, { own: true }]) for (const id of tuneOnly) expect(shownLimits(bonsai, opts).map((l) => l.id)).not.toContain(id);
  // kept by model like the rest of its own rows; the preset is read back, not kept
  for (const id of ['topP', 'topK', 'repeatPenalty', 'thinkTime']) expect(OWN_ROWS).toContain(id);
  expect(OWN_ROWS).not.toContain('preset');
});

test('a model’s own rows and instructions: read from its set-up, sent with its requests, and its instructions the last part of the working instructions', () => {
  const settings = { remote: { tuned: { 'bonsai-2:9b': { limits: { temperature: 0.6, presence: 0, topP: 0.9, topK: 20, repeatPenalty: 1.05, steps: 120 }, notes: '  Read a file once, then edit it.  ' } } } };
  const v = readLimits(settings, bonsai);
  expect(v).toMatchObject({ temperature: 0.6, topP: 0.9, topK: 20, repeatPenalty: 1.05, steps: 120, preset: 'custom', notes: 'Read a file once, then edit it.' });
  // another model has none of them
  expect(readLimits(settings, on('tiny:3b')).notes).toBe(undefined);
  expect(readLimits(settings, bonsai, { own: false }).notes).toBe(undefined);
  const m = modelWithLimits(bonsai, v);
  expect(m.sampling).toEqual({ temperature: 0.6, presence_penalty: 0, top_p: 0.9, top_k: 20, repeat_penalty: 1.05 });
  expect(m.thinkingSampling).toEqual(m.sampling);
  expect(m.ownNotes).toBe('Read a file once, then edit it.');
  // 'own' leaves the service's; none taken out again
  expect(modelWithLimits(bonsai, readLimits({}, bonsai)).sampling).toBe(undefined);
  expect(modelWithLimits(m, { ...v, notes: undefined }).ownNotes).toBe(undefined);
  expect(cleanNotes('x'.repeat(NOTES_MAX + 50)).length).toBe(NOTES_MAX);
  expect(cleanNotes(42)).toBe('');
  // the block: a part of its own at the end, none without
  const sections = { general: 'Be careful.', planning: 'Plan first.' };
  expect(instructionBlock(sections)).not.toContain('For this model');
  expect(instructionBlock(withModelNotes(sections, 'Read once.'))).toContain('Planning\nPlan first.\n\nFor this model\nRead once.');
  expect(withModelNotes(sections, '')).toBe(sections);
});

test('an agent on a model with its own instructions starts with them in its prompt; a change there is in the next message’s prompt, with a line', async () => {
  const cwd = project();
  const model = modelWithLimits(bonsai, { notes: 'Read each file once.' });
  const agent = new Agent({ url: 'http://127.0.0.1:9', model, cwd, system: systemPrompt({ cwd }), verify: false, flows: false });
  expect(agent.messages[0].content).toContain('For this model\nRead each file once.');
  expect(agent.workingInstructions.model).toBe('Read each file once.');
  const notes = [];
  const emit = agent.emit.bind(agent);
  agent.emit = (type, e) => { if (type === 'note') notes.push(e.text); return emit(type, e); };
  agent.model = modelWithLimits(bonsai, { notes: 'Search before reading.' });
  agent.loadChanges();
  expect(agent.messages[0].content).toContain('For this model\nSearch before reading.');
  expect(agent.messages[0].content).not.toContain('Read each file once.');
  expect(notes).toContain('bonsai-2:9b’s own instructions (/tune) loaded.');
  agent.model = modelWithLimits(bonsai, {});
  agent.loadChanges();
  expect(agent.messages[0].content).not.toContain('For this model');
  expect(notes).toContain('bonsai-2:9b’s own instructions (/tune) taken out.');
  // a model with none starts as before, letter for letter
  const plain = new Agent({ url: 'http://127.0.0.1:9', model: bonsai, cwd, system: systemPrompt({ cwd }), verify: false, flows: false });
  expect(replaceInstructionBlock(plain.messages[0].content, plain.workingInstructions)).toBe(plain.messages[0].content);
});

test('Thinking time: the agent’s time for a request, auto what it started with; AGENTIC_THINK_BUDGET still wins', () => {
  const was = process.env.AGENTIC_THINK_BUDGET;
  delete process.env.AGENTIC_THINK_BUDGET;
  try {
    const agent = { thinkBudgetSecs: 420 }; // a run that started with its own (a practice run's limit)
    const base = readLimits({}, bonsai);
    applyLimits(agent, { ...base, thinkTime: 1800 });
    expect(agent.thinkBudgetSecs).toBe(1800);
    applyLimits(agent, { ...base, thinkTime: 0 });
    expect(agent.thinkBudgetSecs).toBe(420);
    expect(limitNote('thinkTime', { values: { thinkTime: 0 } })).toContain(`${Math.round(THINK_BUDGET_SECS / 60)} min`);
    process.env.AGENTIC_THINK_BUDGET = '600';
    applyLimits(agent, { ...base, thinkTime: 3600 });
    expect(agent.thinkBudgetSecs).toBe(420);
    expect(limitNote('thinkTime', { values: { thinkTime: 3600 } })).toContain('AGENTIC_THINK_BUDGET (10 min) is set for this window and wins');
  } finally { if (was === undefined) delete process.env.AGENTIC_THINK_BUDGET; else process.env.AGENTIC_THINK_BUDGET = was; }
});

test('Bonsai’s suggested values are the ones measured on this Mac: 64k and 120 steps, its sampling left to you', () => {
  const sg = suggestedFor('bonsai-2:9b', bonsai);
  expect(sg.limits).toEqual({ context: 65536, steps: 120 });
  expect(sg.source).toBe('measured on this Mac, 27 Oct 2026');
});

test('/tune is in the / menu on a service (after /jumptomac among the rows shown when there is room), /tu finds it, and it is a model command', () => {
  const c = COMMANDS.find((x) => x.name === 'tune');
  expect(c.desc).toContain('Tune the model in use');
  expect(COMMANDS[COMMANDS.indexOf(c) - 1].name).toBe('model');
  expect([...WHEN_ROOM].slice(0, 2)).toEqual(['jumptomac', 'tune']);
  expect(MODEL_COMMANDS).toContain('tune');
  expect(matchCommands('/tu', { service: true, room: 18, remote: true }).map((x) => x.name)).toContain('tune');
  expect(matchCommands('/', { service: true, room: 60, remote: true }).map((x) => x.name)).toContain('tune');
  // this Mac's model and the Claude API: not in the menu (typed in full it opens /effort); the 18 of a small window as before
  expect(matchCommands('/', { room: 60 }).map((x) => x.name)).not.toContain('tune');
  expect(matchCommands('/', { room: 60, remote: true, claude: true }).map((x) => x.name)).not.toContain('tune');
  expect(matchCommands('/').map((x) => x.name)).toContain('jumptomac');
});

