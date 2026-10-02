#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ "$(node --test 2>&1 | sed -n 's/^ℹ tests //p')" -ge 5 ] || { echo "no new test"; exit 1; }
node -e "
import('./status.mjs').then(({ transition }) => {
  const fail = (why) => { console.log(why); process.exit(1); };
  const o = (status, at = []) => ({ id: 7, status, at, note: 'keep' });
  const ok = [['new', 'paid'], ['new', 'cancelled'], ['paid', 'shipped'], ['paid', 'cancelled'], ['shipped', 'delivered']];
  const all = ['new', 'paid', 'shipped', 'delivered', 'cancelled'];
  for (const f of all) for (const t of all) {
    const allowed = ok.some(([a, b]) => a === f && b === t);
    let r, err;
    try { r = transition(o(f), t); } catch (e) { err = e; }
    if (allowed && err) fail(f + ' -> ' + t + ' should be allowed: ' + err.message);
    if (!allowed && (!err || err.message !== 'cannot go from ' + f + ' to ' + t)) fail(f + ' -> ' + t + ' should throw ' + JSON.stringify('cannot go from ' + f + ' to ' + t) + ', got ' + (err ? JSON.stringify(err.message) : 'no error'));
    if (allowed) {
      if (r.status !== t || r.note !== 'keep' || r.id !== 7) fail(f + ' -> ' + t + ' result: ' + JSON.stringify(r));
      if (t === 'cancelled' && r.refund !== (f === 'paid')) fail('refund for ' + f + ' -> cancelled: ' + r.refund);
      if (t !== 'cancelled' && 'refund' in r) fail('refund set on ' + f + ' -> ' + t);
    }
  }
  for (const [f, t, bad] of [['lost', 'paid', 'lost'], ['new', 'gone', 'gone']]) {
    try { transition(o(f), t); fail('unknown ' + bad + ' did not throw'); } catch (e) { if (e.message !== 'unknown status ' + bad) fail('unknown status message: ' + e.message); }
  }
  const a = o('paid', [{ status: 'paid', step: 1 }]);
  const before = JSON.stringify(a);
  const b = transition(a, 'shipped');
  if (JSON.stringify(a) !== before) fail('the order passed in was changed');
  if (b === a || b.at === a.at) fail('not a new order / at list');
  if (JSON.stringify(b.at) !== JSON.stringify([{ status: 'paid', step: 1 }, { status: 'shipped', step: 2 }])) fail('at: ' + JSON.stringify(b.at));
})" || exit 1
