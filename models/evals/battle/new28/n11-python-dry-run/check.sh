#!/bin/zsh
D=$(mktemp -d); touch $D/b.txt $D/a.txt $D/keep.md
out=$(python3 rename.py --dry-run $D x_ 2>&1) || { echo "--dry-run failed: $out"; rm -rf $D; exit 1; }
[ "$out" = "$(printf 'a.txt -> x_a.txt\nb.txt -> x_b.txt')" ] || { echo "--dry-run printed: $(echo $out | tr '\n' '|')"; rm -rf $D; exit 1; }
[ -f $D/a.txt ] && [ -f $D/b.txt ] || { echo '--dry-run renamed files'; rm -rf $D; exit 1; }
python3 rename.py $D x_ >/dev/null 2>&1; [ -f $D/x_a.txt ] && [ -f $D/keep.md ] || { echo 'the real rename broke'; rm -rf $D; exit 1; }
rm -rf $D
