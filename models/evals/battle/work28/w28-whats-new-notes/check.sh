#!/bin/zsh
f=WHATS-NEW.md
[ -s $f ] || { echo "no WHATS-NEW.md"; exit 1; }
# each bullet with the section it is in (N = New, F = Fixed)
b=$(awk 'tolower($0) ~ /^#+ / { s = (tolower($0) ~ /fix/) ? "F" : ((tolower($0) ~ /new/) ? "N" : "O") } /^[[:space:]]*[-*] / { print s ": " $0 }' $f)
[ "$(echo "$b" | grep -c '^N: ')" = 3 ] || { echo "the New section should have 3 bullets (the feat commits), it has $(echo "$b" | grep -c '^N: ')"; exit 1; }
[ "$(echo "$b" | grep -c '^F: ')" = 3 ] || { echo "the Fixed section should have 3 bullets (the fix commits), it has $(echo "$b" | grep -c '^F: ')"; exit 1; }
for w in 'fib' 'trash' 'payoff|spread'; do echo "$b" | grep '^N: ' | grep -Eqi "$w" || { echo "New does not cover: $w"; exit 1; }; done
for w in 'reconnect|feed|drop' 'time ?zone|news' 'invite'; do echo "$b" | grep '^F: ' | grep -Eqi "$w" || { echo "Fixed does not cover: $w"; exit 1; }; done
! grep -Eqi 'chore|docs:|\bvite\b|\bdeps\b|format the code|deploy steps' $f || { echo "it includes a chore or docs commit"; exit 1; }
! grep -Eq '(feat|fix)\(|\b[0-9a-f]{7}\b' $f || { echo "it has commit ids, types or scopes"; exit 1; }
