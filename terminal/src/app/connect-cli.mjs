// `coding connect`: point this terminal at a model on another machine (or a
// service) without opening the app. It is /remote's Connect, typed in a line:
// the address (and the key, if the server has one) are checked the same way
// (testForm), and only when that works are they saved the same way (savePlan,
// the key in the Keychain) with the remote switched on. The installer runs it
// for "terminal only": no model files are downloaded.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { saveKey, removeKey, remoteRisk, remoteLabel, validKey, parseAddress } from '../../../models/index.mjs';
import { saveSettings } from './store.mjs';
import { openForm, startEdit, commitEdit, testForm, withTest, savePlan, toProfile, formWarning, sourceWord } from './remote-form.mjs';

export const CONNECT_HELP = `coding connect [address]: use a model on another machine, with no model downloaded here.
  coding connect                     asks for the address and the API key
  coding connect 192.168.1.40:8080   the address as /remote takes it (http://host:port too)
  --key KEY          the API key (else asked; --key-stdin reads it from a pipe)
  --no-key           the server needs none
  --server openai    the server is OpenAI-compatible (Ollama, LM Studio, vLLM…); else llama.cpp (coding serve)
  --model NAME       the model's name, for an OpenAI-compatible server with several
  --save-anyway      keep it even when the server does not answer now
  Checked first, then saved: the same as /remote → Connect. /remote changes it later.
`;

// What was typed after "coding connect".
export function parseConnectArgs(a) {
  const out = { address: '', key: undefined, server: 'llama', model: '', saveAnyway: false, help: false, bad: [] };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-h' || x === '--help') out.help = true;
    else if (x === '--key') out.key = a[++i] ?? '';
    else if (x === '--key-stdin') out.key = readFileSync(0, 'utf8').trim();
    else if (x === '--no-key') out.key = '';
    else if (x === '--server') out.server = a[++i];
    else if (x === '--model') out.model = a[++i] ?? '';
    else if (x === '--save-anyway') out.saveAnyway = true;
    else if (x.startsWith('-')) out.bad.push(x);
    else if (!out.address) out.address = x;
    else out.bad.push(x);
  }
  if (out.server !== 'llama' && out.server !== 'openai') out.bad.push(`--server ${out.server ?? ''}`.trim());
  return out;
}

// A line typed at the terminal (the hidden one for a key), or null with no terminal.
export function terminalAsker() {
  if (!process.stdin.isTTY) return null;
  const line = (q, hidden) => new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (hidden) spawnSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
    rl.question(q, (answer) => {
      if (hidden) { spawnSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] }); process.stderr.write('\n'); }
      rl.close();
      ok(answer.trim());
    });
  });
  return { line: (q) => line(q, false), secret: (q) => line(q, true) };
}

// One try: the rows filled in, checked. Answers { form, res }.
async function attempt(settings, { address, key, server, model }, check) {
  let form = openForm(settings, { source: 'machine' });
  // A new connect replaces the saved computer's rows (the address is typed over, not added to).
  form = { ...form, profiles: { ...form.profiles, machine: { ...form.profiles.machine, address: '', port: null, connect: 'http', kind: 'llama', model: '', context: 0 } } };
  form = commitEdit(startEdit(form, 'address', address));
  form = { ...form, keys: { ...form.keys, machine: key || '' } };
  const set = (patch) => { form = { ...form, profiles: { ...form.profiles, machine: { ...form.profiles.machine, ...patch } } }; };
  if (server === 'openai') set({ kind: 'openai', ...(parseAddress(address)?.scheme ? {} : { connect: 'https' }) });
  if (model) set({ model });
  let res = await check(form);
  // Not a llama.cpp server: an OpenAI-compatible one is tried before giving up.
  if (!res.ok && server === 'llama' && res.steps.some((s) => /is it a llama\.cpp server/.test(s.text))) {
    const other = { ...form, profiles: { ...form.profiles, machine: { ...form.profiles.machine, kind: 'openai' } } };
    const again = await check(other);
    if (again.ok || again.models?.length > 1) { form = other; res = again; }
  }
  return { form: res.ok ? withTest(form, res, 'go') : form, res };
}

