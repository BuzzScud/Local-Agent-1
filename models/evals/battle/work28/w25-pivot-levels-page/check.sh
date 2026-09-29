#!/bin/zsh
f=Desktop/pivots.html
[ -f "$f" ] || { echo "no Desktop/pivots.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
for l in H4 H3 H2 H1 L1 L2 L3 L4; do grep -q "$l" "$f" || { echo "no $l level"; exit 1; }; done
grep -q '1\.1' "$f" || { echo "the Camarilla factor 1.1 is not used"; exit 1; }
[ "$(grep -o '<input' "$f" | wc -l | tr -d ' ')" -ge 3 ] || { echo "fewer than 3 boxes (high, low, close)"; exit 1; }
grep -Eq 'toFixed\(2\)|maximumFractionDigits|minimumFractionDigits' "$f" || { echo "the levels are not shown with 2 decimals"; exit 1; }
grep -Eqi "addEventListener|oninput|onchange|onkeyup" "$f" || { echo "nothing updates as I type"; exit 1; }
