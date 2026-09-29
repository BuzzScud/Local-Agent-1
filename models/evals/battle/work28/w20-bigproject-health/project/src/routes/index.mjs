import * as status from './status.mjs';
import * as bars from './bars.mjs';
import * as users from './users.mjs';
import * as invites from './invites.mjs';
import { signedIn } from '../lib/auth.mjs';

// Every route: method + path -> handler. Handlers return { status, body }.
const TABLE = {
  'GET /api/health': status.health,
  'GET /api/bars': bars.list,
  'POST /api/bars': bars.save,
  'GET /api/users': users.list,
  'POST /api/invites': invites.create,
};

export async function route(method, path, req) {
  const h = TABLE[`${method} ${path}`];
  if (!h) return { status: 404, body: { error: 'not found' } };
  if (h !== status.health && !signedIn(req)) return { status: 401, body: { error: 'sign in first' } };
  return h(req);
}
