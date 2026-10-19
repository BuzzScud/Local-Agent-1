// ssh from a command (tools/ssh.mjs, 18 Oct 2026). The owner typed "log in to the server: ssh root@…, just
// run the command" in Bypass: the model argued for 42 s whether it might, then ran `ssh root@<server>`, which
// the fence stopped from reading ssh's own known_hosts, and blamed the server's key. Now a bare login is a
// login check that says how to go on, each way ssh fails says what to do or ask, and an agent with no key is
// given the Keychain's. The addresses are the documentation range's; the ssh here is a stand-in on PATH.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-ssh-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { usesSsh, destOf, sshLogin, loginAnswer, sshHint, sshNamed, sshNote, keysReady, forgetKeys, LOGIN_CHECK } = await import('../src/tools/ssh.mjs');
const { execute } = await import('../src/agent/tools.mjs');
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const HOST = 'root@203.0.113.9';

test('which commands are ssh\'s: the word anywhere, not ssh-add or ssh-keygen', () => {
  for (const c of [`ssh ${HOST}`, 'scp a.txt orbit:/tmp/', 'rsync -av ./x orbit:/srv/x', 'sftp orbit', 'ssh-copy-id orbit', 'cd x && ssh orbit ls', 'timeout 20 ssh orbit uptime', "sh -c 'ssh orbit uptime'", '/usr/bin/ssh orbit'])
    expect([c, usesSsh(c)]).toEqual([c, true]);
  for (const c of ['ssh-add -l', 'ssh-keygen -y -f k', 'echo sshd', 'grep -r sshfoo .', 'cat notes-ssh.md'])
    expect([c, usesSsh(c)]).toEqual([c, false]);
});

test('the server a command goes to, for the hints', () => {
  expect(destOf(`ssh ${HOST}`)).toBe(HOST);
  expect(destOf("ssh -p 2222 -o BatchMode=yes orbit 'ls'")).toBe('orbit');
  expect(destOf('ssh -vp2222 orbit uptime')).toBe('orbit');
  expect(destOf("cd x && ssh -i k orbit 'git status'")).toBe('orbit');
  expect(destOf(`scp a.txt ${HOST}:/tmp/`)).toBe(HOST);
  expect(destOf('rsync -av ./site orbit:/srv/site')).toBe('orbit');
  expect(destOf('ssh "$HOST" uptime')).toBe(null); // the shell would change it
});

test('a bare ssh is a login check with BatchMode first; anything to run there, a tunnel or a list runs as typed', () => {
  expect(sshLogin(`ssh ${HOST}`)).toEqual({ dest: HOST, command: `ssh -T -o BatchMode=yes -o ConnectTimeout=15 ${HOST} '${LOGIN_CHECK}'` });
  // A terminal is what it cannot have: -t goes, the other flags stay; an option's value goes with it.
  expect(sshLogin(`ssh -tt ${HOST}`).command).toBe(`ssh -T -o BatchMode=yes -o ConnectTimeout=15 ${HOST} '${LOGIN_CHECK}'`);
  expect(sshLogin('ssh -vt -p 2222 -i ./deploy orbit').command).toBe(`ssh -T -o BatchMode=yes -o ConnectTimeout=15 -v -p 2222 -i ./deploy orbit '${LOGIN_CHECK}'`);
  expect(sshLogin('ssh -vp2222 orbit').command).toBe(`ssh -T -o BatchMode=yes -o ConnectTimeout=15 -v -p 2222 orbit '${LOGIN_CHECK}'`);
  expect(sshLogin("ssh -o 'User=deploy' orbit").command).toBe(`ssh -T -o BatchMode=yes -o ConnectTimeout=15 -o User=deploy orbit '${LOGIN_CHECK}'`);
  for (const c of [`ssh ${HOST} uptime`, `ssh ${HOST} 'cd /srv && ls'`, 'ssh -N -L 9090:localhost:9090 orbit', 'ssh -f orbit', 'ssh -G orbit',
    `ssh ${HOST}; ls`, `ssh ${HOST} > out.txt`, 'ssh $HOST', 'ssh', 'ssh -p', `echo ssh ${HOST}`, `ssh ${HOST} &`])
    expect([c, sshLogin(c)]).toEqual([c, null]);
});

