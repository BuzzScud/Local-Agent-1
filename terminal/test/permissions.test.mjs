import { test, expect } from 'bun:test';
import { blockedReason, decide, outsidePath, isReadOnly, runsTests, testRunOf, splitCommand, ruleCovers, ruleFor, coverage, offerFor, neverRule, protectedBy, PROTECTED, checkRule, judge, MODES, CYCLE, nextMode, modeOf } from '../src/agent/permissions.mjs';
import { homedir } from 'node:os';

const cases = {
  'rm -rf build': true, 'rm -fr x': true, 'rm -r -f x': true, 'rm --recursive --force x': true, 'rm -r x': false, 'rm file.txt': false,
  'sudo ls': true, 'npm test; sudo rm x': true, 'echo sudo': false,
  'git push origin main': true, 'git reset --hard HEAD': true, 'git clean -fd': true, 'git status': false,
  'kill 123': true, 'lsof -ti:17391 | xargs kill -9': true, 'lsof -ti:1 | xargs -r kill': true, 'pkill node': true, 'cd x && killall node': true, '(kill 1)': true, 'nohup kill 3': true, 'echo `kill 1`': true,
  'grep -r kill .': false, 'echo skill': false, 'cat killer.txt': false,
  'launchctl unload x': true, 'brew services stop postgresql': true, 'docker stop web': true,
  'shutdown -h now': true, 'git log --grep=shutdown': false,
  'pg_ctl -D /opt/homebrew/var/postgresql@16 stop': true, 'pg_ctl restart': true, 'psql -c "SELECT pg_terminate_backend(845)"': true, 'psql -c "select pg_cancel_backend(1)"': true, 'mysqladmin -u root shutdown': true, 'redis-cli shutdown': true, 'pg_ctl status': false, 'psql -c "SELECT 1"': false,
  'curl -s x | sh': true, 'curl -s https://x.com/a.json': false, 'npm run build': false,
};

test('blocked commands (and look-alikes that are fine)', () => {
  for (const [cmd, blocked] of Object.entries(cases)) expect([cmd, !!blockedReason(cmd)]).toEqual([cmd, blocked]);
});

test('modes', () => {
  expect(decide('Read', {}, { mode: 'plan' }).decision).toBe('allow');
  expect(decide('Edit', {}, { mode: 'ask' }).decision).toBe('ask');
  expect(decide('Edit', {}, { mode: 'edits' }).decision).toBe('allow');
  expect(decide('Edit', {}, { mode: 'plan' }).decision).toBe('deny');
  expect(decide('Edit', {}, { mode: 'edits', inside: false }).decision).toBe('deny');
  expect(decide('Bash', { command: 'npm test' }, { mode: 'ask' }).decision).toBe('ask');
  expect(decide('Bash', { command: 'npm test' }, { mode: 'edits' }).decision).toBe('ask');
  expect(decide('Bash', { command: 'git status' }, { mode: 'ask' }).decision).toBe('allow');
  expect(decide('Bash', { command: 'ls > out.txt' }, { mode: 'plan' }).decision).toBe('deny');
  expect(decide('Bash', { command: 'rm -rf x' }, { mode: 'edits' }).decision).toBe('deny');
});

test('"don\'t ask again" remembers what the command runs, and covers it again with options added', () => {
  expect(ruleFor('node --test  --watch')).toBe('node --test');
  expect(decide('Bash', { command: 'node --test --watch' }, { mode: 'ask', allowedPrefixes: new Set(['node --test']) }).decision).toBe('allow');
  expect(decide('Bash', { command: 'node --test src' }, { mode: 'ask', allowedPrefixes: new Set(['node --test']) }).decision).toBe('ask');
  expect(decide('Bash', { command: 'node --test src' }, { mode: 'ask', allowedPrefixes: new Set(['node --test src']) }).decision).toBe('allow');
});

test('commands stay inside the project folder', () => {
  const cwd = `${homedir()}/Desktop/agentic-coder/demo-project`;
  const out = {
    'cd ~/Desktop/MAIN2026 && git status': '~/Desktop/MAIN2026', 'cat ~/.ssh/id_ed25519': '~/.ssh/id_ed25519', 'cd': '~', 'ls && cd': '~',
    'cd .. && ls': '..', 'ls ../..': '../..', 'cat $HOME/.zshrc': '$HOME/.zshrc', 'find . -newer /tmp': '/tmp', 'ls ~/Desktop/24\\ SEP\\ CODE/': '~/Desktop/24 SEP CODE/',
    "node -e \"require('fs').readFileSync('/Users/x/a')\"": '/Users/x/a', 'find / -name x': '/', 'ls /opt/homebrew/var/postgresql@16': '/opt/homebrew/var/postgresql@16', 'cat /usr/local/var/log/x.log': '/usr/local/var/log/x.log',
  };
  const fine = ['ls -la; ls old/', 'node --test 2>/dev/null', '/usr/bin/env node x.mjs', 'git log --oneline', 'cd src && ls', `cat ${cwd}/export.mjs`, 'curl -s https://x.com/a.json', 'node -e "console.log(/a\\/b/.test(x))"', 'python3 x.py < trades.json', 'ls src/../old', '/opt/homebrew/opt/postgresql@16/bin/psql --version', 'ls /opt/homebrew/bin'];
  for (const [cmd, word] of Object.entries(out)) expect([cmd, outsidePath(cmd, cwd)]).toEqual([cmd, word]);
  for (const cmd of fine) expect([cmd, outsidePath(cmd, cwd)]).toEqual([cmd, null]);
  // Refused in every mode, before "don't ask again" and read-only shortcuts.
  for (const mode of ['ask', 'edits', 'plan']) expect(decide('Bash', { command: 'cd ~/Desktop/MAIN2026 && git status' }, { mode, cwd }).decision).toBe('deny');
  expect(decide('Bash', { command: 'ls ~' }, { mode: 'ask', cwd, allowedPrefixes: new Set(['ls ~']) }).decision).toBe('deny');
  expect(decide('Bash', { command: 'git status' }, { mode: 'ask', cwd }).decision).toBe('allow');
  expect(decide('Read', { path: '/x' }, { mode: 'ask', inside: false }).decision).toBe('deny');
  expect(decide('Search', { pattern: 'x' }, { mode: 'ask', inside: false }).decision).toBe('deny');
});

