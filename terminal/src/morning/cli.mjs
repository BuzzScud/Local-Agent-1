#!/usr/bin/env bun
// The morning brief's pieces from a shell, for Claude's /repo-morning and for
// checks by hand (`bonsai morning` is the whole run with the model):
//   bun cli.mjs gather [--day auto|today|yesterday|YYYY-MM-DD] [--no-fetch] [--out facts.json]
//   bun cli.mjs picks  --facts facts.json          # what earns a line, in plain words
//   bun cli.mjs render --facts facts.json [--words words.json] [--out page.html] [--no-save]
//   bun cli.mjs render --rebuild                   # the page from the saved days only
//   bun cli.mjs run    [--day …] [--no-fetch]      # the whole run with plain words, no model
import { readFileSync, writeFileSync } from 'node:fs';
import { expand, loadConfig } from './config.mjs';
import { gather } from './gather.mjs';
import { pick } from './sort.mjs';
import { plainWords } from './words.mjs';
import { writeBrief } from './render.mjs';
import { runMorning } from './index.mjs';

const [cmd, ...args] = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const has = (name) => args.includes(name);
const readJson = (p) => JSON.parse(readFileSync(expand(p), 'utf8'));
const config = loadConfig();

if (cmd === 'gather') {
  const facts = await gather({ config, day: opt('--day', 'auto'), fetch: !has('--no-fetch') });
  const json = JSON.stringify(facts, null, 2);
  if (opt('--out')) writeFileSync(expand(opt('--out')), json); else process.stdout.write(`${json}\n`);
} else if (cmd === 'picks') {
  process.stdout.write(`${JSON.stringify(pick(readJson(opt('--facts')), config), null, 2)}\n`);
} else if (cmd === 'render') {
  const facts = has('--rebuild') ? null : readJson(opt('--facts'));
  const words = facts && (opt('--words') ? readJson(opt('--words')) : plainWords(facts, pick(facts, config)));
  const r = writeBrief({ config, facts, words, save: !has('--no-save'), out: expand(opt('--out', config.out)) });
  process.stdout.write(`${JSON.stringify({ out: r.out, saved: r.saved, days: r.days, latest: r.day.key, shape: r.day.shape, commits: r.day.commits })}\n`);
} else if (cmd === 'run') {
  await runMorning({ config, day: opt('--day', 'auto'), fetch: !has('--no-fetch'), onStep: (kind, text) => process.stderr.write(`${kind === 'done' ? '' : '· '}${text}\n`) });
} else {
  process.stderr.write('usage: bun cli.mjs gather|picks|render|run   (see the top of cli.mjs)\n');
  process.exit(2);
}
