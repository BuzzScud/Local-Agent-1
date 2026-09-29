import { record } from './audit.mjs';

export function startServer() {
  record('listening');
}