test('the story test: read-only checks run without asking, a quoted "/" is text, writing still asks', () => {
  const cwd = homedir();
  const incident = 'echo "=== exact last 45 bytes (raw) ==="; tail -c 45 "Desktop/HELLO TEST 26 SEP.txt" | od -c; echo; echo "=== byte count / line count ==="; wc -c -l "Desktop/HELLO TEST 26 SEP.txt"; echo; grep -n "alive\\|still," "Desktop/HELLO TEST 26 SEP.txt"; ls -la Desktop/ | grep -i "hello\\|test\\|26 sep"';
  expect(outsidePath(incident, cwd)).toBe(null);                  // was: "/ is outside the project folder"
  expect(decide('Bash', { command: incident }, { mode: 'ask', cwd }).decision).toBe('allow');
  for (const c of ['tail -c 60 "Desktop/a b.txt" | od -c | tail -8', `sed -n '24p' Desktop/"a b.txt" | od -c`, 'wc -l f; tail -n1 f; ls -la Desktop/ | head -40', 'git log --oneline -3 2>&1 | head'])
    expect([c, isReadOnly(c)]).toEqual([c, true]);
  for (const c of ['cat a > b', 'echo x >> notes.md', 'sed -i s/a/b/ f', 'find . -delete', 'ls $(pwd)', 'node x.mjs | head', 'ls; rm -f x', 'cat a & rm b'])
    expect([c, decide('Bash', { command: c }, { mode: 'ask', cwd }).decision]).toEqual([c, 'ask']);
  expect(outsidePath('ls /', cwd)).toBe('/');                     // a bare / outside quotes is still the disk
  expect(outsidePath(`node -e "require('fs').readFileSync('/Users/x/a')"`, `${cwd}/p`)).toBe('/Users/x/a');
});

test('code in quotes that only looks like a path is not turned away (the three of 1 Oct)', () => {
  const cwd = homedir();
  const real = [
    `cd ~/Desktop && node -e "\n// Simulate the countdown tick logic\nvar target = new Date('2026-10-15T18:00:00').getTime();\nconsole.log(target);\n"`,
    `node -e "\nconst txt=require('fs').readFileSync('Desktop/countdown-card.html','utf8');\nconsole.log('Has charset meta:', /<meta charset=/.test(txt));\n"`,
    `python3 - << 'PY'\ncontent = open('Desktop/invoice-snapshot.html').read()\nold = '<button id="download" type="button">Download</button>'\nnew = '<a id="download" href="#">Download</a>'\nopen('Desktop/invoice-snapshot.html', 'w').write(content.replace(old, new))\nPY`,
  ];
  for (const cmd of real) expect([cmd, outsidePath(cmd, cwd)]).toEqual([cmd, null]);
  // A real path in the same places is still found.
  const p = `${cwd}/p`;
  expect(outsidePath(`sh -c "cat </Users/x/a"`, p)).toBe('/Users/x/a');
  expect(outsidePath(`node -e "require('fs').readFileSync('//Users/x/a')"`, p)).toBe('//Users/x/a');
  expect(outsidePath(`python3 -c "open('/.ssh/id')"`, p)).toBe('/.ssh/id');
  expect(outsidePath(`python3 -c "print('<b>/Users/x</b>')"`, p)).toBe('/Users/x');
});

test('a git commit always asks, even after "don\'t ask again" or chained after an allowed command', () => {
  const allowed = new Set(['git commit', 'npm test']);
  for (const command of ['git commit -m "x"', 'npm test && git commit -am "x"', 'git add . && git commit -m x', 'git -C sub commit -m x', 'git -c user.name=me commit -m x', 'sh -c "git commit -m x"', 'git commit --amend --no-edit']) {
    for (const mode of ['ask', 'edits']) expect([command, mode, decide('Bash', { command }, { mode, allowedPrefixes: allowed })]).toEqual([command, mode, { decision: 'ask', once: true }]);
  }
  // plan mode still refuses it; reading the history still runs without asking
  expect(decide('Bash', { command: 'git commit -m x' }, { mode: 'plan' }).decision).toBe('deny');
  for (const command of ['git log --grep commit', 'git status', 'git show HEAD']) expect([command, decide('Bash', { command }, { mode: 'ask' }).decision]).toEqual([command, 'allow']);
  // other commands keep "don't ask again"
  expect(decide('Bash', { command: 'npm test' }, { mode: 'ask', allowedPrefixes: allowed }).decision).toBe('allow');
});

test('the question for a commit has no "don\'t ask again"', async () => {
  const { permissionOptions } = await import('../src/app/screen.jsx');
  expect(permissionOptions({ name: 'Bash', once: true }, 'git commit').map((o) => o.choice)).toEqual(['yes', 'no']);
  expect(permissionOptions({ name: 'Bash' }, 'npm test').map((o) => o.choice)).toEqual(['yes', 'always', 'no']);
});

// ---- /permissions: a new line is another command, saved rules, protected files ----

