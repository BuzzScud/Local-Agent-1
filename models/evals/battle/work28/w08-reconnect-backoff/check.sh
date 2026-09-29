#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum reconnect.test.mjs | cut -c1-12)" = "31244a63403b" ] || { echo "reconnect.test.mjs was changed (fix the code, not the tests)"; exit 1; }
node -e "
import('./reconnect.mjs').then(({ Backoff }) => {
  const b = new Backoff({ base: 500, max: 4000 });
  const w = Array.from({ length: 6 }, () => b.next());
  if (JSON.stringify(w) !== '[500,1000,2000,4000,4000,4000]') { console.log('base 500, max 4000 gives ' + JSON.stringify(w)); process.exit(1); }
  const c = new Backoff();
  for (let i = 0; i < 2000; i++) { const ms = c.next(); if (!(ms > 0 && ms <= 30000)) { console.log('wait ' + i + ' is ' + ms); process.exit(1); } }
  c.connected(); c.connected();
  if (c.next() !== 1000 || c.next() !== 2000) { console.log('after connected() it should go 1000, 2000'); process.exit(1); }
})" || exit 1
