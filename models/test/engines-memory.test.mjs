// The engines each model runs on, the check for a context you picked, and
// finding another copy of the model already loaded (28 Sep 2026).
import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { ENGINES, DEFAULT_ENGINE, ENGINE, SERVER_BIN, engineOf, serverBinOf, MODELS, DEFAULT_MODEL, HOME, modelPath, EMBEDDERS, DEFAULT_EMBEDDER, RERANKERS, DEFAULT_RERANKER } from '../registry.mjs';
import { contextCheck, needBytes, freeWithHandBack, freeAfterQuit, loadedBytesOf, searchBytes, appName, topMemoryUsers } from '../runtime/memory.mjs';
import { otherCopies, serverProcesses } from '../runtime/server.mjs';
import bonsai from '../bonsai-2-27b/model.mjs';

const gemma = MODELS[DEFAULT_MODEL];

test('each model runs on its engine: Bonsai on Prism, the others on the default; AGENTIC_ENGINE picks one for all but Bonsai', () => {
  expect(engineOf(bonsai).id).toBe('prism');
  expect(engineOf(gemma).id).toBe(gemma.engine ?? DEFAULT_ENGINE);
  expect(serverBinOf(bonsai)).toBe(join(HOME, 'engine', ENGINES.prism.tag, 'llama-server'));
  expect(ENGINE).toBe(engineOf(gemma));
  expect(SERVER_BIN).toBe(serverBinOf(gemma));
  const was = process.env.AGENTIC_ENGINE;
  try {
    process.env.AGENTIC_ENGINE = 'official';
    expect(engineOf(gemma).id).toBe('official');
    expect(engineOf(bonsai).id).toBe('prism'); // its ternary file runs on Prism's only (engineOnly)
    process.env.AGENTIC_ENGINE = 'nonsense'; // an unknown name is ignored
    expect(engineOf(gemma).id).toBe(gemma.engine ?? DEFAULT_ENGINE);
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
  expect(short.note).toBe(`Context 64k needs ${gb(need)} GB and 2.8 GB is free: the Mac may slow down. Using the most: Google Chrome 2.3 GB · Safari 1.1 GB. Close some, or lower it in /effort.`);
  // The speed helper counts when it comes along.
  expect(contextCheck(gemma, 65536, { draft: true, available: 0, users: [] }).need).toBeGreaterThan(need);
});

test('a restart counts what the running server gives back as free; the search models still to load count as needed (29 Sep)', () => {
  const gb = (b) => (b / 1e9).toFixed(1);
  // Counted before the old server stops: free now + what its start took.
  const back = freeWithHandBack(gemma, 65536, { draft: true, available: 3.9e9 });
  expect(back).toBeCloseTo(3.9e9 + needBytes(gemma, 65536, { draft: true }), -3);
  // So going down from 64k to 32k never warns, whatever else is open.
  expect(contextCheck(gemma, 32768, { draft: true, available: back, users: [] }).fits).toBe(true);
  // The embedder and the reranker, at what each holds while loaded; one already loaded is not counted again.
  const bge = EMBEDDERS[DEFAULT_EMBEDDER], rr = RERANKERS[DEFAULT_RERANKER];
  expect([loadedBytesOf(bge), loadedBytesOf(rr)]).toEqual([1.1e9, 1.2e9]);
  expect(searchBytes([bge, rr], () => false)).toBeCloseTo(2.3e9, -3);
  expect(searchBytes([bge, rr], (m) => m === bge)).toBe(1.2e9);
  expect(searchBytes([], () => false)).toBe(0);
  const need = needBytes(gemma, 65536, { draft: false });
  const short = contextCheck(gemma, 65536, { draft: false, available: need + 1e9, search: 2.3e9, users: [] });
  expect(short).toMatchObject({ fits: false, need: need + 2.3e9 });
  expect(short.note).toBe(`Context 64k needs ${gb(need + 2.3e9)} GB (2.3 for search) and ${gb(need + 1e9)} GB is free: the Mac may slow down. Close some, or lower it in /effort.`);
  expect(contextCheck(gemma, 65536, { draft: false, available: need + 3e9, search: 2.3e9 }).note).toBe(`Context 64k: needs ${gb(need + 2.3e9)} GB (2.3 for search), ${gb(need + 3e9)} GB free.`);
});

test('what a start takes: the share of the model files macOS keeps in use (measured for Gemma), all of an unmeasured model\'s', () => {
  expect(gemma.fileInUse).toBe(0.55);
  const whole = { ...gemma, fileInUse: undefined };
  expect(needBytes(whole, 65536, { draft: true }) - needBytes(gemma, 65536, { draft: true })).toBeCloseTo((gemma.bytes + gemma.draft.bytes) * 0.45, -6);
  // Measured 28 Sep with the app's flags and both slots: the free memory dropped
  // 5.3 GB at 64k and 4.5 GB at 32k (the helper on). The estimate stays above
  // that, and well under the whole files' 9.8 GB, which warned with 8 GB free
  // while the start caused no memory pressure.
  expect(needBytes(gemma, 65536, { draft: true }) / 1e9).toBeGreaterThan(5.3);
  expect(needBytes(gemma, 32768, { draft: true }) / 1e9).toBeGreaterThan(4.5);
  expect(needBytes(gemma, 65536, { draft: true }) / 1e9).toBeLessThan(7);
  // a model not measured counts its whole file, as before
  expect(needBytes(bonsai, 32768, { draft: false })).toBe(needBytes({ ...bonsai, fileInUse: 1 }, 32768, { draft: false }));
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

// 29 Sep, 22:02: a window waited for another Qwen3.5 9B copy; that copy and two search servers
// (8.6 GB) were stopped, the window loaded at once, read 4.8 GB free and warned, pressure green.
test('a start that waited for other copies counts what the servers that quit held as free', () => {
  const ps = [
    '  100  2000 /bin/zsh',
    '60605 7541648 /x/engine/t/llama-server -m /x/models/Qwen3.5-9B-MTP-UD-Q5_K_XL.gguf --port 17600 -c 32768',
    '68794  317216 /x/engine/t/llama-server -m /x/models/bge-m3-Q8_0.gguf --port 17601 --embedding',
    '69389  845584 /x/engine/t/llama-server -m /x/models/qwen3-reranker-0.6b-q8_0.gguf --port 17602 --rerank',
    '  700      40 grep llama-server',
    '  800     900 /x/llama-server-helper --watch',
  ].join('\n');
  // the last look while they still ran (every 3 s while it waits): 2.4 GB free
  const before = { free: 2.4e9, servers: serverProcesses({ psText: ps }) };
  // every model server, whatever its model; not a grep that names one, nor another program
  expect(before.servers.map((s) => s.pid)).toEqual([60605, 68794, 69389]);
  expect(before.servers[0].bytes).toBe(7541648 * 1024);
  const held = (7541648 + 317216 + 845584) * 1024;
  // all three quit: what was free while they ran, plus what they held (8.9 GB): 64k with search fits
  const free = freeAfterQuit(before, []);
  expect(free).toBe(2.4e9 + held);
  const qwen = MODELS.qwen ?? gemma;
  expect(contextCheck(qwen, 65536, { draft: true, available: free, users: [], search: 2.3e9 }).fits).toBe(true);
  // only the copy quit: only its memory comes back; none quit, or nothing looked at: 0 (the check reads the Mac as it is)
  expect(freeAfterQuit(before, before.servers.filter((s) => s.pid !== 60605))).toBe(2.4e9 + 7541648 * 1024);
  expect(freeAfterQuit(before, before.servers)).toBe(0);
  expect(freeAfterQuit({ free: 1e9, servers: [] }, [])).toBe(0);
  expect(freeAfterQuit(null, [])).toBe(0);
});