test('a new line starts another command: "ls⏎rm notes.txt" asks, it no longer counts as reading', () => {
  const cwd = homedir();
  for (const c of ['ls\nrm notes.txt', 'cat a.txt\ntouch b.txt', 'echo hi\nnode evil.js', 'pwd\n\nrm x', 'ls\r\nrm x'.replace('\r', '')])
    expect([c, isReadOnly(c), decide('Bash', { command: c }, { mode: 'ask', cwd }).decision]).toEqual([c, false, 'ask']);
  // a new line inside quotes, or after a backslash, is not a second command; two readers are still readers
  for (const c of ['echo "one\ntwo"', 'ls -la \\\n  src', 'ls\npwd', 'git status\ngit log --oneline -3', 'grep -n "a" f\n'])
    expect([c, isReadOnly(c)]).toEqual([c, true]);
});

test('splitCommand: the parts, and what makes a command untrustworthy', () => {
  expect(splitCommand('npm test && ls | head; echo hi\nls').parts.map((p) => p.trim())).toEqual(['npm test', 'ls', 'head', 'echo hi', 'ls']);
  const flags = (c) => { const { parts, seps, ...f } = splitCommand(c); return f; };
  expect(flags('npm test 2>&1 | tail -5')).toEqual({ nested: false, writes: false, background: false, open: false });
  expect(flags('node x.mjs >/dev/null 2>/dev/null')).toEqual({ nested: false, writes: false, background: false, open: false });
  expect(flags('npm test > out.txt').writes).toBe(true);
  expect(flags('echo x >> notes.md').writes).toBe(true);
  expect(flags('ls $(pwd)').nested).toBe(true);
  expect(flags('echo `date`').nested).toBe(true);
  expect(flags('sleep 5 &').background).toBe(true);
  expect(flags('echo "a').open).toBe(true);
  expect(splitCommand('echo "a; b" && ls').parts.map((p) => p.trim())).toEqual(['echo "a; b"', 'ls']); // ; inside quotes is text
});

test('a rule covers its command with options added; "rm notes.txt" never covers "rm notes.txt other.txt"; * covers the rest', () => {
  const yes = [['npm test', 'npm test'], ['npm test', 'npm test --watch'], ['npm test', 'npm test -- foo'], ['bun run test', 'bun run test --watch'], ['bun run test', 'bun run test -- src/a.test.ts'], ['git add', 'git add -A'], ['make', 'make'], ['make', 'make -j4'],
    ['make *', 'make deploy'], ['bun run *', 'bun run deploy'], ['bun run *', 'bun run'], ['git add *', 'git add .'], ['node --test', 'node --test --watch'], ['rm notes.txt', 'rm notes.txt'], ['rm notes.txt', 'rm notes.txt -v'], ['python3 -m pytest', 'python3 -m pytest -x -q']];
  const no = [['npm test', 'npm testing'], ['npm test', 'npm run test'], ['npm test', 'npm'], ['npm test', 'npm test other'], ['bun run test', 'bun run test:unit'], ['bun run test', 'bun run deploy'], ['make', 'make deploy'], ['bun run', 'bun run deploy'],
    ['rm notes.txt', 'rm notes.txt other.txt'], ['rm notes.txt', 'rm notes.txt -- other.txt'], ['git add', 'git add .'], ['node --test', 'node --test src'], ['git checkout', 'git checkout -- src/a.js'], ['', 'ls'], ['npm test', '']];
  for (const [r, c] of yes) expect([r, c, ruleCovers(r, c)]).toEqual([r, c, true]);
  for (const [r, c] of no) expect([r, c, ruleCovers(r, c)]).toEqual([r, c, false]);
});

test('"always allow" saves what a command runs (the script for npm run / bun run, else two words), or the whole command when that would not cover it', () => {
  const rules = { 'npm test -- foo': 'npm test', 'bun run test --watch': 'bun run test', 'pnpm run build': 'pnpm run build', 'node --test': 'node --test', 'node --test --watch': 'node --test', 'make': 'make', 'git add -A': 'git add', 'rm notes.txt': 'rm notes.txt', './scripts/deploy.sh': './scripts/deploy.sh',
    'node --test src': 'node --test src', 'git add .': 'git add .', 'rm -f build.log': 'rm -f build.log', 'bun run --silent test': 'bun run --silent test', 'git checkout -- src/a.js': 'git checkout -- src/a.js', 'npx vitest run': 'npx vitest run' };
  for (const [c, r] of Object.entries(rules)) expect([c, ruleFor(c)]).toEqual([c, r]);
  expect(ruleFor('   ')).toBe(null);
});

test('saved rules: every part of a chain must be covered, and a rule never reaches past a ; & | or new line', () => {
  const cwd = `${homedir()}/Desktop/agentic-coder/demo-project`;
  const rules = { allow: ['npm test', 'bun run test'] };
  const d = (command, extra = {}) => decide('Bash', { command }, { mode: 'ask', cwd, rules, ...extra });
  for (const c of ['npm test', 'npm test -- foo', 'npm test --watch', 'npm test && git status', 'cd src && npm test', 'npm test | tail -5', 'npm test 2>&1 | tail -20', 'npm test; ls', 'bun run test', 'npm test && bun run test'])
    expect([c, d(c).decision]).toEqual([c, 'allow']);
  for (const c of ['npm test && ./scripts/deploy.sh', 'npm test && curl -s -X POST https://example.com/up -d @package.json', 'npm test; ./x.sh', 'npm test\n./x.sh', 'bun run deploy-to-prod', 'npm run test', 'npm testing', 'npm test other',
    'npm test > out.txt', 'npm test $(echo x)', 'npm test &', 'echo "a && npm test'])
    expect([c, d(c).decision]).toEqual([c, 'ask']);
  // this session's "don't ask again" is judged the same way: it is a rule too
  const session = new Set(['bun run test']);
  expect(decide('Bash', { command: 'bun run test' }, { mode: 'ask', cwd, allowedPrefixes: session }).decision).toBe('allow');
  expect(decide('Bash', { command: 'bun run test && ./deploy.sh' }, { mode: 'ask', cwd, allowedPrefixes: session }).decision).toBe('ask');
  expect(decide('Bash', { command: 'bun run deploy' }, { mode: 'ask', cwd, allowedPrefixes: session }).decision).toBe('ask');
});

