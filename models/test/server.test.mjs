import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs in its own process with its own BONSAI_HOME: the server module reads
// the home folder when it loads, and this test must never see the real one
// (an earlier version of it stopped a real model server).
test('a second window shares a live server; a left-over one is stopped', () => {
  const home = mkdtempSync(join(tmpdir(), 'bonsai-srv-'));
  const script = `
    import { spawn } from 'node:child_process';
    import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    const { HOME } = await import(${JSON.stringify(join(import.meta.dir, '../registry.mjs'))});
    if (HOME !== process.env.BONSAI_HOME) { console.log(JSON.stringify({ error: 'wrong home ' + HOME })); process.exit(1); }
    const { scanServers } = await import(${JSON.stringify(join(import.meta.dir, '../runtime/server.mjs'))});
    const reg = join(HOME, 'servers');
    mkdirSync(reg, { recursive: true });
    const orphan = spawn('sleep', ['30']);
    const shared = spawn('sleep', ['30']);
    const gone = spawn('true');
    await new Promise((r) => gone.on('exit', r));
    writeFileSync(join(reg, '17600.json'), JSON.stringify({ pid: shared.pid, owner: process.pid, port: 17600, ctx: 32768, model: 'm.gguf' }));
    writeFileSync(join(reg, '17601.json'), JSON.stringify({ pid: orphan.pid, owner: gone.pid, port: 17601, ctx: 32768, model: 'm.gguf' }));
    writeFileSync(join(reg, '17602.json'), JSON.stringify({ pid: gone.pid, owner: process.pid, port: 17602, ctx: 32768, model: 'm.gguf' }));
    const orphanExit = new Promise((r) => orphan.on('exit', (code, sig) => r(sig)));
    const live = scanServers().map((e) => e.port);
    const sig = await orphanExit;
    shared.kill();
    console.log(JSON.stringify({ live, sig, left: [17601, 17602].map((p) => existsSync(join(reg, p + '.json'))) }));
  `;
  const r = spawnSync('bun', ['-e', script], { env: { ...process.env, BONSAI_HOME: home }, encoding: 'utf8', timeout: 20000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  expect(out).toEqual({ live: [17600], sig: 'SIGTERM', left: [false, false] });
});
