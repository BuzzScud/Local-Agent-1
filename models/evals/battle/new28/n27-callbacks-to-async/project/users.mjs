import { readConfig } from './config.mjs';

// Finds a user by id and calls cb(err, user).
export function loadUser(id, cb) {
  readConfig((err, config) => {
    if (err) return cb(err);
    cb(null, config.users.find((u) => u.id === id) ?? null);
  });
}