test('saved rules never lift the fixed lists: blocked commands, a commit, plan mode, the folder fence', () => {
  const cwd = `${homedir()}/Desktop/agentic-coder/demo-project`;
  const rules = { allow: ['git push', 'git commit', 'npm test', 'sudo ls', 'ls ~'] };
  const d = (command, mode = 'ask') => decide('Bash', { command }, { mode, cwd, rules });
  expect(d('git push origin main').decision).toBe('deny');
  expect(d('sudo ls').decision).toBe('deny');
  expect(d('ls ~').decision).toBe('deny');
  expect(d('git commit -m x')).toEqual({ decision: 'ask', once: true });
  expect(d('npm test && git commit -am x')).toEqual({ decision: 'ask', once: true });
  expect(d('npm test', 'plan').decision).toBe('deny'); // plan mode is read-only whatever you saved
  expect(d('npm test', 'edits').decision).toBe('allow');
});

test('your never-list wins in every mode, over your allow-list, and finds the command inside quotes and chains', () => {
  const cwd = `${homedir()}/Desktop/agentic-coder/demo-project`;
  const rules = { allow: ['npm publish', 'npm test'], never: ['npm publish', 'docker compose down'] };
  for (const mode of ['ask', 'edits', 'plan']) {
    for (const c of ['npm publish', 'npm publish --tag beta', 'npm test && npm publish', 'sh -c "npm publish"', 'echo x; npm publish', 'xargs npm publish', 'docker compose down -v'])
      expect([mode, c, decide('Bash', { command: c }, { mode, cwd, rules })]).toEqual([mode, c, { decision: 'deny', reason: `blocked by your rule "${c.includes('docker') ? 'docker compose down' : 'npm publish'}" (/permissions)` }]);
  }
  for (const c of ['npm publisher', 'npm publish-notes', 'docker compose up']) expect([c, neverRule(c, rules.never)]).toEqual([c, null]);
  expect(neverRule('git status', [])).toBe(null);
  expect(neverRule('npm publish', ['npm publish *'])).toBe('npm publish *'); // a trailing * is allowed and means the same
});

test('"always allow" offers the first part nothing covers, and nothing when the command cannot be judged by its words', () => {
  expect(offerFor('npm test && ./scripts/deploy.sh', { saved: ['npm test'] })).toEqual({ rule: './scripts/deploy.sh', part: './scripts/deploy.sh' });
  expect(offerFor('bun run test --watch')).toEqual({ rule: 'bun run test', part: 'bun run test --watch' });
  expect(offerFor('rm export.test.mjs')).toEqual({ rule: 'rm export.test.mjs', part: 'rm export.test.mjs' });
  expect(offerFor(`node ${'x'.repeat(130)}.mjs`)).toBe(null); // too long to be a rule: it asks each time
  expect(offerFor('cd src && npm test')).toEqual({ rule: 'npm test', part: 'npm test' });
  expect(offerFor('npm test', { saved: ['npm test'] })).toBe(null);                 // already covered
  expect(offerFor('npm test', { session: new Set(['npm test']) })).toBe(null);
  for (const c of ['npm test > out.txt', 'npm test $(pwd)', 'npm test &', 'echo "x']) expect([c, offerFor(c)]).toEqual([c, null]);
  const c = coverage('npm test && ls | head', { saved: ['npm test'] });
  expect(c.parts.map((p) => [p.part, p.by])).toEqual([['npm test', 'saved'], ['ls', 'reads'], ['head', 'reads']]);
  expect(c.allowed).toBe(true);
});

test('protected files always ask, even in Auto-edit, and the question has no "allow all edits"', () => {
  for (const p of ['.env', '.env.local', 'config/.env', 'server.pem', 'keys/id_rsa', 'keys/id_rsa.pub', 'id_ed25519', 'deploy.key', '.git', '.git/config', '.git/hooks/pre-commit', 'sub/.git/config', '.agentic/settings.json', 'pkg/.agentic/settings.json', '.bonsai/settings.json'])
    expect([p, protectedBy(p) !== null]).toEqual([p, true]);
  for (const p of ['src/app.js', '.gitignore', '.gitattributes', 'environment.md', 'src/env.js', 'docs/git.md', '.agentic/memory/x.md', 'my.keyboard.js', 'README.md', 'src/.github/x.yml'])
    expect([p, protectedBy(p)]).toEqual([p, null]);
  expect(protectedBy('config/prod.json', ['config/prod.*'])).toBe('config/prod.*');
  expect(protectedBy('src/config/prod.json', ['config/prod.*'])).toBe('config/prod.*');
  expect(protectedBy('config/dev.json', ['config/prod.*'])).toBe(null);
  // whatever the case (on a Mac .ENV is .env), a link and where it points, the app's own folder in a home-folder project
  for (const p of ['.ENV', '.Env.Local', 'Keys/ID_RSA', '.GIT/config', '.agentic-coder/permissions.json', '.agentic-coder/trust.json']) expect([p, protectedBy(p) !== null]).toEqual([p, true]);
  expect(protectedBy(['notes.md', '.env'])).toBe('.env');
  expect(protectedBy(['notes.md', undefined])).toBe(null);
  expect(PROTECTED).toContain('.env');
  for (const mode of ['ask', 'edits']) {
    for (const tool of ['Edit', 'Write']) expect([mode, tool, decide(tool, { path: '.env' }, { mode })]).toEqual([mode, tool, { decision: 'ask', once: true, protectedBy: '.env' }]);
    expect(decide('Write', { path: 'x' }, { mode, rel: '.git/hooks/pre-commit' })).toEqual({ decision: 'ask', once: true, protectedBy: '.git/**' });
    expect(decide('Edit', { path: 'x' }, { mode, rel: 'config/prod.json', rules: { protect: ['config/prod.*'] } })).toEqual({ decision: 'ask', once: true, protectedBy: 'config/prod.*' });
  }
  expect(decide('Write', { path: 'src/app.js' }, { mode: 'edits' })).toEqual({ decision: 'allow' });       // an ordinary file: as before
  expect(decide('Write', { path: '.env' }, { mode: 'plan' }).decision).toBe('deny');                          // plan mode still refuses
  expect(decide('Write', { path: '.env' }, { mode: 'edits', inside: false }).decision).toBe('deny');          // outside the folder still refuses
  expect(decide('Read', { path: '.env' }, { mode: 'edits' })).toEqual({ decision: 'allow' });                 // reading is unchanged
});

