import { readConfig } from './config.mjs';

// Finds a user by id (null when there is none).
export async function loadUser(id) {
  const config = await readConfig();
  return config.users.find((u) => u.id === id) ?? null;
}
