#!/bin/zsh
# pass = tests pass, there are at least 3 tests, and --json prints valid JSON with 3 rows
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 3 ] || { echo "no new test"; exit 1; }
node export.mjs --json trades.json | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); if(r.length!==3) process.exit(1)' || { echo "--json output wrong"; exit 1; }
node export.mjs trades.json | head -1 | grep -q '^symbol,side,qty,price$' || { echo "CSV broke"; exit 1; }