test('what a typed rule may be (/permissions allow | never | protect)', () => {
  expect(checkRule('allow', 'npm test')).toEqual({ rule: 'npm test' });
  expect(checkRule('allow', '  "npm   test" ')).toEqual({ rule: 'npm test' });
  expect(checkRule('allow', 'bun run *')).toEqual({ rule: 'bun run *' });
  expect(checkRule('allow', 'make').note).toBe('"make *" would cover anything after it.');
  expect(checkRule('allow', 'make *')).toEqual({ rule: 'make *' });
  expect(checkRule('allow', 'git push').error).toMatch(/never allowed/);
  expect(checkRule('allow', 'sudo ls').error).toMatch(/never allowed/);
  expect(checkRule('allow', 'git commit -m x').error).toMatch(/commit always asks/);
  expect(checkRule('allow', 'ls -la').error).toMatch(/only reads/);
  expect(checkRule('allow', 'npm test && rm x').error).toMatch(/one command/);
  expect(checkRule('allow', 'npm test > out').error).toMatch(/one command/);
  expect(checkRule('allow', 'x'.repeat(121)).error).toMatch(/too long/);
  expect(checkRule('allow', '').error).toMatch(/Say which command/);
  expect(checkRule('never', 'npm publish')).toEqual({ rule: 'npm publish' });
  expect(checkRule('never', 'git push').error).toMatch(/already never allowed/);
  expect(checkRule('protect', 'config/prod.*')).toEqual({ rule: 'config/prod.*' });
  for (const bad of ['/etc/passwd', '~/x', '../x', 'a/../b', '*', '**', '?']) expect([bad, !!checkRule('protect', bad).error]).toEqual([bad, true]);
  expect(checkRule('protect', '').error).toMatch(/Say which file/);
});

test('judge says why: the /permissions test panel prints it; decide() is the same decision without it', () => {
  const cwd = `${homedir()}/Desktop/agentic-coder/demo-project`;
  const ctx = { mode: 'ask', cwd, rules: { allow: ['npm test'] }, allowedPrefixes: new Set(['node --test *']) };
  const why = (command, extra = {}) => judge('Bash', { command }, { ...ctx, ...extra });
  expect(why('git status')).toEqual({ decision: 'allow', why: 'it only reads' });
  expect(why('npm test').why).toBe('every part is covered: "npm test" (saved)');
  expect(why('node --test src').why).toBe('every part is covered: "node --test *" (this session)');
  expect(why('npm test && git status').why).toBe('every part is covered: "npm test" (saved), the rest only reads');
  expect(why('git commit -m x')).toEqual({ decision: 'ask', once: true, why: 'a commit always asks' });
  expect(why('npm test && ./x.sh').why).toBe('"./x.sh" is not covered by any rule');
  expect(why('make deploy').why).toBe('it can change things and no rule covers it');
  expect(why('npm test > out.txt').why).toMatch(/cannot be trusted/);
  expect(why('git push').reason).toBe('blocked: git push sends your code off this Mac');
  for (const c of ['npm test', 'git commit -m x', 'make deploy', 'git status', 'git push']) expect('why' in decide('Bash', { command: c }, ctx)).toBe(false);
  expect(judge('Edit', { path: 'src/a.js' }, { mode: 'edits' }).why).toBe('Accept edits is on');
  expect(judge('Edit', { path: 'src/a.js' }, { mode: 'ask' }).why).toBe('Manual is on');
  expect(judge('Edit', { path: '.env' }, { mode: 'edits' }).why).toBe('it is a protected file (.env); protected files always ask');
});

// ---- a command that names a protected file (found on the "all good?" check, 29 Sep) ----

