import { readFileSync } from 'node:fs';

// The settings, from settings.json at the top of the project.
export function loadSettings() {
  return JSON.parse(readFileSync(new URL('../../settings.json', import.meta.url), 'utf8'));
}
