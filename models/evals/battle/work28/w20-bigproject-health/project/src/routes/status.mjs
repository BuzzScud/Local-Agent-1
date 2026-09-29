import { BUILD } from '../config.mjs';
import { startedAt } from '../lib/time.mjs';

// GET /api/health: is the server up, which build, and for how long.
export function health() {
  return { status: 200, body: { ok: true, build: BUILD, uptime: Math.round((Date.now() - startedAt) / 1000) } };
}
