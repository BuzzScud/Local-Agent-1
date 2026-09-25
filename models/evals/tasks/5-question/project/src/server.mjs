import { createServer } from 'node:http';
import { config } from './config.mjs';

createServer((req, res) => res.end('ok')).listen(config.port, () => {
  console.log(`${config.appName} on :${config.port}`);
});
