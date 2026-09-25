#!/bin/zsh
# Proves each practice task's check can fail and can pass: it must fail on the
# untouched project and (where a reference answer exists) pass with it.
here=${0:A:h}
for t in "$here"/tasks/*(/); do
  name=${t:t}
  d=$(mktemp -d) && cp -R "$t/project" "$d/project" && : > "$d/answer.txt" && touch "$d/started" && sleep 1
  (cd "$d/project" && zsh "$t/check.sh" >/dev/null 2>&1) && before=PASS || before=fail
  after="-"
  if [ -d "$t/reference" ]; then
    for f in "$t"/reference/*(N); do [ "${f:t}" = answer.txt ] && cp "$f" "$d/answer.txt" || cp "$f" "$d/project/"; done
    (cd "$d/project" && zsh "$t/check.sh" > "$d/why" 2>&1) && after=pass || after="FAIL: $(tail -1 "$d/why")"
  fi
  ok=yes; [ "$before" = fail ] || ok=NO; [ "$after" = pass ] || [ "$after" = "-" ] || ok=NO
  printf '%-26s untouched: %-5s reference: %-5s %s\n' "$name" "$before" "$after" "$([ $ok = yes ] && echo ok || echo '<< CHECK IS WRONG')"
  rm -rf "$d"
done
