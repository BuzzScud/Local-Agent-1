// Try-outs (2 Oct 2026, the user's pick: "the first time I pick it"): a model on a
// service gets one short real task the first time it is picked (read a file, fix
// one line, run a command), and the result is kept here, so the /remote list and
// /model show ✔ or ✗ and its speed from then on. A service lists "tools" for a
// model whose chat template can take them; only a try-out says it really works
// with the agent. Kept in <home>/tryouts.json by service address, then model.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HOME } from '../../../models/index.mjs';

const FILE = () => join(HOME, 'tryouts.json');
const readAll = () => { try { return JSON.parse(readFileSync(FILE(), 'utf8')); } catch { return {}; } };
// The service's address without its scheme or a trailing slash: one record per service.
export const serviceKey = (address) => String(address ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();

// { [model]: { ok, tokS, steps: [{ ok, text }], at } } for one service.
export const readTryouts = (address) => readAll()[serviceKey(address)] ?? {};
export function saveTryout(address, model, rec) {
  const all = readAll();
  const k = serviceKey(address);
  all[k] = { ...(all[k] ?? {}), [model]: { ...rec, at: rec.at ?? new Date().toISOString() } };
  mkdirSync(dirname(FILE()), { recursive: true });
  writeFileSync(FILE(), JSON.stringify(all, null, 1));
  return all[k][model];
}
// The word the lists show: "✔ 38 tok/s", "✗ wrote calls as text", or "not tried".
export const triedWord = (t) => (!t ? 'not tried' : t.ok ? `✔${t.tokS ? ` ${Math.round(t.tokS)} tok/s` : ' works'}` : `✗ ${t.why ?? 'did not pass'}`);
