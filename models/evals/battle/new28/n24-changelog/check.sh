#!/bin/zsh
[ -f CHANGELOG.md ] || { echo 'no CHANGELOG.md'; exit 1; }
grep -q '1\.3\.0' CHANGELOG.md || { echo 'no 1.3.0 entry'; exit 1; }
grep -q '1\.2\.0' CHANGELOG.md || { echo 'the 1.2.0 entry is gone'; exit 1; }
e=$(awk '/1\.3\.0/{on=1;next} /^## /{on=0} on' CHANGELOG.md)
echo "$e" | grep -Eqi 'timeout' || { echo 'the 1.3.0 entry does not mention the timeout'; exit 1; }
echo "$e" | grep -Eqi 'retr' || { echo 'the 1.3.0 entry does not mention retries'; exit 1; }
echo "$e" | grep -Eqi 'getSync' || { echo 'the 1.3.0 entry does not mention getSync being removed'; exit 1; }
echo "$e" | grep -Eqi 'fetchUrl|deprecat' || { echo 'the 1.3.0 entry does not mention fetchUrl / the deprecation'; exit 1; }
[ $(echo "$e" | grep -Ec '^\s*[-*] ') -ge 3 ] || { echo 'the 1.3.0 entry has fewer than 3 bullets'; exit 1; }
