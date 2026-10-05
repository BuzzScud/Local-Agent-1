// One step of the agent: a tool call the model made, run, and the result it reads next.
import { runTool, plainRead } from './tools.mjs';

export async function step(call, { cwd }) {
  const as = call.name === 'Bash' ? plainRead(call.args?.command, cwd) : null;
  if (as) {
    const out = runTool(as.name, as.args, cwd);
    return { name: as.name, text: `(Run as ${as.name})\n${out.text}`, error: Boolean(out.error) };
  }
  const out = runTool(call.name, call.args, cwd);
  return { name: call.name, text: out.text, error: Boolean(out.error) };
}
