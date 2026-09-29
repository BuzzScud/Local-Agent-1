#!/bin/zsh
f=Desktop/journal.html
[ -f "$f" ] || { echo "no Desktop/journal.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
grep -q 'localStorage' "$f" || { echo "the trades are not kept in local storage"; exit 1; }
grep -Eqi '\blong\b' "$f" && grep -Eqi '\bshort\b' "$f" || { echo "no long or short choice"; exit 1; }
grep -Eqi 'delete|remove' "$f" || { echo "no Delete button"; exit 1; }
grep -Eqi 'total' "$f" || { echo "no total"; exit 1; }
grep -Eqi 'prefers-color-scheme|color-scheme' "$f" || { echo "it does not follow light or dark mode"; exit 1; }
