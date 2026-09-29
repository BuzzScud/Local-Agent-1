#!/bin/zsh
f=Desktop/fib.html
[ -f "$f" ] || { echo "no Desktop/fib.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
for p in '23\.6|0?\.236' '38\.2|0?\.382' '61\.8|0?\.618' '78\.6|0?\.786'; do grep -Eq "$p" "$f" || { echo "a level is missing ($p)"; exit 1; }; done
grep -Eqi '\bup\b' "$f" && grep -Eqi '\bdown\b' "$f" || { echo "no up or down switch"; exit 1; }
[ "$(grep -o '<input' "$f" | wc -l | tr -d ' ')" -ge 2 ] || { echo "no boxes for the high and the low"; exit 1; }
grep -Eqi "addEventListener|oninput|onchange|onkeyup" "$f" || { echo "nothing updates as I type"; exit 1; }
