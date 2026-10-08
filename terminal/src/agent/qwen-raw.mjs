// Qwen 3.5 and 3.6 on an Ollama service, read here instead of by Ollama (8 Oct 2026, the owner: "how do we make
// it more like you in this step?"). Ollama turns the model's call text into arguments with its own parser, and a
// part it cannot read is left out without a word: that day Qwen3.6's Writes came with only "path" and its Edits
// without "old_text". Its raw mode (/api/generate with raw: true) skips that parser, and with it the special
// tokens the parser keeps (<think>, </think>, <tool_call>, </tool_call>), so a raw reply cannot be split into
// thinking and answer. What raw mode can do is the call alone: the prompt ends in the step's own thinking,
// closed here, and the call's opening, and the model writes the rest of the call in plain text
// (<parameter=…> is not a special token). client.mjs rawQwenCall sends it; agent-step.mjs rereadCall uses it.
//
// renderQwen35 is Ollama's "qwen3.5" renderer (model/renderers/qwen35.go at v0.32.12), the one this model's
// Modelfile names, so the prompt is the same text Ollama built for the step and the service can reuse what it
// has already read. Its tools are written as Go writes them (goTool: Ollama's field order, a map's keys sorted,
// <, > and & escaped), with a space after each : and , outside strings (marshalWithSpaces).

const IM_START = '<|im_start|>';
const IM_END = '<|im_end|>';

const TOOL_POSTAMBLE = `
</tools>

If you choose to call a function ONLY reply in the following format with NO suffix:

<tool_call>
<function=example_function_name>
<parameter=example_parameter_1>
value_1
</parameter>
<parameter=example_parameter_2>
This is the value for the second parameter
that can span
multiple lines
</parameter>
</function>
</tool_call>

<IMPORTANT>
Reminder:
- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags
- Required parameters MUST be specified
- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after
- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls
</IMPORTANT>`;

// Which models: an Ollama service's Qwen 3.5 family (Qwen3.6 35B-A3B reports qwen35moe), or the name.
export const qwenRawFits = (ep) => Boolean(ep?.ollama) && (/^qwen35/i.test(String(ep.family ?? '')) || /^qwen3\.[5-9]/i.test(String(ep.model ?? '')));

// ---- Go's JSON, as Ollama writes a tool ----

// A value Ollama holds as Go's `any` (a schema's items, $defs): a map's keys come out sorted.
function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
}
function goProp(p = {}) {
  const o = {};
  if (Array.isArray(p.anyOf) && p.anyOf.length) o.anyOf = p.anyOf.map(goProp);
  const type = Array.isArray(p.type) ? p.type : p.type != null ? [p.type] : [];
  if (type.length) o.type = type.length === 1 ? type[0] : type;
  if (p.items != null) o.items = sorted(p.items);
  if (p.description) o.description = p.description;
  if (Array.isArray(p.enum) && p.enum.length) o.enum = p.enum;
  if (p.properties && typeof p.properties === 'object') o.properties = goProps(p.properties);
  if (Array.isArray(p.required) && p.required.length) o.required = p.required;
  return o;
}
const goProps = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, goProp(v ?? {})]));
function goTool(t = {}) {
  const f = t.function ?? {};
  const p = f.parameters ?? {};
  const params = { type: p.type ?? '' };
  if (p.$defs != null) params.$defs = sorted(p.$defs);
  if (p.items != null) params.items = sorted(p.items);
  if (Array.isArray(p.required) && p.required.length) params.required = p.required;
  params.properties = p.properties && typeof p.properties === 'object' ? goProps(p.properties) : null;
  const fn = { name: f.name ?? '' };
  if (f.description) fn.description = f.description;
  fn.parameters = params;
  return { type: t.type ?? 'function', ...(t.items != null ? { items: sorted(t.items) } : {}), function: fn };
}
// Go escapes these in a string by default; they only ever stand inside strings in JSON.
const goEscape = (json) => json.replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
// A space after each : and , that is not inside a string (marshalWithSpaces).
function withSpaces(json) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const c of json) {
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; } else if (c === ':' || c === ',') out += `${c} `;
    else out += c;
  }
  return out;
}
const toolLine = (t) => withSpaces(goEscape(JSON.stringify(goTool(t))));

// An argument as the prompt shows it (formatToolCallArgument): text as it is, a list or object as Go's JSON.
function formatArg(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return goEscape(JSON.stringify(sorted(v)));
  return String(v);
}

// ---- the prompt ----

const isToolResponse = (c) => c.startsWith('<tool_response>') && c.endsWith('</tool_response>');

// The thinking an assistant message shows: its own, else what its text holds before </think>.
function splitReasoning(content, thinking, block) {
  if (block && thinking) return [thinking.trim(), content];
  const at = content.indexOf('</think>');
  if (at === -1) return ['', content];
  const before = content.slice(0, at);
  const open = before.lastIndexOf('<think>');
  return [(open === -1 ? before : before.slice(open + '<think>'.length)).trim(), content.slice(at + '</think>'.length).replace(/^\n+/, '')];
}

