import { appendLine } from './files.mjs';
import { LOG_NAME } from './config.mjs';

// Adds one line to the activity log.
export function record(event) {
  appendLine(LOG_NAME, `${new Date().toISOString()} ${event}`);
}