// Runs `coding connect`; answers the exit code. io: { settings, ask, out, err, check }.
export async function connectCli(argv, { settings, ask = terminalAsker(), out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t), check = testForm } = {}) {
  const o = parseConnectArgs(argv);
  if (o.help) { out(CONNECT_HELP); return 0; }
  if (o.bad.length) { err(`coding connect: I do not know "${o.bad.join(' ')}".\n${CONNECT_HELP}`); return 2; }
  let { address, key, model, server } = o;
  for (;;) {
    if (!address) {
      if (!ask) { err('coding connect: give the address (coding connect 192.168.1.40:8080), or run it in a terminal to be asked.\n'); return 2; }
      address = await ask.line('  Address of the model (an IP or name, with :port, or http(s)://…): ');
      if (!address) { err('coding connect: nothing typed; nothing saved.\n'); return 2; }
    }
    if (key === undefined) key = ask ? await ask.secret('  API key (enter if the server needs none): ') : '';
    if (key && !validKey(key)) { err('coding connect: the API key has a space or a line break in it.\n'); return 2; }
    let { form, res } = await attempt(settings, { address, key, server, model }, check);
    // An OpenAI-compatible server (Ollama, LM Studio…) with several models, none named: pick one.
    if (!res.ok && !model && res.models?.length > 1) {
      if (!ask) { err(`\n  It has ${res.models.length} models: ${res.models.slice(0, 8).join(', ')}${res.models.length > 8 ? '…' : ''}\n  Name one: coding connect ${address} --model NAME\n`); return 1; }
      err(`\n  ${address} has ${res.models.length} models:\n${res.models.map((m, i) => `    ${String(i + 1).padStart(2)}. ${m}`).join('\n')}\n`);
      const pick = await ask.line('  Which one? (number or name): ');
      model = /^\d+$/.test(pick) ? res.models[Number(pick) - 1] ?? '' : pick;
      if (!model) { err('coding connect: nothing picked; nothing saved.\n'); return 2; }
      server = 'openai';
      ({ form, res } = await attempt(settings, { address, key, server, model }, check));
    }
    const warn = formWarning(form);
    err(`\n  ${remoteLabel(toProfile(form))}\n`);
    for (const s of res.steps) err(`    ${s.ok ? '✓' : '✗'} ${s.text}\n`);
    if (warn?.tone === 'error') { err(`  ${warn.text}\n`); return 1; }
    if (res.ok || o.saveAnyway) {
      const risk = remoteRisk(toProfile(form));
      if (risk) err(`  ! ${risk}.\n`);
      keepPlan(savePlan(form, settings, { connect: true }), settings);
      err(`  ✓ Saved: Agentic Coder uses ${sourceWord('machine')} ${remoteLabel(toProfile(form))}. /remote changes it later.\n`);
      return 0;
    }
    if (!ask) { err('  Nothing saved. --save-anyway keeps it when the server is off for now.\n'); return 1; }
    const again = await ask.line('  Try another address or key? [Y/n] ');
    if (/^n/i.test(again)) {
      const keepIt = await ask.line('  Save it anyway (fix it later with /remote)? [y/N] ');
      if (!/^y/i.test(keepIt)) { err('  Nothing saved.\n'); return 1; }
      keepPlan(savePlan(form, settings, { connect: true }), settings);
      err(`  ✓ Saved, not reached yet. /remote shows it.\n`);
      return 0;
    }
    address = '';
    key = undefined;
    model = o.model;
    server = o.server;
  }
}

// The keys first (nothing is written when one cannot be kept), then settings.json: as the app's Connect does.
function keepPlan(plan, settings) {
  for (const k of plan.keys) { if (k.op === 'save') saveKey(k.key, k.id, `Agentic Coder · ${sourceWord(k.source)}`); else removeKey(k.id); }
  const next = saveSettings({ remotes: plan.remotes, ...(plan.remote ? { remote: plan.remote } : {}) });
  settings.remotes = next.remotes;
  if (plan.remote) settings.remote = next.remote;
}