// messages: as ollamaMessages (images.mjs) gives them. thinking: whether the request thinks (Ollama's think
// value; none counts as yes). Ends after the last message: the caller writes the assistant's opening.
export function renderQwen35(messages, tools = [], { thinking = true } = {}) {
  let s = '';
  const system = messages[0]?.role === 'system' ? String(messages[0].content ?? '').trim() : null;
  if (tools.length) {
    s += `${IM_START}system\n# Tools\n\nYou have access to the following functions:\n\n<tools>`;
    for (const t of tools) s += `\n${toolLine(t)}`;
    s += TOOL_POSTAMBLE;
    if (system) s += `\n\n${system}`;
    s += `${IM_END}\n`;
  } else if (system !== null) s += `${IM_START}system\n${system}${IM_END}\n`;
  // The last message the user wrote (not a tool's result): thinking shows only for the replies after it.
  let lastQuery = messages.length - 1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    if (!isToolResponse(String(messages[i].content ?? '').trim())) { lastQuery = i; break; }
  }
  messages.forEach((m, i) => {
    let content = String(m.content ?? '').trim();
    const last = i === messages.length - 1;
    if (m.role === 'user' || (m.role === 'system' && i !== 0)) s += `${IM_START}${m.role}\n${content}${IM_END}\n`;
    else if (m.role === 'assistant') {
      const block = thinking && i > lastQuery;
      const [reasoning, rest] = splitReasoning(content, m.thinking ?? '', block);
      content = rest;
      s += block ? `${IM_START}assistant\n<think>\n${reasoning}\n</think>\n\n${content}` : `${IM_START}assistant\n${content}`;
      (m.tool_calls ?? []).forEach((tc, j) => {
        if (j > 0) s += '\n';
        else if (content.trim()) s += '\n\n';
        s += `<tool_call>\n<function=${tc.function?.name}>\n`;
        for (const [k, v] of Object.entries(tc.function?.arguments ?? {})) s += `<parameter=${k}>\n${formatArg(v)}\n</parameter>\n`;
        s += '</function>\n</tool_call>';
      });
      if (!last) s += `${IM_END}\n`;
    } else if (m.role === 'tool') {
      if (i === 0 || messages[i - 1].role !== 'tool') s += `${IM_START}user`;
      s += `\n<tool_response>\n${content}\n</tool_response>`;
      if (last || messages[i + 1].role !== 'tool') s += `${IM_END}\n`;
    }
  });
  return s;
}

// The assistant's opening for a call asked for again: its thinking, closed, the words it wrote before the
// call, and the call's opening with its tool's name, so what comes is that call's parameters.
export function callOpening({ thinking, reasoning = '', before = '', name }) {
  const think = thinking ? `<think>\n${String(reasoning).trim()}\n</think>\n\n` : '<think>\n\n</think>\n\n';
  const said = String(before).trim();
  return `${IM_START}assistant\n${think}${said ? `${said}\n\n` : ''}<tool_call>\n<function=${name}>\n`;
}

// ---- reading a call ----

// A value as its parameter's type wants it (Ollama's parseValue): one newline off each end, then a number,
// true/false or JSON where the schema says so, else the text.
function typed(raw, type) {
  const v = raw.replace(/^\n/, '').replace(/\n$/, '');
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (v === 'null' && types.length && !types.includes('string')) return null;
  for (const t of types) {
    if (t === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
    if ((t === 'integer' || t === 'number') && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
    if (t === 'array' || t === 'object') { try { const j = JSON.parse(v); if (t === 'array' ? Array.isArray(j) : j && typeof j === 'object') return j; } catch { /* left as text */ } }
  }
  return v;
}

// The parameters of one call, from the text after <function=…> (the rest of a call the model writes again).
// More forgiving than Ollama's: a parameter left open ends at the next one or at the end; <parameter
// name="x"> counts; a call written as one JSON object is read as that. Returns {} when nothing is there.
export function readCallText(text, def) {
  const body = String(text ?? '').split(/<\/function>/)[0];
  const props = def?.function?.parameters?.properties ?? def?.parameters?.properties ?? {};
  const json = body.trim();
  if (json.startsWith('{')) { try { const j = JSON.parse(json); if (j && typeof j === 'object') return j.arguments && typeof j.arguments === 'object' ? j.arguments : j; } catch { /* not JSON */ } }
  const marks = [...body.matchAll(/<parameter(?:=([^>\n]+)|\s+name="([^"]+)")>/g)];
  const args = {};
  marks.forEach((m, i) => {
    const name = (m[1] ?? m[2]).trim();
    const from = m.index + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : body.length;
    let raw = body.slice(from, to);
    const close = raw.indexOf('</parameter>');
    if (close !== -1) raw = raw.slice(0, close);
    else raw = raw.replace(/\s+$/, '\n');
    args[name] = typed(raw, props[name]?.type);
  });
  return args;
}
