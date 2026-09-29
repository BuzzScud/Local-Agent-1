#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 2 ] || { echo 'no new test'; exit 1; }
[ "$(node cli.mjs --csv)" = "$(printf 'name,score\nann,3\nbo,5')" ] || { echo "--csv prints: $(node cli.mjs --csv | head -3 | tr '\n' '|')"; exit 1; }
[ "$(node cli.mjs)" = "$(printf 'ann  3\nbo  5')" ] || { echo 'the plain table changed'; exit 1; }
