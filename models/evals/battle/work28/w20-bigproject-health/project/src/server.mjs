import { createServer } from 'node:http';
import { route } from './routes/index.mjs';
import { log } from './lib/log.mjs';
import { PORT } from './config.mjs';

createServer(async (req, res) => {
  const { status, body } = await route(req.method, new URL(req.url, 'http://x').pathname, req);
  log(`${req.method} ${req.url} ${status}`);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}).listen(PORT);
