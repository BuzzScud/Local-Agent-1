// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here: the
// web. The model reads a page (a stand-in site on this Mac): it asks first, and
// "don't ask again" holds for that site the rest of the session. /web picks a
// search service and takes its key (a stand-in service; a key file, not your
// Keychain); the model's search then asks first and its results go back to it.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

let site, siteUrl;
beforeAll(async () => {
  site = createServer((req, res) => {
    if (req.url.startsWith('/res/v1/web/search')) {
      if (req.headers['x-subscription-token'] !== 'test-brave-key-123456') { res.statusCode = 401; res.end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ web: { results: [{ title: 'Thing 4.2 released', url: `${siteUrl}/notes`, description: 'The notes for 4.2.' }] } }));
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/notes' ? '<html><head><title>Notes</title></head><body><main><h1>Thing 4.2</h1><p>The magic number is 8812.</p></main></body></html>' : '<html><body><p>The second page.</p></body></html>');
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  siteUrl = `http://127.0.0.1:${site.address().port}`;
});
afterAll(() => site?.close());

const told = (fake, word) => fake.requests.some((q) => JSON.stringify(q.messages ?? []).includes(word));

test('the model reads a page: it asks first (the site and the address shown); “don’t ask again” holds for that site; the page’s text goes back', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ tool: { name: 'WebFetch', args: { url: `${siteUrl}/notes` } } }, { tool: { name: 'WebFetch', args: { url: `${siteUrl}/other` } } }, { text: 'The number is 8812.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'what is the magic number on the notes page' }, { key: 'enter' },
    { wait: 'Read a web page' }, { sleep: 200 }, { snapshot: 'ask' }, { key: '2' },
    { wait: 'The number is 8812.' }, { sleep: 200 }, { snapshot: 'done' }, ...quit,
  ] });
  await fake.close();
  const ask = r.snapshots.ask.replace(/\s+/g, ' ');
  expect(ask).toContain(`${siteUrl}/notes`);
  expect(ask).toContain('Read this page from 127.0.0.1?');
  expect(ask).toContain("Yes, and don't ask again for 127.0.0.1 this session");
  expect(ask).toContain('Yes, and always allow 127.0.0.1 in this folder');
  // The second page of that site did not ask: nothing answered a second question, and both were read.
  // (two fetches in a row are one row: Tight rail, 8 Oct 2026)
  expect(r.snapshots.done).toMatch(/Fetched\s+http:\/\/127\.0\.0\.1:\d+\/notes, http:\/\/127\.0\.0\.1:\d+\/other/);
  expect(told(fake, 'The magic number is 8812.')).toBe(true);
  expect(told(fake, 'The second page.')).toBe(true);
  expect(fake.requests.find((q) => q.stream)?.tools.map((t) => t.function.name)).toContain('WebFetch');
  expect(fake.requests.find((q) => q.stream)?.tools.map((t) => t.function.name)).not.toContain('WebSearch'); // no search service yet
}, T);

test('/web: pick Brave Search, paste its key, Test with it, Save; then the model can search (asked first) and its results go back', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  const fake = await startFakeServer([{ text: 'Ready.' }, { tool: { name: 'WebSearch', args: { query: 'thing 4.2 notes' } } }, { text: 'Found the notes.' }]);
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_SEARCH_URL: siteUrl, AGENTIC_REMOTE_KEYSTORE: 'file' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: '/web' }, { key: 'enter' }, { wait: 'What the model may do on the web' },
    { key: 'right' }, { wait: 'Brave’s own web index' }, { key: 'down' }, { sleep: 200 }, { type: 'test-brave-key-123456' }, { sleep: 300 }, { key: 'enter' }, { wait: '••••3456' },
    { key: 'down' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: 'down' }, { sleep: 200 }, { key: 'enter' }, { wait: '✔ it works' }, { sleep: 200 }, { snapshot: 'tested' },
    { key: 'down' }, { sleep: 200 }, { key: 'enter' }, { wait: 'Web saved: search with Brave Search' },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Ready.' },
    { type: 'find the thing 4.2 notes' }, { key: 'enter' }, { wait: 'Web search' }, { sleep: 200 }, { snapshot: 'ask' }, { key: '1' },
    { wait: 'Found the notes.' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.tested.replace(/\s+/g, ' ')).toContain('1 result in');
  const ask = r.snapshots.ask.replace(/\s+/g, ' ');
  for (const line of ['Web search', '“thing 4.2 notes”', 'goes to Brave Search', 'Search the web for this?', "Yes, and don't ask again for web searches this session"]) expect(ask).toContain(line);
  const saved = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).web;
  expect(saved).toEqual({ search: 'brave', fetch: true, claude: true, keys: { brave: { end: '3456' } } });
  expect(JSON.stringify(saved)).not.toContain('test-brave-key'); // the key is not in settings.json
  expect(JSON.parse(readFileSync(join(home, 'remote-keys.json'), 'utf8'))['search-brave']).toBe('test-brave-key-123456');
  const searched = fake.requests.filter((q) => q.stream).at(-1);
  expect(searched.tools.map((t) => t.function.name)).toContain('WebSearch');
  expect(JSON.stringify(searched.messages)).toContain('Thing 4.2 released');
}, T);

test('a web address in the request comes with a line saying to read it with WebFetch; a Read of a web address is read as the page (asked about first)', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ tool: { name: 'Read', args: { path: `${siteUrl}/notes` } } }, { text: 'It says 8812.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: `what is the magic number on ${siteUrl}/notes please` }, { key: 'enter' },
    { wait: 'Read a web page' }, { key: '1' }, { wait: 'It says 8812.' }, ...quit,
  ] });
  await fake.close();
  const first = fake.requests.find((q) => q.stream);
  expect(JSON.stringify(first.messages)).toContain(`(The request names a web page (${siteUrl}/notes): read it with WebFetch. It is not a file in the project.)`);
  expect(told(fake, 'The magic number is 8812.')).toBe(true);
  expect(r.text).toMatch(/Fetched\s+http:\/\/127\.0\.0\.1:\d+\/notes/);
}, T);