test('a command that names a protected file asks every time, whatever rule you saved; reading one does not', () => {
  const cwd = `${homedir()}/Desktop/agentic-coder/demo-project`;
  const rules = { allow: ['cp *', 'sed -i *', 'git checkout *', 'npm test'], protect: ['config/prod.*'] };
  for (const mode of ['ask', 'edits']) {
    for (const [command, guard] of [['cp .env.example .env', '.env.*'], ['cp defaults.txt .env', '.env'], ['sed -i s/3000/4000/ .env', '.env'], ['git checkout -- .env', '.env'], ['cp tmp.json config/prod.json', 'config/prod.*'], ['npm test && cp a .ENV', '.env'], ['cp a --target-directory=.git', '.git'], ['cp id_rsa.pub keys/', 'id_rsa*']])
      expect([mode, command, decide('Bash', { command }, { mode, cwd, rules })]).toEqual([mode, command, { decision: 'ask', once: true, protectedBy: guard }]);
    for (const command of ['cp a b', 'npm test', 'sed -i s/a/b/ src/app.js']) expect([mode, command, decide('Bash', { command }, { mode, cwd, rules }).decision]).toEqual([mode, command, 'allow']);
    for (const command of ['cat .env', 'grep API .env', 'git diff .env']) expect([mode, command, decide('Bash', { command }, { mode, cwd, rules }).decision]).toEqual([mode, command, 'allow']);
  }
  expect(judge('Bash', { command: 'cp defaults.txt .env' }, { mode: 'edits', cwd, rules }).why).toBe('"cp defaults.txt .env" names a protected file (.env), so it asks');
  expect(offerFor('cp .env.example .env', { saved: [] })).toBe(null);                  // no rule could let it through
  expect(offerFor('npm test && cp a .env', { saved: [] })).toEqual({ rule: 'npm test', part: 'npm test' }); // the part before it still can be
  expect(checkRule('allow', 'cp defaults.txt .env').error).toMatch(/names a protected file \(\.env\)/);
  expect(checkRule('allow', 'cp tmp.json config/prod.json', { protect: ['config/prod.*'] }).error).toMatch(/config\/prod\.\*/);
  expect(checkRule('allow', 'cp tmp.json config/dev.json', { protect: ['config/prod.*'] })).toEqual({ rule: 'cp tmp.json config/dev.json' });
  expect(checkRule('never', 'cp x .env')).toEqual({ rule: 'cp x .env' });                // a never rule may name one
});

test('the question: four choices with "always allow … in this folder"; a protected file or command has only yes and no', async () => {
  const { permissionOptions } = await import('../src/app/screen.jsx');
  expect(permissionOptions({ name: 'Bash' }, 'node --test', 'node --test').map((o) => [o.choice, o.label])).toEqual([
    ['yes', 'Yes'], ['always', "Yes, and don't ask again for node --test this session"], ['save', 'Yes, and always allow node --test in this folder'], ['no', 'No, and tell Agentic Coder what to do differently (esc)']]);
  expect(permissionOptions({ name: 'Bash' }, null, null).map((o) => o.choice)).toEqual(['yes', 'no']);          // words that cannot make a rule
  expect(permissionOptions({ name: 'Bash', once: true, protectedBy: '.env' }, 'cp', 'cp').map((o) => o.choice)).toEqual(['yes', 'no']);
  for (const name of ['Edit', 'Write', 'Rename']) expect([name, permissionOptions({ name, once: true, protectedBy: '.env' }, null).map((o) => o.choice)]).toEqual([name, ['yes', 'no']]);
  expect(permissionOptions({ name: 'Edit' }, null).map((o) => o.choice)).toEqual(['yes', 'always', 'no']);
});

// The five modes (1 Oct 2026, Claude Code's): Auto and Bypass permissions join Manual, Accept edits and Plan.
const ctx5 = (mode, extra = {}) => ({ mode, cwd: '/p', inside: true, ...extra });
const d5 = (name, args, mode, extra) => decide(name, args, ctx5(mode, extra)).decision;

test('the five modes by name: Claude Code\'s words and the old ones; shift+tab walks four and never lands on Bypass', () => {
  expect(MODES).toEqual(['auto', 'ask', 'edits', 'plan', 'bypass']);
  expect(['Manual', 'accept', 'auto-edit', 'AUTO', 'bypass-permissions', 'plan', 'yolo'].map(modeOf)).toEqual(['ask', 'edits', 'edits', 'auto', 'bypass', 'plan', null]);
  expect(CYCLE).toEqual(['ask', 'edits', 'plan', 'auto']);
  expect(['ask', 'edits', 'plan', 'auto', 'bypass'].map(nextMode)).toEqual(['edits', 'plan', 'auto', 'ask', 'ask']);
});

test('Auto: reading and edits go through; what no rule covers goes to the check; the hard lines never reach it', () => {
  expect(d5('Edit', { path: 'src/a.js' }, 'auto')).toBe('allow');
  expect(d5('Bash', { command: 'git status' }, 'auto')).toBe('allow'); // only reads
  expect(d5('Bash', { command: 'npm install left-pad' }, 'auto')).toBe('check');
  expect(d5('Bash', { command: 'node build.mjs > out.txt' }, 'auto')).toBe('check'); // words a rule cannot trust: still checked
  expect(d5('Bash', { command: 'node --test' }, 'auto', { rules: { allow: ['node --test'] } })).toBe('allow'); // a rule covers it
  expect(decide('Bash', { command: 'git commit -m x' }, ctx5('auto'))).toEqual({ decision: 'ask', once: true }); // a commit always asks
  expect(decide('Write', { path: '.env' }, ctx5('auto', { rel: '.env' }))).toMatchObject({ decision: 'ask', once: true, protectedBy: '.env' });
  expect(decide('Bash', { command: 'cp x .env' }, ctx5('auto'))).toMatchObject({ decision: 'ask', once: true, protectedBy: '.env' });
  expect(d5('Bash', { command: 'rm -rf build' }, 'auto')).toBe('deny');
  expect(d5('Bash', { command: 'cat ~/.ssh/id_rsa' }, 'auto')).toBe('deny'); // outside the project
  expect(d5('Bash', { command: 'npm publish' }, 'auto', { rules: { never: ['npm publish'] } })).toBe('deny');
  expect(d5('WebSearch', { query: 'x' }, 'auto')).toBe('check');
  expect(d5('WebFetch', { url: 'https://example.org/' }, 'auto', { rules: { allow: ['WebFetch(example.org)'] } })).toBe('allow');
  expect(judge('Bash', { command: 'npm install left-pad' }, ctx5('auto')).why).toBe('Auto: no rule covers it, so the model checks it first');
});

