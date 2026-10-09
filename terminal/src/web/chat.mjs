// The plain chat (Agentic Coder Web): one of your AI's models with the calculator as its tools,
// through the gateway (so it waits its turn, moves to the stand-in, and counts). The AI-server copy
// has only this; on the Mac copy a message starts an Agentic Coder run instead (runner.mjs), and the
// API's POST /api/v1/chat is this on either. Events, one at a time to `say`:
//   { t: 'status', text } · { t: 'text', delta } · { t: 'tool', name, args, out? } · { t: 'note', text }
//   { t: 'stats', tokens, secs } · { t: 'done', secs, text } · { t: 'error', text }
import { CALC_TOOLS, runCalcTool } from '../tools/calculator.mjs';

const SYSTEM = "You are Agentic Coder's chat. For any arithmetic or formula, call the calculate tool instead of working it out yourself, then answer in plain words. Use the formulas tool to look up the user's saved formulas.";
const ROUNDS = 6;
// Thinking: off for a short chat on the models that think by default; gpt-oss takes a level.
const thinkFor = (model) => (/gpt-?oss/i.test(model) ? 'low' : /qwen3|deepseek-r1|laguna/i.test(model) ? false : undefined);

export async function chat({ gateway, who, model, messages, calc, say, signal }) {
  const t0 = Date.now();
  const history = [{ role: 'system', content: SYSTEM }, ...messages.slice(-30)];
  let tools = CALC_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  let all = '';
  const tick = setInterval(() => say({ t: 'status', text: `Waiting for your AI · ${Math.round((Date.now() - t0) / 1000)} s (it answers one request at a time per model)` }), 3000);
  const runWho = { ...who, run: { ...(who.run ?? {}), note: (text) => say({ t: 'note', text }) } };
  try {
    say({ t: 'status', text: `Asking ${model}…` });
    for (let round = 0; round < ROUNDS; round++) {
      const think = thinkFor(model);
      const res = await gateway.handle(runWho, { method: 'POST', path: '/api/chat', signal, body: { model, messages: history, stream: true, ...(tools ? { tools } : {}), ...(think !== undefined ? { think } : {}) } });
      if (!res.ok) {
        const text = await res.text();
        if (tools && /does not support tools/i.test(text)) { tools = null; say({ t: 'note', text: `${model} cannot use tools, so it answers without the calculator.` }); round--; continue; }
        let why = text; try { why = JSON.parse(text).error ?? text; } catch { /* as it came */ }
        throw new Error(String(why).slice(0, 300));
      }
      const spilled = res.headers.get('x-acw-spilled-to');
      const calls = [];
      let said = '';
      let buf = '';
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.error) throw new Error(m.error);
          clearInterval(tick);
          if (m.message?.content) { said += m.message.content; say({ t: 'text', delta: m.message.content }); }
          if (m.message?.tool_calls?.length) calls.push(...m.message.tool_calls);
          if (m.done) say({ t: 'stats', tokens: m.eval_count ?? 0, secs: Math.round((m.total_duration ?? 0) / 1e7) / 100, ...(spilled ? { on: spilled } : {}) });
        }
      }
      all += said;
      if (!calls.length) break;
      history.push({ role: 'assistant', content: said, tool_calls: calls });
      for (const c of calls) {
        const name = c.function?.name;
        let args = c.function?.arguments ?? {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { expression: args }; } }
        say({ t: 'tool', name, args });
        let out;
        try { out = CALC_TOOLS.some((t) => t.name === name) ? await runCalcTool(name, args, { ...calc(), signal }) : { ok: false, error: `no tool called ${name}` }; } catch (e) { out = { ok: false, error: e.message }; }
        say({ t: 'tool', name, args, out });
        history.push({ role: 'tool', content: JSON.stringify(out), tool_name: name });
      }
    }
    say({ t: 'done', secs: Math.round((Date.now() - t0) / 100) / 10, text: all });
    return { ok: true, text: all };
  } catch (e) {
    if (signal?.aborted) { say({ t: 'error', text: 'You stopped it.' }); return { ok: false, stopped: true, text: all }; }
    say({ t: 'error', text: e.message });
    return { ok: false, error: e.message, text: all };
  } finally { clearInterval(tick); }
}

// The size of what a request asks a model to read, in tokens (3.6 characters a token, as agent.mjs counts).
export const tokensOf = (text) => Math.ceil(String(text ?? '').length / 3.6);
