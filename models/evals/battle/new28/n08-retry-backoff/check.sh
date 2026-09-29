#!/bin/zsh
node -e "import('./retry.mjs').then(async ({ retry }) => {
  let n = 0; const t0 = Date.now();
  const v = await retry(async () => { n++; if (n < 3) throw new Error('no ' + n); return 'ok'; }, 5, 40);
  const ms = Date.now() - t0;
  if (v !== 'ok' || n !== 3) { console.log('wrong result or tries: ' + v + ' ' + n); process.exit(1); }
  if (ms < 110 || ms > 400) { console.log('waited ' + ms + ' ms, want about 120 (40 then 80)'); process.exit(1); }
  let m = 0; try { await retry(async () => { m++; throw new Error('fail ' + m); }, 3, 5); console.log('did not throw'); process.exit(1); } catch (e) { if (e.message !== 'fail 3' || m !== 3) { console.log('wrong error or tries: ' + e.message + ' ' + m); process.exit(1); } }
})" || exit 1