test('Bypass permissions: nothing asks, but the blocked commands, the folder fence, your never-list and the app\'s own settings hold', () => {
  for (const c of ['npm install left-pad', 'git commit -m x', 'cp x .env', 'node build.mjs > out.txt']) expect(d5('Bash', { command: c }, 'bypass')).toBe('allow');
  expect(d5('Write', { path: '.env' }, 'bypass', { rel: '.env' })).toBe('allow');
  expect(d5('Edit', { path: 'src/a.js' }, 'bypass')).toBe('allow');
  for (const c of ['rm -rf build', 'sudo ls', 'git push', 'pkill node', 'cat ~/.ssh/id_rsa']) expect(d5('Bash', { command: c }, 'bypass')).toBe('deny');
  expect(d5('Bash', { command: 'npm publish' }, 'bypass', { rules: { never: ['npm publish'] } })).toBe('deny');
  expect(decide('Write', { path: '.agentic/settings.json' }, ctx5('bypass', { rel: '.agentic/settings.json' }))).toEqual({ decision: 'deny', reason: ".agentic/settings.json holds Agentic Coder's own settings and rules, which the model never changes, even in Bypass permissions" });
  expect(d5('Bash', { command: 'cp x .agentic-coder/permissions.json' }, 'bypass')).toBe('deny');
  expect(d5('Bash', { command: 'cat .agentic/settings.json' }, 'bypass')).toBe('allow'); // reading one is fine
  expect(d5('Edit', { path: '../x.js' }, 'bypass', { inside: false })).toBe('deny');
  expect(d5('WebFetch', { url: 'https://example.org/' }, 'bypass')).toBe('allow');
  expect(d5('Edit', { path: 'a.js' }, 'plan')).toBe('deny'); // plan is unchanged
});

test('Screen: each app asks once in every mode but Bypass; this session or a saved rule lets it look; never holds everywhere', () => {
  for (const m of ['auto', 'ask', 'edits', 'plan']) expect(decide('Screen', { app: 'TextEdit' }, ctx5(m))).toEqual({ decision: 'ask', rule: 'Screen(TextEdit)' });
  expect(decide('Screen', {}, ctx5('ask'))).toEqual({ decision: 'ask', rule: 'Screen(whole screen)' });
  expect(d5('Screen', { app: 'TextEdit' }, 'bypass')).toBe('allow');
  expect(d5('Screen', { app: 'textedit' }, 'ask', { allowedPrefixes: new Set(['Screen(TextEdit)']) })).toBe('allow'); // its name in any case
  expect(d5('Screen', { app: 'Safari' }, 'ask', { allowedPrefixes: new Set(['Screen(TextEdit)']) })).toBe('ask'); // another app asks
  expect(d5('Screen', { app: 'Mail' }, 'auto', { rules: { allow: ['Screen(Mail)'] } })).toBe('allow');
  expect(d5('Screen', { app: 'Mail' }, 'bypass', { rules: { never: ['Screen(Mail)'] } })).toBe('deny');
  expect(checkRule('allow', 'Screen(Safari)')).toEqual({ rule: 'Screen(Safari)' });
  expect(checkRule('never', 'screen(whole screen)')).toEqual({ rule: 'Screen(whole screen)' });
});

test('the screen question: this time, for this session, always (saved), no', async () => {
  const { permissionOptions } = await import('../src/app/screen.jsx');
  expect(permissionOptions({ name: 'Screen', rule: 'Screen(Mail)' }, 'Screen(Mail)').map((o) => [o.label, o.choice])).toEqual([['This time', 'yes'], ['For this session', 'always'], ['Always (saved for this folder)', 'save'], ['No (esc)', 'no']]);
});

// ---- MCP tools (agent/mcp.mjs): asked before first use; "reads" is the user's mark, never the server's ----

const mcpTool = (more = {}) => ({ server: 'github', tool: 'create_issue', reads: false, changed: false, ...more });
const dm = (mode, mcp, ctx = {}) => judge('mcp__github__create_issue', { title: 'x' }, { mode, mcp, ...ctx });

test('an MCP tool asks before its first use in every mode but Bypass, and plan mode refuses one that is not marked as reading', () => {
  for (const mode of ['ask', 'edits', 'auto']) expect(dm(mode, mcpTool())).toMatchObject({ decision: 'ask', rule: 'Mcp(github:create_issue)' });
  expect(dm('plan', mcpTool())).toMatchObject({ decision: 'deny' });
  expect(dm('plan', mcpTool()).reason).toContain('not one you marked as only reading');
  expect(dm('bypass', mcpTool()).decision).toBe('allow');
  // The gateway tool is judged the same way, by the tool it reaches.
  expect(judge('Mcp', { tool: 'mcp__github__create_issue' }, { mode: 'ask', mcp: mcpTool() }).decision).toBe('ask');
  // A call the app could not match to a tool is turned away, whatever the mode.
  expect(judge('mcp__nope__x', {}, { mode: 'bypass' }).decision).toBe('deny');
});

test('a tool you marked as reading: asked once in Manual, let through in Auto and in plan mode once allowed', () => {
  const reads = mcpTool({ tool: 'get_issue', reads: true });
  expect(dm('ask', reads)).toMatchObject({ decision: 'ask', rule: 'Mcp(github:get_issue)' });
  expect(dm('auto', reads).decision).toBe('allow');
  expect(dm('plan', reads).decision).toBe('ask');
  expect(dm('plan', reads, { allowedPrefixes: new Set(['Mcp(github:get_issue)']) }).decision).toBe('allow');
});

