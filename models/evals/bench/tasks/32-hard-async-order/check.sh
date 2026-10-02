#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 3 ] || { echo "no new test"; exit 1; }
node -e "
import('./fetch-all.mjs').then(async ({ fetchAll }) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (why) => { console.log(why); process.exit(1); };
  let now = 0, most = 0;
  const delays = { a: 60, b: 10, c: 40, d: 5, e: 30, f: 20 };
  const get = async (id) => { now++; most = Math.max(most, now); await wait(delays[id]); now--; return id.toUpperCase(); };
  const t0 = Date.now();
  const got = await fetchAll(['a', 'b', 'c', 'd', 'e', 'f'], get);
  const ms = Date.now() - t0;
  if (JSON.stringify(got) !== JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F'])) fail('wrong order: ' + JSON.stringify(got));
  if (most > 2) fail(most + ' requests at once');
  if (most < 2) fail('one at a time: never 2 at once');
  if (ms > 150) fail('too slow for 2 at a time: ' + ms + ' ms (one by one takes 165)');
  if (JSON.stringify(await fetchAll([], get)) !== '[]') fail('no ids should give []');
  let threw = false;
  try { await fetchAll(['a', 'x'], async (id) => { if (id === 'x') throw new Error('down'); return id; }); } catch (e) { threw = /down/.test(e.message); }
  if (!threw) fail('a failed request did not reject');
})" || exit 1
