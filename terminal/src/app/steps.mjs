// The steps a request takes: one list for the whole hub. The Flow tab draws all
// of them; the Harness tab tells the same story as five stages, each made of one
// or two of these steps. Both pages are drawn from this file, so the two tabs
// cannot say different things (test/hub-steps.test.mjs).
//   who    u = you, h = the harness, m = the model
//   model  the step can call the model (the amber dot on the Flow tab)
// {The model} in a stage's words is the model's name when one model is picked on the Harness tab.
export const STAGES = [
  { id: 'ask', name: 'You ask', who: ['u'], text: 'You type a request and press Enter.' },
  { id: 'sort', name: 'It sorts', who: ['h', 'm'], note: { m: 'sometimes' }, text: 'Word rules pick the kind: rename, fix, change, question or task. {The model} is asked only when no rule fits.' },
  { id: 'work', name: 'It works', who: ['m', 'h'], text: 'Fix and change take a shortcut built for them. Rename needs no model at all. Everything else goes step by step.' },
  { id: 'check', name: 'It checks', who: ['u', 'h', 'm'], text: 'Before any change it asks for your OK. Afterwards it runs the project’s tests and checks that every part of your request was done.' },
  { id: 'done', name: 'Done', who: ['m', 'h'], text: '{The model} writes a sentence on what changed. The harness adds the files it touched and how many tests pass.' },
];

// kind: how the Flow tab draws the box ('you' = your end of it, 't1' = the terminal's).
export const STEPS = [
  { id: 'type', name: 'Type', stage: 'ask', model: false, kind: 'you', lines: ['enter sends', '@file · !cmd · /cmd'] },
  { id: 'sort', name: 'Sort', stage: 'sort', model: true, kind: 't1', lines: ['rules first; the model', 'only if none fits'] },
  { id: 'ask', name: 'Ask', stage: 'sort', model: true, kind: 't1', lines: ['2–3 answers to pick,', 'or type a line'] },
  { id: 'recall', name: 'Recall', stage: 'work', model: false, kind: 't1', lines: ['facts that fit are', 'written into it'] },
  { id: 'work', name: 'Work', stage: 'work', model: true, kind: 't1', lines: ['a focused path, or', 'the step-by-step loop'] },
  { id: 'check', name: 'Check', stage: 'check', model: true, kind: 't1', lines: ['diff vs your request;', 'sent back once if', 'a part is missing'] },
  { id: 'show', name: 'Show', stage: 'done', model: true, kind: 'you', lines: ['says what changed;', '“Worked for 41s”'] },
];

export const stepsOf = (stageId) => STEPS.filter((s) => s.stage === stageId);
const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a.join(''));
// How the two counts meet, in words: “It sorts” is Sort and Ask; “It works” is Recall and Work.
export const stagesInWords = () => STAGES.filter((g) => stepsOf(g.id).length > 1).map((g) => `“${g.name}” is ${list(stepsOf(g.id).map((s) => s.name))}`).join('; ');
