import { createServer } from 'node:http';

const orders = [];

export const server = createServer((req, res) => {
  if (req.url === '/health') return res.end('ok');
  if (req.url === '/orders' && req.method === 'GET') return res.end(JSON.stringify(orders));
  if (req.url === '/orders' && req.method === 'POST') { orders.push({ id: orders.length + 1 }); res.statusCode = 201; return res.end(); }
  res.statusCode = 404;
  res.end();
});
