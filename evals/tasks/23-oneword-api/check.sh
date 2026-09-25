#!/bin/zsh
[ -s ../asked.txt ] || { echo "did not ask what 'api' means"; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 3 ] || { echo "no new test"; exit 1; }
node -e "import('./server.mjs').then(({ handle }) => { const r = handle('/health'); if (r.status !== 200 || JSON.stringify(r.body) !== '{\"ok\":true}') { console.log(JSON.stringify(r)); process.exit(1); } })" || { echo "/health wrong"; exit 1; }
