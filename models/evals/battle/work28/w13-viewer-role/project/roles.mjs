// Who may do what on the site: each role lists its actions.
export const ROLES = {
  owner: ['read', 'write', 'invite', 'admin'],
  member: ['read', 'write'],
};

export function can(user, action) {
  return (ROLES[user?.role] ?? []).includes(action);
}
