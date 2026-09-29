#!/bin/zsh
node -e "import('./form.mjs').then(({ validate }) => {
  const eq = (f, want) => { const got = JSON.stringify(validate(f)); if (got !== JSON.stringify(want)) { console.log(JSON.stringify(f) + ' gave ' + got); process.exit(1); } };
  eq({ name: 'Ann', age: 34, email: 'a@b.c' }, []);
  eq({ name: '  ', age: 34, email: 'a@b.c' }, ['name']);
  eq({ name: 'Ann', age: 34.5, email: 'nope' }, ['age', 'email']);
  eq({ name: '', age: 131, email: '' }, ['name', 'age', 'email']);
  eq({ name: 'Bo', age: 0, email: 'x@y' }, []);
})" || exit 1
[ "$(node app.mjs)" = 'ok' ] || { echo "app.mjs prints: $(node app.mjs 2>&1 | head -2 | tr '\n' '|')"; exit 1; }
