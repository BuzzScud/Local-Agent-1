import { test, expect } from 'bun:test';
import { blockedReason, decide, commandPrefix, outsidePath, isReadOnly } from '../src/agent/permissions.mjs';
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

test('"don\'t ask again" remembers the first two words', () => {
  expect(commandPrefix('node --test  --watch')).toBe('node --test');
  expect(decide('Bash', { command: 'node --test src' }, { mode: 'ask', allowedPrefixes: new Set(['node --test']) }).decision).toBe('allow');
});

test('commands stay inside the project folder', () => {
  const cwd = `${homedir()}/Desktop/bonsai-code/demo-project`;
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
