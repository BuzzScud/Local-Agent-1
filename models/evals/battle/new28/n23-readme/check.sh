#!/bin/zsh
[ -f README.md ] || { echo 'no README.md'; exit 1; }
[ $(grep -c . README.md) -ge 12 ] || { echo 'README.md is too short (fewer than 12 lines)'; exit 1; }
grep -q 'wordfreq' README.md || { echo 'it does not name wordfreq'; exit 1; }
grep -q -- '--top' README.md || { echo 'it does not explain --top'; exit 1; }
grep -q -- '--min-length' README.md || { echo 'it does not explain --min-length'; exit 1; }
grep -q '```' README.md || { echo 'no example command in a code block'; exit 1; }
grep -Eqi 'install' README.md || { echo 'it does not say how to install'; exit 1; }