test('the login check answers who and where, and how to work there; a failed one answers nothing', () => {
  const login = sshLogin(`ssh ${HOST}`);
  const r = (lines, code = 0) => ({ code, timedOut: false, lines });
  const a = loginAnswer(login, r(['root\r', 'box\r', 'Linux 6.8.0\r', '/root\r']));
  expect(a.said).toBe(`Logged in to ${HOST}: root on box (Linux 6.8.0), home folder /root.`);
  expect(a.text).toContain('every Bash call starts on this Mac again');
  expect(a.text).toContain(`ssh ${HOST} 'cd <folder> && ls'`);
  // A banner before it: the last four lines are the check's.
  expect(loginAnswer(login, r(['Authorized use only.', 'root', 'box', 'Linux 6.8.0', '/root'])).said).toContain('root on box');
  expect(loginAnswer(login, r(['Host key verification failed.'], 255))).toBe(null);
  expect(loginAnswer(login, r(['root', 'box']))).toBe(null);
});

test('each way ssh fails says what to do, or what to ask', () => {
  const hint = (out, more = {}) => sshHint(out, { open: true, command: `ssh ${HOST} uptime`, ...more });
  expect(hint('ssh: connect to host 203.0.113.9 port 22: Operation not permitted', { open: false })).toContain('only in Bypass permissions');
  expect(hint('ssh: connect to host 203.0.113.9 port 22: Operation not permitted')).not.toContain('Bypass');
  expect(hint('@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nHost key verification failed.')).toContain('different key');
  expect(hint('Host key verification failed.')).toContain(`never connected to ${HOST}`);
  expect(hint('Host key verification failed.')).toContain(`! ssh -o StrictHostKeyChecking=accept-new ${HOST} true`);
  const locked = hint(`Load key "/Users/x/.ssh/id_ed25519": Operation not permitted\n${HOST}: Permission denied (publickey).`);
  expect(locked).toContain('not unlocked yet');
  expect(locked).toContain('Never ask for the passphrase');
  expect(hint(`${HOST}: Permission denied (publickey,password).`)).toContain('wants a password');
  expect(hint(`${HOST}: Permission denied (publickey).`)).toContain('turned down this Mac\'s key');
  expect(hint('ssh: Could not resolve hostname orbitt: nodename nor servname provided, or not known')).toContain('No computer goes by that name');
  expect(hint('ssh: connect to host 203.0.113.9 port 22: Operation timed out')).toContain('did not answer');
  expect(hint('all fine')).toBe('');
  expect(sshHint('Host key verification failed.', { command: 'cat log.txt' })).toBe('');
});

test('an agent with no key is given the Keychain\'s, once; one that holds a key is left alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-ssh-add-'));
  const stand = (listExit) => {
    const file = join(dir, `ssh-add-${listExit}`);
    writeFileSync(file, `#!/bin/sh\necho "$@" >> ${JSON.stringify(join(dir, `calls-${listExit}`))}\n[ "$1" = "-l" ] && exit ${listExit}\nexit 0\n`);
    chmodSync(file, 0o755);
    return file;
  };
  const calls = (n) => readFileSync(join(dir, `calls-${n}`), 'utf8').trim().split('\n');
  if (process.platform !== 'darwin') return;
  forgetKeys();
  expect(await keysReady({ sshAdd: stand(1), on: true })).toBe(true);
  expect(calls(1)).toEqual(['-l', '--apple-load-keychain']);
  expect(await keysReady({ sshAdd: stand(1), on: true })).toBe(false); // tried once already
  forgetKeys();
  expect(await keysReady({ sshAdd: stand(0), on: true })).toBe(false);
  expect(calls(0)).toEqual(['-l']);
  forgetKeys();
  expect(await keysReady({ sshAdd: stand(2) })).toBe(false); // off in the tests (test-env.mjs)
});

