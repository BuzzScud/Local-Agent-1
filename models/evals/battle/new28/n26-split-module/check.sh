#!/bin/zsh
[ ! -e utils.mjs ] || { echo 'utils.mjs is still there'; exit 1; }
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
node -e "Promise.all([import('./strings.mjs'), import('./numbers.mjs')]).then(([s, n]) => { if (typeof s.slugify !== 'function' || typeof s.titleCase !== 'function' || typeof n.clamp !== 'function' || typeof n.roundTo !== 'function') { console.log('a helper is missing from strings.mjs or numbers.mjs'); process.exit(1); } if (s.clamp || n.slugify) { console.log('a helper is in the wrong file'); process.exit(1); } })" 2>&1 || exit 1
[ "$(node app.mjs)" = 'hello-world 10' ] || { echo "app.mjs prints: $(node app.mjs 2>&1 | head -1)"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo 'a test was removed'; exit 1; }
