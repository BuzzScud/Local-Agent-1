#!/bin/zsh
export TZ=America/New_York
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "the tests fail"; exit 1; }
[ "$(shasum dates.test.mjs | cut -c1-12)" = "6f5c03a17dd0" ] || { echo "dates.test.mjs was changed (fix the code, not the tests)"; exit 1; }
TZ=Pacific/Honolulu node -e "import('./dates.mjs').then(({ formatDay }) => { if (formatDay('2026-12-31') !== '12/31/2026') { console.log('wrong in Honolulu: ' + formatDay('2026-12-31')); process.exit(1); } })" || exit 1
TZ=Asia/Tokyo node -e "import('./dates.mjs').then(({ formatDay }) => { if (formatDay('2026-03-05') !== '3/5/2026') { console.log('wrong in Tokyo: ' + formatDay('2026-03-05')); process.exit(1); } })" || exit 1
