// What the end-to-end app tests share (app.test.mjs, app-*.test.mjs): a
// throwaway copy of the demo project with its own home folder, and the keys
// that quit.
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const T = 60_000;
export function setup() {
  const base = mkdtempSync(join(tmpdir(), 'agentic-e2e-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  seedTrust(base, cwd);
  // The model loads as the window opens, as it did before /start (30 Sep 2026): these tests are
  // about other things. app-model-start.test.mjs sets it off to test /start and /stop.
  return { base, cwd, env: { AGENTIC_HOME: join(base, 'home'), AGENTIC_MODEL_AT_START: 'on' } };
}
// The folder is pre-trusted, so tests land straight on the welcome
// (the safety check itself has its own tests, in app-start.test.mjs).
export function seedTrust(base, cwd) {
  mkdirSync(join(base, 'home'), { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
}
export const quit = [{ sleep: 300 }, { key: 'ctrlC' }, { sleep: 200 }, { key: 'ctrlC' }];
// With text left in the prompt the first ctrl+c only clears it: one more, or
// the app never quits and the run waits 8 s to be stopped.
export const quitTyped = [...quit, { sleep: 200 }, { key: 'ctrlC' }];
