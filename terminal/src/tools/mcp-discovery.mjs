// Where a sign-in server keeps its details (19 Nov 2026, hearth's Code Factory would not sign in: "Dynamic Client
// Registration rejected (HTTP 405)"). The official client looks for an issuer with a path, such as
// https://employee.hearth.monster/mcp/oauth, where RFC 8414 puts its details:
//   /.well-known/oauth-authorization-server/mcp/oauth
// Some servers keep them under the issuer's own path instead (hearth does):
//   /mcp/oauth/.well-known/oauth-authorization-server
// The client never asks there, so it fell back to /register at the site's root, which isn't one. discoveryFetch(base)
// is a fetch that, when the RFC address answers 404, asks the issuer's own address and gives that answer if it is
// there; every other request goes through untouched. The client still checks the issuer the details name.
const AS_WELL_KNOWN = '/.well-known/oauth-authorization-server';

const urlOf = (input) => {
  try { return new URL(typeof input === 'string' || input instanceof URL ? input : input.url); } catch { return null; }
};

export function discoveryFetch(base = (...a) => globalThis.fetch(...a)) {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 404) return res;
    const u = urlOf(input);
    if (!u || !u.pathname.startsWith(`${AS_WELL_KNOWN}/`)) return res;
    const path = u.pathname.slice(AS_WELL_KNOWN.length).replace(/\/+$/, '');
    const again = await base(new URL(`${path}${AS_WELL_KNOWN}`, u.origin), init);
    return again.ok ? again : res;
  };
}
