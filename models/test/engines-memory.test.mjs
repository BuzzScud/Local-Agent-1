// The engines each model runs on, the check for a context you picked, and
// finding another copy of the model already loaded (28 Sep 2026).
import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { ENGINES, DEFAULT_ENGINE, ENGINE, SERVER_BIN, engineOf, serverBinOf, MODELS, DEFAULT_MODEL, HOME, modelPath } from '../registry.mjs';
import { contextCheck, needBytes, appName, topMemoryUsers } from '../runtime/memory.mjs';
import { otherCopies } from '../runtime/server.mjs';
import bonsai from '../bonsai-2-27b/model.mjs';

const gemma = MODELS[DEFAULT_MODEL];

test('each model runs on its engine: Bonsai on Prism, the others on the default; AGENTIC_ENGINE picks one for all', () => {
  expect(engineOf(bonsai).id).toBe('prism');
  expect(engineOf(gemma).id).toBe(gemma.engine ?? DEFAULT_ENGINE);
  expect(serverBinOf(bonsai)).toBe(join(HOME, 'engine', ENGINES.prism.tag, 'llama-server'));
  expect(ENGINE).toBe(engineOf(gemma));
  expect(SERVER_BIN).toBe(serverBinOf(gemma));
  const was = process.env.AGENTIC_ENGINE;
  try {
    process.env.AGENTIC_ENGINE = 'official';
    expect(engineOf(bonsai).id).toBe('official');
    process.env.AGENTIC_ENGINE = 'nonsense'; // an unknown name is ignored
    expect(engineOf(bonsai).id).toBe('prism');
  } finally {
    if (was === undefined) delete process.env.AGENTIC_ENGINE; else process.env.AGENTIC_ENGINE = was;
  }
  // Only Prism's build carries our patch; each engine has its own folder.
  expect(ENGINES.official).toMatchObject({ patch: false, repo: 'https://github.com/ggml-org/llama.cpp.git' });
  expect(ENGINES.prism).toMatchObject({ patch: true, repo: 'https://github.com/PrismML-Eng/llama.cpp.git' });
  expect(ENGINES.official.tag).not.toBe(ENGINES.prism.tag);
  for (const e of Object.values(ENGINES)) expect(e.commit).toMatch(/^[0-9a-f]{40}$/);
});

test('a context you picked is checked: it fits, or the note says by how much and names what uses the memory', () => {
  const need = needBytes(gemma, 65536, { draft: false });
  const gb = (b) => (b / 1e9).toFixed(1);
  const ok = contextCheck(gemma, 65536, { draft: false, available: need + 1e9 });
  expect(ok).toMatchObject({ fits: true, need });
  expect(ok.note).toBe(`Context 64k: needs ${gb(need)} GB, ${gb(need + 1e9)} GB free.`);
  const short = contextCheck(gemma, 65536, { draft: false, available: 2.8e9, users: [{ name: 'Google Chrome', bytes: 2.3e9 }, { name: 'Safari', bytes: 1.1e9 }] });
  expect(short.fits).toBe(false);
  expect(short.note).toBe(`Context 64k needs ${gb(need)} GB and 2.8 GB is free: the Mac may slow down. Using the most: Google Chrome 2.3 GB · Safari 1.1 GB. Close some, or lower it in /increase.`);
  // The speed helper counts when it comes along.
  expect(contextCheck(gemma, 65536, { draft: true, available: 0, users: [] }).need).toBeGreaterThan(need);
});

test("what uses the most memory, by app: a browser's helpers count as the browser", () => {
  expect(appName('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)')).toBe('Google Chrome');
  expect(appName('/usr/local/bin/node')).toBe('node');
  const ps = [
    ' 1048576 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ' 2097152 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)',
    ' 1572864 /Applications/Safari.app/Contents/MacOS/Safari',
    ' 7000000 /Users/x/.agentic-coder/engine/llama-v0.5.0-7fe450e/llama-server',
    ' 524288 node',
  ].join('\n');
  expect(topMemoryUsers(3, ps)).toEqual([
    { name: 'model servers', bytes: 7000000 * 1024 },
    { name: 'Google Chrome', bytes: 3145728 * 1024 },
    { name: 'Safari', bytes: 1572864 * 1024 },
  ]);
});

test('another copy of the model: found by its whole path, apart from the servers app windows share, with who started it', () => {
  const file = modelPath(gemma);
  const ps = [
    '  100     1    10 /sbin/launchd',
    '  200   100    20 node models/evals/bench/run.mjs --model gemma',
    `  201   200 7000000 /x/engine/t/llama-server -m ${file} --port 17602 -c 32768`,
    '  300   100    30 node probe.mjs mtp-n1',
    `  301   300 7000000 /x/engine/t/llama-server -m ${file} --port 17650`,
    '  350   100    30 bun /x/terminal/src/cli.jsx -p fix the bug',
    `  351   350 7000000 /x/engine/t/llama-server -m ${file} --port 17603`,
    `  360   100 7000000 /x/engine/t/llama-server -m ${file} --port 17604`,
    // an app window's, kept loaded: shared as before, so not listed
    `  400   100 7000000 /x/engine/t/llama-server -m ${file} --port 17600`,
    // another model, and the same file name in another home (a test's)
    '  500   100 600000 /x/engine/t/llama-server -m /x/models/bge-m3-Q8_0.gguf --port 17601',
    `  600   100 7000000 /y/llama-server -m /tmp/other-home/models/${gemma.file} --port 17700`,
    // not a model server, only naming the file
    `  700   100    40 grep ${file}`,
  ].join('\n');
  const got = otherCopies(gemma, { psText: ps, live: [{ pid: 400, port: 17600, linger: 1800 }] });
  const b = 7000000 * 1024;
  expect(got).toEqual([
    { pid: 201, port: 17602, who: 'a practice-test run', bytes: b },
    { pid: 301, port: 17650, who: 'a speed test', bytes: b },
    { pid: 351, port: 17603, who: 'a coding -p run', bytes: b },
    { pid: 360, port: 17604, who: 'another program', bytes: b },
  ]);
});