test('a rule allows one MCP tool, for the session or saved; the never-list holds in every mode, Bypass too', () => {
  const rule = 'Mcp(github:create_issue)';
  expect(dm('ask', mcpTool(), { allowedPrefixes: new Set([rule]) })).toMatchObject({ decision: 'allow', why: `"${rule}" is allowed (this session)` });
  expect(dm('edits', mcpTool(), { rules: { allow: [rule] } })).toMatchObject({ decision: 'allow', why: `"${rule}" is allowed (saved)` });
  // Allowed, but plan mode still refuses a tool that is not marked as reading.
  expect(dm('plan', mcpTool(), { rules: { allow: [rule] } }).decision).toBe('deny');
  for (const mode of MODES) {
    expect(dm(mode, mcpTool(), { rules: { never: [rule] }, allowedPrefixes: new Set([rule]) }).decision).toBe('deny');
    expect(dm(mode, mcpTool(), { rules: { never: ['Mcp(github:*)'] } }).reason).toContain('Mcp(github:*)');
  }
  // Another server's star does not reach this one.
  expect(dm('bypass', mcpTool(), { rules: { never: ['Mcp(gitlab:*)'] } }).decision).toBe('allow');
});

test('a tool that changed since you allowed it asks again, and says so', () => {
  const rule = 'Mcp(github:create_issue)';
  const changed = mcpTool({ changed: true });
  expect(dm('ask', changed, { rules: { allow: [rule] } })).toMatchObject({ decision: 'ask', changed: true, why: 'the tool changed since you allowed it' });
  expect(dm('auto', mcpTool({ reads: false, changed: true }), { allowedPrefixes: new Set([rule]) }).decision).toBe('ask');
  expect(dm('bypass', changed).why).toContain('the tool changed since you allowed it');
});

test('an MCP rule as /permissions takes it: one tool to allow, a whole server only to block', () => {
  expect(checkRule('allow', 'Mcp(github:create_issue)')).toEqual({ rule: 'Mcp(github:create_issue)' });
  expect(checkRule('allow', 'mcp(shop:notes.link)')).toEqual({ rule: 'Mcp(shop:notes.link)' });
  expect(checkRule('never', 'Mcp(github:*)')).toEqual({ rule: 'Mcp(github:*)' });
  expect(checkRule('allow', 'Mcp(github:*)').error).toContain('Allow one tool at a time');
  expect(checkRule('allow', 'Mcp(github)').error).toContain('Mcp(github:create_issue)');
});

test('a project\'s MCP file is protected: a change to it always asks, and Bypass refuses it', () => {
  expect(protectedBy('.agentic/mcp.json')).toBe('.agentic/mcp.json');
  expect(decide('Write', { path: '.agentic/mcp.json' }, { mode: 'edits', rel: '.agentic/mcp.json' })).toMatchObject({ decision: 'ask', once: true });
  expect(decide('Write', { path: '.agentic/mcp.json' }, { mode: 'auto', rel: '.agentic/mcp.json' }).decision).toBe('ask');
  expect(decide('Edit', { path: '.agentic/mcp.json' }, { mode: 'bypass', rel: '.agentic/mcp.json' }).decision).toBe('deny');
  expect(decide('Bash', { command: 'echo "{}" > .agentic/mcp.json' }, { mode: 'bypass', cwd: '/tmp/x' }).decision).toBe('deny');
});

test('a command that runs tests: a runner, the project\'s test command or the check, never a read of a test file', () => {
  for (const c of ['npm test', 'npm run test:unit -- --watch=false', 'bun test ./terminal/test/a.test.mjs', 'bun run test', 'yarn test', 'npx jest src', 'npx vitest run', 'node --test', 'node --test test/', 'node export.test.mjs',
    'pytest -q', 'python3 -m pytest tests/test_calc.py::test_add', 'python tests/test_calc.py', 'python -m unittest discover', 'cargo test', 'go test ./...', 'make test', 'rspec spec/a_spec.rb',
    'cd web && npm test', 'CI=1 npm test', 'timeout 60 bun test', 'bun test 2>&1 | tail -20', '(cd api; pytest)'])
    expect([c, runsTests(c)]).toEqual([c, true]);
  for (const c of ['cat export.test.mjs', 'grep -n "toCsv" export.test.mjs', 'grep -rn foo test/', 'ls terminal/test', 'sed -n 1,40p tests/test_calc.py', 'git diff --stat test/', 'head -20 test/a.test.js',
    'cat latest.log', 'npm run build', 'npm install --save-dev vitest', 'echo test', 'rg attestation src', 'node scripts/build.mjs', 'pytest.ini', 'vim test/a.js'])
    expect([c, runsTests(c)]).toEqual([c, false]);
  // The project's own command and the check this message named count with whatever follows them.
  expect(runsTests('./scripts/check-all.sh --fast', { testCmd: './scripts/check-all.sh' })).toBe(true);
  expect(runsTests('node check-page.mjs', { check: 'node check-page.mjs' })).toBe(true);
  expect(runsTests('cat check-page.mjs', { check: 'node check-page.mjs' })).toBe(false);
  // Piped on into another command: that command's exit code stands for the line.
  expect(testRunOf('bun test 2>&1 | tail -20')).toEqual({ piped: true });
  expect(testRunOf('npm test || echo failed')).toEqual({ piped: false });
  expect(testRunOf('cd web && npm test')).toEqual({ piped: false });
  expect(splitCommand('npm test && ls | head; echo hi').seps).toEqual(['&&', '|', ';']);
});
