#!/bin/zsh
node --test 2>&1 | grep -q '^ℹ fail 0' || { echo "tests fail"; exit 1; }
[ -f validate.mjs ] || { echo "no validate.mjs"; exit 1; }
[ "$(cat handlers/*.mjs | grep -c "lastIndexOf('@')")" -eq 0 ] || { echo "the check is still copied in handlers/"; exit 1; }
[ "$(grep -c "lastIndexOf" validate.mjs)" -ge 1 ] || { echo "validate.mjs lacks the check"; exit 1; }
for h in user order invoice; do grep -q "validate.mjs" handlers/$h.mjs || { echo "handlers/$h.mjs does not use validate.mjs"; exit 1; }; done
node -e "
Promise.all([import('./handlers/user.mjs'), import('./handlers/order.mjs'), import('./handlers/invoice.mjs')]).then(([{ createUser }, { placeOrder }, { sendInvoice }]) => {
  const eq = (a, b, why) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.log(why + ': got ' + JSON.stringify(a)); process.exit(1); } };
  const bad = { ok: false, error: 'bad email' };
  for (const e of ['@x.io', 'a@b', 'a@.io', 'a@b.', 'a@b@c.io', 'plain']) { eq(createUser('n', e), bad, 'createUser ' + e); eq(placeOrder(e, [1]), bad, 'placeOrder ' + e); eq(sendInvoice(e, 5), bad, 'sendInvoice ' + e); }
  eq(createUser('', 'a@b.io'), { ok: false, error: 'name required' }, 'name first');
  eq(placeOrder('nope', []), { ok: false, error: 'no items' }, 'items first');
  eq(sendInvoice('  A@B.IO ', 0), { ok: false, error: 'bad amount' }, 'amount after the email');
  eq(sendInvoice(' Bob@Example.COM ', 10), { ok: true, to: 'bob@example.com', amount: 10 }, 'invoice lowers and trims');
  eq(sendInvoice(' Bob@Example.COM. ', 10), bad, 'invoice checks the trimmed address');
  eq(createUser('n', 'Bob@Example.com'), { ok: true, user: { name: 'n', email: 'Bob@Example.com' } }, 'user keeps the case');
})" || exit 1
