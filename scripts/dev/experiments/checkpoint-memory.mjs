// How much memory the 27B server's prompt reuse takes, and whether tries that
// share a long start (file + test) skip re-reading it. Usage: node cachexp.mjs <label> [extra flags…]
import { spawn, execFileSync } from 'node:child_process';
import { openSync, readFileSync, readdirSync } from 'node:fs';
const R = '/Users/you/Desktop/bonsai-code';
const { MODELS, DEFAULT_MODEL } = await import(`${R}/src/server/models.mjs`);
const { serverArgs } = await import(`${R}/src/server/server.mjs`);
const [label, ...extra] = process.argv.slice(2);
const logf = `./cache-${label}.log`;
const log = openSync(logf, 'w');
const srv = spawn(`${process.env.HOME}/.bonsai-code/bin/llama-server`, [...serverArgs(MODELS[DEFAULT_MODEL], { ctx: Number(process.env.CTX ?? 16384), port: 17652 }), '-lv', '4', ...extra], { stdio: ['ignore', log, log] });
process.on('exit', () => srv.kill());
for (let i = 0; i < 120; i++) { try { if ((await fetch('http://127.0.0.1:17652/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const fp = () => { const t = execFileSync('footprint', ['-p', String(srv.pid)], { encoding: 'utf8' }); return Number(/phys_footprint:\s*([\d.]+)\s*MB/.exec(t)?.[1] ?? /phys_footprint:\s*([\d.]+)\s*GB/.exec(t)?.[1] * 1000) / 1000; };
async function ask(messages) {
  const t0 = Date.now();
  const j = await (await fetch('http://127.0.0.1:17652/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, max_tokens: 1, temperature: 0, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } }) })).json();
  return { prompt_n: j.timings?.prompt_n, secs: (Date.now() - t0) / 1000 };
}
const file = readFileSync(`${R}/src/server/server.mjs`, 'utf8');
const sys = { role: 'system', content: 'You are an expert programmer. Reply with only the requested code.' };
const out = { label, extra: extra.join(' '), loaded: fp() };
const u1 = `The tests fail:\n(digest)\n\n\`\`\`js\n${file}\n\`\`\`\n\nTask: add stopAll(). Reply with the function.`;
out.first = await ask([sys, { role: 'user', content: u1 }]);
out.sameStartNewEnd = await ask([sys, { role: 'user', content: `${u1}\n\nYour previous try was wrong. It was:\n\`\`\`\nfunction x() {}\n\`\`\`\nDo something different.` }]);
out.appended = await ask([sys, { role: 'user', content: u1 }, { role: 'assistant', content: 'function stopAll() {}' }, { role: 'user', content: 'Now add a test.' }]);
out.after3 = fp();
const others = readdirSync(`${R}/src/flows`).filter((f) => f.endsWith('.mjs')).slice(0, 10);
for (const f of others) await ask([sys, { role: 'user', content: `\`\`\`js\n${readFileSync(`${R}/src/flows/${f}`, 'utf8').slice(0, 2500)}\n\`\`\`\nSummarize ${f}.` }]);
out.after13 = fp();
srv.kill();
const lines = readFileSync(logf, 'utf8').split('\n');
out.checkpointLines = lines.filter((l) => /checkpoint/i.test(l)).slice(-4).map((l) => l.slice(0, 220));
out.cacheLines = lines.filter((l) => /prompt cache|cache state|cache_ram|update_slots.*cache/i.test(l)).slice(-4).map((l) => l.slice(0, 220));
console.log(JSON.stringify(out, null, 1));
process.exit(0);
