#!/bin/zsh
# A page saved to the Desktop of the (throwaway) home folder
f=Desktop/position-size.html
[ -f "$f" ] || { echo "no Desktop/position-size.html"; exit 1; }
grep -Eqi '<meta[^>]+charset=["'"'"']?utf-8' "$f" || { echo 'no <meta charset="utf-8">'; exit 1; }
for c in NQ MNQ ES MES; do grep -q "$c" "$f" || { echo "no $c to pick"; exit 1; }; done
grep -Eq '(^|[^0-9])20([^0-9]|$)' "$f" && grep -Eq '(^|[^0-9])50([^0-9]|$)' "$f" || { echo "the point values (20, 2, 50, 5) are missing"; exit 1; }
[ "$(grep -o '<input' "$f" | wc -l | tr -d ' ')" -ge 3 ] || { echo "fewer than 3 boxes to type in"; exit 1; }
grep -Eqi 'contracts' "$f" || { echo "it does not show the contracts"; exit 1; }
grep -Eq 'Math\.floor|Math\.trunc|\| *0|~~' "$f" || { echo "the contracts are not rounded down"; exit 1; }
grep -Eqi "addEventListener|oninput|onchange|onkeyup" "$f" || { echo "nothing updates as I type"; exit 1; }
