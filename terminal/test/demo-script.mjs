// The --json task, scripted: used by the terminal tests and `bun run demo:live`.
export const demoReplies = [
  { reasoning: 'The user wants a --json flag on export.mjs. First I will read the file to see how main() builds its output.', tool: { name: 'Read', args: { path: 'export.mjs' } } },
  { reasoning: 'main() returns toCsv(rows). The flag check fits right before that line.', tool: { name: 'TodoWrite', args: { todos: [{ text: 'Add the --json flag to main()', status: 'in_progress' }, { text: 'Add a test for --json', status: 'pending' }, { text: 'Run the tests', status: 'pending' }] } } },
  { text: "I'll add the check inside main(), so running it without the flag still prints CSV.", tool: { name: 'Edit', args: { path: 'export.mjs', old_text: '  return toCsv(rows);', new_text: "  if (argv.includes('--json')) return JSON.stringify(rows, null, 2);\n  return toCsv(rows);" } } },
  { reasoning: 'Now a test that parses the JSON output. First the test file.', tool: { name: 'Read', args: { path: 'export.test.mjs' } } },
  { tool: { name: 'Edit', args: { path: 'export.test.mjs', old_text: "test('main reads the trades file', () => {\n  assert.match(main(['trades.json']), /^symbol,side,qty,price\\n/);\n});", new_text: "test('main reads the trades file', () => {\n  assert.match(main(['trades.json']), /^symbol,side,qty,price\\n/);\n});\n\ntest('--json prints the rows as JSON', () => {\n  const out = JSON.parse(main(['trades.json', '--json']));\n  assert.equal(out.length, 3);\n});" } } },
  { tool: { name: 'Bash', args: { command: 'node --test', description: 'Run the tests' } } },
  { text: 'Done. `node export.mjs --json` now prints the trades as JSON; without the flag it still prints CSV. I added a test, and all **3 tests pass**.' },
];
