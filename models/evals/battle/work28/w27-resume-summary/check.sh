#!/bin/zsh
[ -s SUMMARY.md ] || { echo "no SUMMARY.md"; exit 1; }
[ "$(shasum resume.md | cut -c1-12)" = "d6da312f3a1f" ] || { echo "resume.md was changed"; exit 1; }
[ "$(shasum job.txt | cut -c1-12)" = "7d66d4cc8085" ] || { echo "job.txt was changed"; exit 1; }
[ "$(grep -Ec '^\s*([-*]|[0-9]+\.) ' SUMMARY.md)" -ge 4 ] || { echo "fewer than 4 bullets (one per must-have)"; exit 1; }
for w in React TypeScript Node PostgreSQL WebSocket; do grep -qi "$w" SUMMARY.md || { echo "it does not cover $w"; exit 1; }; done
grep -Eq '2,000|2000|40 s|3 s|12 services|5 million' SUMMARY.md || { echo "no proof from the resume (a number from it)"; exit 1; }
! grep -Eqi '\b(8|eight|10|ten)\+? (years|yrs)' SUMMARY.md || { echo "it claims more years than the resume has (6)"; exit 1; }
