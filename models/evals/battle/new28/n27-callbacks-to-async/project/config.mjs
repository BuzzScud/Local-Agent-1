import { readFile } from 'node:fs';

// Reads config.json and calls cb(err, config).
export function readConfig(cb) {
  readFile(new URL('./config.json', import.meta.url), 'utf8', (err, text) => {
    if (err) return cb(err);
    cb(null, JSON.parse(text));
  });
}
