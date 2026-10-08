// How long a profile's requests go straight to its backup after a spill (client.mjs spilling,
// app/profile-router.mjs): a server busy for one request is mostly busy for the next ones too.
export const COOL_MS = 2 * 60_000;
