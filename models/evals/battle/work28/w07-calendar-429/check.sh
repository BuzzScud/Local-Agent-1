#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo "no new test"; exit 1; }
node -e "
import('./calendar.mjs').then(async ({ loadWeek }) => {
  const reply = (status, body = null, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body });
  const run = async (answers) => { const slept = []; let calls = 0; let out, err = null;
    try { out = await loadWeek('https://example.test/w', { fetchImpl: async () => answers[calls++], sleep: async (ms) => { slept.push(ms); } }); } catch (e) { err = e; }
    return { out, err, slept, calls }; };
  const fail = (why) => { console.log(why); process.exit(1); };
  let r = await run([reply(429, null, { 'retry-after': '2' }), reply(429), reply(200, ['ok'])]);
  if (r.err || JSON.stringify(r.out) !== '[\"ok\"]') fail('two 429s then 200 should load: ' + (r.err ? r.err.message : JSON.stringify(r.out)));
  if (JSON.stringify(r.slept) !== '[2000,5000]') fail('it should wait 2000 then 5000 ms, waited ' + JSON.stringify(r.slept));
  r = await run([reply(429), reply(429), reply(429), reply(200, ['late'])]);
  if (!r.err || r.calls !== 3) fail('three 429s should throw after 3 tries (tried ' + r.calls + ')');
  r = await run([reply(500), reply(200, ['x'])]);
  if (!r.err || r.calls !== 1 || r.slept.length) fail('a 500 should throw at once without waiting');
})" || exit 1
