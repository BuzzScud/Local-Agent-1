#!/bin/zsh
f=Desktop/sessions.html
[ -f "$f" ] || { echo "no Desktop/sessions.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
for z in Asia/Tokyo Europe/London America/New_York; do grep -q "$z" "$f" || { echo "it does not use the $z time zone"; exit 1; }; done
grep -Eqi 'setInterval|setTimeout|requestAnimationFrame' "$f" || { echo "nothing updates it every second"; exit 1; }
grep -Eqi '\bopen\b' "$f" && grep -Eqi 'closed' "$f" || { echo "it does not say open or closed"; exit 1; }
grep -Eqi 'prefers-color-scheme|color-scheme' "$f" || { echo "it does not follow light or dark mode"; exit 1; }
