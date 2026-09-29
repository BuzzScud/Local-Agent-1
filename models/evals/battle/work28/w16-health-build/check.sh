#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 3 ] || { echo "no new test"; exit 1; }
grep -q 'BUILD_SHA' server.test.mjs || { echo "no test sets BUILD_SHA"; exit 1; }
node -e "
import('./server.mjs').then(({ handle, startedAt }) => {
  const a = handle('GET', '/api/health', { BUILD_SHA: '4f9e1b2d8a7c55' }, startedAt + 61000).body;
  if (a.build !== '4f9e1b2' || a.ok !== true || a.uptime !== 61) { console.log('with BUILD_SHA: ' + JSON.stringify(a)); process.exit(1); }
  const b = handle('GET', '/api/health', {}, startedAt).body;
  if (b.build !== 'dev') { console.log('without BUILD_SHA: ' + JSON.stringify(b)); process.exit(1); }
  if (handle('GET', '/x', {}).status !== 404) { console.log('404 broke'); process.exit(1); }
})" || exit 1
