// The hub's Flow tab (src/app/flow.html, drawn by scripts/flow-page.mjs): the
// tab is in the hub, the page is served, and it stands alone.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWeightsServer } from '../src/app/weights.mjs';

test('the hub has a Flow tab that serves the eight-tab flow diagram, with nothing loaded from outside', async () => {
  const s = startWeightsServer({ path: null, docsDir: null, port: 0, cwd: mkdtempSync(join(tmpdir(), 'agentic-flow-')) });
  try {
    const base = s.url.replace(/\/$/, '');
    const hub = await (await fetch(base + '/')).text();
    expect(hub).toContain('<button data-tab="flow">Flow</button>');
    expect(hub).toContain("if (tab === 'flow') return show('/flow'");
    const r = await fetch(base + '/flow');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    const page = await r.text();
    expect(page).toContain('<meta charset="utf-8">');
    expect([...page.matchAll(/role="tab"/g)].length).toBe(8);
    expect(page).toContain('aria-label="Agentic Coder: you talk to the terminal (part 1)');
    expect(page).not.toMatch(/(?:src|href)="https?:/);
    expect(page).not.toMatch(/url\(\s*['"]?https?:/);
    const help = await (await fetch(base + '/help')).text();
    expect(help).toContain("['Flow',");
  } finally { s.stop(); }
});

test('flow.html is what scripts/flow-page.mjs draws (edit the script, then run it)', async () => {
  const { spawnSync } = await import('node:child_process');
  const out = join(mkdtempSync(join(tmpdir(), 'agentic-flow-')), 'flow.html');
  const r = spawnSync(process.execPath, [join(import.meta.dir, '..', 'scripts', 'flow-page.mjs'), out], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  const drawn = await Bun.file(out).text();
  const inApp = await Bun.file(join(import.meta.dir, '..', 'src', 'app', 'flow.html')).text();
  // the same drawing; only the dated header differs between the two copies
  expect(drawn.replace(' · 29 Sep 2026', '')).toBe(inApp);
});
