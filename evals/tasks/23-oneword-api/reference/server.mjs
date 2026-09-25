// A tiny router: handle(url) → { status, body }.
const trades = [{ symbol: 'NQ', qty: 2 }, { symbol: 'ES', qty: 1 }];

export const routes = {
  '/': () => ({ status: 200, body: 'ok' }),
  '/trades': () => ({ status: 200, body: trades }),
  '/health': () => ({ status: 200, body: { ok: true } }),
};

export function handle(url) {
  const route = routes[url];
  return route ? route() : { status: 404, body: 'not found' };
}
