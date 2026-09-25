#!/bin/zsh
[ -s NOTES.md ] || { echo "no NOTES.md"; exit 1; }
[ "$(grep -Ec '^\s*([-*]|[0-9]+\.) ' NOTES.md)" -ge 3 ] || { echo "fewer than 3 bullet points"; exit 1; }
grep -Eq '/health|/orders' NOTES.md || { echo "notes do not mention the routes"; exit 1; }
[ -z "$(find . -newer ../started -type f ! -name NOTES.md)" ] || { echo "other files were changed"; exit 1; }
