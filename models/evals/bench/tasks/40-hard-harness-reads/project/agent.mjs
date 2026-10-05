// One step of the agent: a tool call the model made, run, and the result it reads next.
import { runTool } from './tools.mjs';

export async function step(call, { cwd }) {
  const out = runTool(call.name, call.args, cwd);
  return { name: call.name, text: out.text, error: Boolean(out.error) };
}