// The Bash tool with a stand-in ssh on PATH: what it was given, and what the model is told.
const bin = mkdtempSync(join(tmpdir(), 'agentic-ssh-bin-'));
writeFileSync(join(bin, 'ssh'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${JSON.stringify(join(bin, 'args.txt'))}\ncat ${JSON.stringify(join(bin, 'reply.txt'))}\nexit $(cat ${JSON.stringify(join(bin, 'code.txt'))})\n`);
chmodSync(join(bin, 'ssh'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
const reply = (text, code = 0) => { writeFileSync(join(bin, 'reply.txt'), text); writeFileSync(join(bin, 'code.txt'), String(code)); };
const given = () => readFileSync(join(bin, 'args.txt'), 'utf8').trim().split('\n');
const bash = (command, mode = 'bypass') => execute('Bash', { command }, {}, { cwd: mkdtempSync(join(tmpdir(), 'agentic-ssh-proj-')), permissionsNow: () => ({ mode }), bash: { maxLines: 80 } });

test('Bash: a bare ssh logs in, says so, and says every command goes through ssh', async () => {
  reply('root\nbox\nLinux 6.8.0\n/root\n');
  const r = await bash(`ssh ${HOST}`);
  expect(given()).toEqual(['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST, LOGIN_CHECK]);
  expect(r.text.split('\n')[0]).toBe(`Logged in to ${HOST}: root on box (Linux 6.8.0), home folder /root.`);
  expect(r.text).toContain('Nothing stays open between commands');
  expect(r.view).toMatchObject({ kind: 'bash', code: 0, lines: [`Logged in to ${HOST}: root on box (Linux 6.8.0), home folder /root.`] });
  expect(r.error).toBeFalsy();
});

test('Bash: a command for the server runs as typed; a failed login comes back with what to do', async () => {
  reply(' 10:00:01 up 12 days\n');
  const r = await bash(`ssh ${HOST} 'uptime'`);
  expect(given()).toEqual([HOST, 'uptime']);
  expect(r.text).toBe(' 10:00:01 up 12 days');
  reply('Host key verification failed.\n', 255);
  const f = await bash(`ssh ${HOST}`);
  expect(f.error).toBe(true);
  expect(f.text).not.toContain('Logged in');
  expect(f.text).toContain(`This Mac has never connected to ${HOST}`);
  // Outside Bypass the network is closed: the hint says where it opens.
  reply('ssh: connect to host 203.0.113.9 port 22: Operation not permitted\n', 255);
  expect((await bash(`ssh ${HOST} uptime`, 'ask')).text).toContain('only in Bypass permissions');
});

test('a server the request names as an ssh command, and the line that goes with it', () => {
  expect(sshNamed(`log in to the server: ssh ${HOST}, just run the command. the mac should go once you enter that into the terminal`)).toBe(HOST);
  expect(sshNamed('ssh -p 2222 deploy@box.example.')).toBe('deploy@box.example');
  expect(sshNamed('run `ssh 203.0.113.9 uptime`')).toBe('203.0.113.9');
  for (const t of ['can you ssh into it?', 'the ssh key is on my Mac', 'fix the ssh-config parser', 'ssh orbit']) expect([t, sshNamed(t)]).toEqual([t, null]);
  expect(sshNote(HOST, { open: true })).toContain(`run ssh with Bash, as typed. ssh ${HOST} alone checks the login`);
  expect(sshNote(HOST, { open: true })).toContain('never ask for a password');
  expect(sshNote(HOST)).toContain('only in Bypass permissions');
});

// The run of 18 Oct 2026 on Qwen3.6, in Bypass, after the fence was fixed: thinking cut at 4.1k, then this reply.
const SAID_NOT_RUN = `I'll run the SSH command to connect to the server.\n\n\`\`\`bash\nssh ${HOST}\n\`\`\`\n\nYou'll be prompted to enter your password. Once connected, you'll be logged into the remote server as the root user.`;
const service = { ...MODELS[DEFAULT_MODEL], remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' }, replyTokens: 8192 };
const agentOn = (url, cwd, o = {}) => new Agent({ url, model: service, cwd, system: systemPrompt({ cwd, git: 'none' }), thinking: false, ctx: 131072, mode: 'bypass', flows: false, confirmPlan: false, memory: false, way: 'model', hooks: ['next-step'], ask: async () => ({ choice: 'yes' }), ...o });
const ASK = `log in to the server: ssh ${HOST}, just run the command. the mac should go once you enter that into the terminal`;

test('in Bypass the request carries the line, and an answer that never ran ssh goes back once to run it', async () => {
  reply('root\nbox\nLinux 6.8.0\n/root\n');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-ssh-agent-'));
  const fake = await startFakeServer([{ text: SAID_NOT_RUN }, { tool: { name: 'Bash', args: { command: `ssh ${HOST}` } } }, { text: 'Logged in to the server as root.' }]);
  const notes = [];
  const a = agentOn(fake.url, cwd);
  a.on('note', (e) => notes.push(e.text));
  expect(await a.send(ASK)).toBe('done');
  await fake.close();
  const first = fake.requests[0].messages.findLast((m) => m.role === 'user').content;
  expect(first).toContain(`The request names a server (${HOST}), and commands reach it from here`);
  expect(first).toContain("ssh, scp and rsync log in to servers with this Mac's saved keys");
  expect(fake.requests).toHaveLength(3);
  expect(fake.requests[1].messages.at(-1).content).toContain('You answered without running anything');
  expect(notes).toContain(`It answered without running ssh to ${HOST}; told it to run it.`);
  expect(JSON.stringify(fake.requests[2].messages)).toContain(`Logged in to ${HOST}: root on box`);
});

// The owner's window at 8:09 PM the same day (Qwen3.6, Bypass, "log in to the server: ssh <host>"): an answer that
// ends with a question to the user ended the message before the send-back above was looked at, so nothing ran.
const ASKED_NOT_RUN = `I can't maintain an interactive SSH session, but I can run commands on that server for you. Just tell me what you'd like to do, and I'll run it like this:\n\n\`\`\`\nssh ${HOST} '<your command>'\n\`\`\`\n\nFor example, if you want to check the server status, I can run:\n\n\`\`\`\nssh ${HOST} 'uptime; df -h; free -m'\n\`\`\`\n\nWhat would you like to do on the server?`;
test('an answer that asks what to do on the server before running ssh goes back to run it first', async () => {
  reply('root\nbox\nLinux 6.8.0\n/root\n');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-ssh-agent-'));
  const fake = await startFakeServer([{ text: ASKED_NOT_RUN }, { tool: { name: 'Bash', args: { command: `ssh ${HOST}` } } }, { text: 'Logged in to the server as root. What would you like to do there?' }]);
  const notes = [];
  const a = agentOn(fake.url, cwd);
  a.on('note', (e) => notes.push(e.text));
  expect(await a.send(`log in to the server: ssh ${HOST}`)).toBe('done');
  await fake.close();
  expect(fake.requests).toHaveLength(3);
  expect(fake.requests[1].messages.at(-1).content).toContain('You answered without running anything');
  expect(notes).toContain(`It answered without running ssh to ${HOST}; told it to run it.`);
  expect(JSON.stringify(fake.requests[2].messages)).toContain(`Logged in to ${HOST}: root on box`);
});

test('an answer that ran ssh is let through; outside Bypass the line says where it would run, and nothing goes back', async () => {
  reply('root\nbox\nLinux 6.8.0\n/root\n');
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-ssh-agent-'));
  const ran = await startFakeServer([{ tool: { name: 'Bash', args: { command: `ssh ${HOST}` } } }, { text: 'Logged in.' }]);
  await agentOn(ran.url, cwd).send(ASK);
  await ran.close();
  expect(ran.requests).toHaveLength(2);
  const manual = await startFakeServer([{ text: 'Commands reach other computers only in Bypass permissions: turn it on with /mode bypass.' }]);
  await agentOn(manual.url, cwd, { mode: 'ask' }).send(ASK);
  await manual.close();
  expect(manual.requests).toHaveLength(1);
  expect(manual.requests[0].messages.findLast((m) => m.role === 'user').content).toContain('Commands reach other computers only in Bypass permissions');
});
