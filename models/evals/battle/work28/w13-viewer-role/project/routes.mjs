import { can } from './roles.mjs';

// Each route and the action it needs.
export const ROUTES = {
  'GET /api/bars': 'read',
  'POST /api/bars': 'write',
  'POST /api/invites': 'invite',
  'GET /api/users': 'admin',
};

export function allowed(user, route) {
  const need = ROUTES[route];
  return need ? can(user, need) : false;
}
