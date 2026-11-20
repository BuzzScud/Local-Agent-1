// hearth's tools with hearth's key (src/app/hearth-tools.mjs; 20 Nov 2026, the owner's pick "Add it, and bring hearth's
// tools"): hearth's API key is its model only, so its own tools are its /mcp, signed in to, offered after a switch to
// hearth, and the account box's rows for hearth. The box itself in a browser: window-page.test.mjs.
import { test, expect } from 'bun:test';

const H = await import('../src/app/hearth-tools.mjs');
const { HEARTH_ADDRESS } = await import('../../models/index.mjs');

test('hearth\'s tools are its /mcp on the same site as its API, signed in to', () => {
  expect(H.hearthMcpUrl(HEARTH_ADDRESS)).toBe('https://employee.hearth.monster/mcp');
  expect(H.hearthMcpUrl('https://hearth.example/door/v1')).toBe('https://hearth.example/mcp');
  expect(H.hearthMcpUrl('not an address')).toBe(null);
  const s = H.hearthToolsServer([]);
  expect({ name: s.name, runs: s.runs, url: s.url, auth: s.auth, from: s.from }).toEqual({ name: 'hearth', runs: 'address', url: 'https://employee.hearth.monster/mcp', auth: 'oauth', from: 'you' });
  // a server of yours already named hearth (another one) keeps its name
  expect(H.hearthToolsServer([{ name: 'hearth', runs: 'command' }]).name).toBe('hearth-tools');
});

test('a server of yours at hearth\'s /mcp is found by its address, whatever its name, with or without a last slash', () => {
  const mine = { name: 'work', runs: 'address', url: 'https://employee.hearth.monster/mcp/' };
  expect(H.hearthServerIn([{ name: 'gh', runs: 'address', url: 'https://api.github.com/mcp' }, mine])).toBe(mine);
  expect(H.hearthServerIn([{ name: 'hearth', runs: 'command', command: 'hearth' }])).toBe(null);
  // another of hearth's addresses (a job's own) is not its whole /mcp
  expect(H.hearthServerIn([{ name: 'x', runs: 'address', url: 'https://employee.hearth.monster/mcp/role/reports' }])).toBe(null);
});

test('a switch to hearth asks about its tools only when they are not here and you never said never', () => {
  expect(H.offerHearthTools({ servers: [], settings: {} })).toBe(true);
  expect(H.offerHearthTools({ servers: [], settings: { hearthTools: 'never' } })).toBe(false);
  expect(H.offerHearthTools({ servers: [{ name: 'h', runs: 'address', url: 'https://employee.hearth.monster/mcp' }], settings: {} })).toBe(false);
});

test('the account box\'s hearth part: its key\'s end, whether this window is on it, its tools as the hub has them, Claude\'s key to go back to', () => {
  const settings = {
    remotes: {
      hearth: { source: 'hearth', kind: 'openai', connect: 'https', address: HEARTH_ADDRESS, model: 'hearth', key: true, keyEnd: 'h9Zq' },
      claude: { source: 'claude', kind: 'claude', key: true, keyId: 'claude-2', keyEnd: '9Qk2' },
    },
    claudeKeys: [{ id: 'claude', name: 'Personal', end: 'FwAA' }, { id: 'claude-2', name: 'Work', end: '9Qk2' }],
  };
  const hub = { servers: new Map([['hearth', { cfg: { name: 'hearth', runs: 'address', url: 'https://employee.hearth.monster/mcp' }, state: 'connected', tools: Array(57).fill({}) }]]) };
  expect(H.hearthAccount({ settings, source: 'hearth', hub })).toEqual({ on: true, hearth: { end: 'h9Zq' }, tools: { name: 'hearth', state: 'connected', count: 57 }, claude: { name: 'Work', end: '9Qk2' } });
  // on Claude, no tools yet, no hearth key saved
  expect(H.hearthAccount({ settings: { ...settings, remotes: { claude: settings.remotes.claude } }, source: 'claude', hub: null })).toEqual({ on: false, hearth: null, tools: null, claude: { name: 'Work', end: '9Qk2' } });
});
