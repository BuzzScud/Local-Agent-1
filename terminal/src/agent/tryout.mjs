// The try-out (2 Oct 2026, the user's pick: "the first time I pick it"): one short real
// task for a model on an Ollama service, before it is trusted with work. Three turns
// with the app's own Read, Edit and Bash tools, nothing run for real: does it call
// Read for the file named, Edit the spelling mistake it was shown, and Bash for the
// command asked for? A service lists "tools" for a model whose chat template takes
// them; only this says the calls come out right. A call written as text that the
// agent would rescue (toolCallInText, bareCallInText) counts, as the agent runs it.
// Answers { ok, steps: [{ ok, text }], tokS, why, secs }; tryouts.mjs keeps it.
import { streamChat } from './client.mjs';
import { toolSchemas, parseArgs } from './tools.mjs';
import { toolCallInText, bareCallInText } from './agent.mjs';

const TOOLS = ['Read', 'Edit', 'Bash'];
const FILE = 'notes.txt';
const TEXT = '1\tShopping list\n2\tHello wrold, buy milk\n3\tand bread\n';

// One turn: the model's first call ({ name, args } as an object), its words, and its speed.
async function turn({ url, use, messages, tools, signal }) {
  let text = '', reasoning = '', tokS;
  const calls = [];
  for await (const ev of streamChat({ url, use, messages, tools, toolChoice: 'auto', thinking: false, maxTokens: 400, sampling: { temperature: 0 }, signal })) {
    if (ev.type === 'text') text += ev.text;
    else if (ev.type === 'reasoning') reasoning += ev.text;
    else if (ev.type === 'tool') calls.push({ name: ev.name, args: ev.args });
    else if (ev.type === 'done') tokS = ev.timings?.predicted_per_second;
  }
  const c = calls[0] ?? toolCallInText(text) ?? (!text.trim() ? toolCallInText(reasoning) : null) ?? bareCallInText(text, TOOLS);
  let args = {};
  // As the agent reads them (other names for an argument accepted); a call it would refuse keeps its raw arguments.
  if (c) { const p = parseArgs(c.name, c.args); if (p.args) args = p.args; else { try { args = JSON.parse(c.args || '{}'); } catch { args = {}; } } }
  return { call: c ? { name: c.name, args, raw: c.args } : null, text: text.trim(), tokS, inText: Boolean(c && !calls.length) };
}

// The first text value among a call's argument names (the agent accepts several, tools.mjs ALIASES).
const argOf = (args, names) => names.map((n) => args?.[n]).find((v) => typeof v === 'string') ?? '';

// numCtx, keepAlive: the main model's own, when it is the one tried (another size would load it again).
export async function tryOut({ url, model, entry = {}, numCtx = 8192, keepAlive = '10m', signal }) {
  const t0 = Date.now();
  const use = { model, numCtx, thinks: Boolean(entry.thinking), tools: true, family: entry.family ?? '', keepAlive };
  const tools = toolSchemas('app').filter((t) => TOOLS.includes(t.function.name));
  const steps = [];
  const speeds = [];
  const messages = [
    { role: 'system', content: 'You are a coding agent working in a project folder. Act with the tools; one tool call at a time.' },
    { role: 'user', content: `Read the file ${FILE}.` },
  ];
  const fail = (why) => ({ ok: false, steps, why, tokS: avg(speeds), secs: (Date.now() - t0) / 1000 });
  const said = (r) => (r.call ? `${r.call.name}(${String(r.call.raw ?? '').slice(0, 60)})` : r.text ? `"${r.text.replace(/\s+/g, ' ').slice(0, 60)}"` : 'nothing');
  try {
    // 1 · Read the file named.
    let r = await turn({ url, use, messages, tools, signal });
    if (r.tokS) speeds.push(r.tokS);
    const p1 = argOf(r.call?.args, ['path', 'file_path', 'filePath', 'filename', 'file']);
    if (r.call?.name !== 'Read' || !p1.endsWith(FILE)) { steps.push({ ok: false, text: `read a file: it answered ${said(r)}` }); return fail(r.call ? 'wrong call' : r.text ? 'answered in words, no call' : 'no answer'); }
    steps.push({ ok: true, text: `read a file${r.inText ? ' (written as text, rescued)' : ''}` });
    // 2 · Fix the spelling mistake it was shown.
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ path: FILE }) } }] });
    messages.push({ role: 'tool', tool_call_id: 'c1', name: 'Read', content: TEXT });
    messages.push({ role: 'user', content: `Fix the spelling mistake in ${FILE} with Edit.` });
    r = await turn({ url, use, messages, tools, signal });
    if (r.tokS) speeds.push(r.tokS);
    const old = argOf(r.call?.args, ['old_text', 'old_string', 'oldText', 'old', 'search', 'find']);
    const neu = argOf(r.call?.args, ['new_text', 'new_string', 'newText', 'new', 'replace', 'replacement']);
    if (r.call?.name !== 'Edit' || !old.includes('wrold') || !neu.includes('world')) { steps.push({ ok: false, text: `fixed one line: it answered ${said(r)}` }); return fail(r.call ? 'the edit was wrong' : 'answered in words, no call'); }
    steps.push({ ok: true, text: `fixed one line${r.inText ? ' (written as text, rescued)' : ''}` });
    // 3 · Run a command.
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'Edit', arguments: JSON.stringify({ path: FILE, old_text: 'wrold', new_text: 'world' }) } }] });
    messages.push({ role: 'tool', tool_call_id: 'c2', name: 'Edit', content: `Edited ${FILE}: 1 line changed.` });
    messages.push({ role: 'user', content: 'Now run the command: echo ok' });
    r = await turn({ url, use, messages, tools, signal });
    if (r.tokS) speeds.push(r.tokS);
    const cmd = argOf(r.call?.args, ['command', 'cmd', 'script']);
    if (r.call?.name !== 'Bash' || !/echo\s+ok/.test(cmd)) { steps.push({ ok: false, text: `ran a command: it answered ${said(r)}` }); return fail(r.call ? 'wrong command' : 'answered in words, no call'); }
    steps.push({ ok: true, text: `ran a command${r.inText ? ' (written as text, rescued)' : ''}` });
    return { ok: true, steps, tokS: avg(speeds), secs: (Date.now() - t0) / 1000, why: null };
  } catch (e) {
    if (signal?.aborted) throw e;
    steps.push({ ok: false, text: e.message.slice(0, 120) });
    return fail(/does not support tools/i.test(e.message) ? 'no tools' : /out of memory|no room/i.test(e.message) ? 'did not fit' : 'error');
  }
}
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
