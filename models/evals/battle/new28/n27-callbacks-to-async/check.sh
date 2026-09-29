#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
node -e "Promise.all([import('./config.mjs'), import('./users.mjs')]).then(async ([c, u]) => { const p = c.readConfig(); if (!(p instanceof Promise)) { console.log('readConfig() does not return a promise'); process.exit(1); } const cfg = await p; if (!cfg.users) { console.log('readConfig() does not give the config'); process.exit(1); } if ((await u.loadUser(2)).name !== 'Bo' || (await u.loadUser(9)) !== null) { console.log('loadUser is wrong'); process.exit(1); } })" 2>&1 || exit 1
! grep -Eq '\bcb\b|callback' config.mjs users.mjs || { echo 'a callback is left in config.mjs or users.mjs'; exit 1; }
[ "$(node main.mjs)" = 'Bo' ] || { echo "main.mjs prints: $(node main.mjs 2>&1 | head -1)"; exit 1; }
