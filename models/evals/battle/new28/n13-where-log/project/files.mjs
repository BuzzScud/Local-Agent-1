import { appendFileSync } from 'node:fs';

export function appendLine(file, line) {
  appendFileSync(file, `${line}\n`);
}
