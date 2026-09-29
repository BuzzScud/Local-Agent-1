// A tiny web app: routes by path.
export function makeApp() {
  const routes = new Map();
  return { get: (p, f) => routes.set(p, f), listen: (port) => console.log(`listening on ${port}`) };
}
