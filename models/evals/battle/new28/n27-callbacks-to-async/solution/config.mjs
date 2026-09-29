import { readFile } from 'node:fs/promises';

// Reads config.json.
export async function readConfig() {
  return JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
}
