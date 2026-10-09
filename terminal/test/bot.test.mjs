// The bot over the prompt box (9 Oct 2026): its body (ui/bot-rig.mjs), what it does (ui/bot-brain.mjs),
// the cells it covers (ui/bot-paint.mjs), /bot in the / menu, and the real window (app/bot-layer.jsx):
// it stands over the Menu's title, jumps onto the box when you type, and /bot hides and shows it, kept in
// settings.json. The other app tests run with AGENTIC_BOT=off (pty.mjs); this one sets it on.
import { test, expect } from 'bun:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rigPixels, trimmed, POSE } from '../src/ui/bot-rig.mjs';
import { makeBrain, BOT_ROWS } from '../src/ui/bot-brain.mjs';
import { botCellsAt } from '../src/ui/bot-paint.mjs';
import { matchCommands } from '../src/app/commands.mjs';
import { parseMouse, MOTION_ON } from '../src/app/mouse.mjs';
import { runInPty } from './pty.mjs';
import { setup, quit } from './app-setup.mjs';

const OLD_GREENS = new Set([114, 71, 65, 120, 157, 194, 22]);
const size = (pose) => { const { px } = trimmed(rigPixels(pose)); return { w: px[0]?.length ?? 0, h: px.length, colours: new Set(px.flat().filter((c) => c != null)) }; };
const BOX = { top: 40, left: 0, right: 119 };
const HOME = { x: 60, y: 15 };
const at = (o) => ({ ...o, box: BOX, caret: { col: 4 + (o.text ?? '').length, row: BOX.top + 1 }, model: o.model ?? 'ready', walkRange: 16 });
// The brain run for `secs` at 30 frames a second; inputs(t) gives what happened at t. Every frame's output.
function run(secs, inputs, { seed = 5 } = {}) {
  const b = makeBrain({ seed });
  const out = [];
  for (let i = 0; i < secs * 30; i++) {
    const t = i / 30;
    const inp = at(inputs(t));
    const o = b.step(1 / 30, inp);
    out.push({ t, o, cells: botCellsAt(o.pose, o.at, { cols: 120, rows: 60, shadow: o.shadow, clip: o.clip }) });
  }
  return out;
}

test('its body: 10 × 10 pixels (5 rows) on the page, 6 × 6 (3 rows) on the box, no green, every pose drawn', () => {
  expect(size({}).w).toBe(10);
  expect(size({}).h).toBe(10);
  expect(Math.ceil(size({}).h / 2)).toBe(BOT_ROWS.full);
  expect(size({ size: 'mini' }).w).toBe(6);
  expect(size({ size: 'mini' }).h).toBe(6);
  expect(Math.ceil(size({ size: 'mini' }).h / 2)).toBe(BOT_ROWS.mini);
  for (const s of ['full', 'mini', 'ball']) for (const state of ['off', 'loading', 'ready']) for (const eyes of ['open', 'blink', 'happy', 'shut', 'wide', 'half', 'squint']) for (const arms of ['down', 'swing', 'up', 'wave', 'type']) for (const sq of [-2, -1, 0, 1, 2]) {
    const { colours, w } = size({ ...POSE, size: s, state, eyes, arms, sq, spin: sq + 2, feet: sq > 0 ? 'walk' : 'tuck', breath: sq & 1, z: state === 'off' ? 1 : null });
    expect(w).toBeGreaterThan(0);
    for (const c of colours) expect(OLD_GREENS.has(c)).toBe(false);
  }
});

test('it stands at its place; your typing sends it onto the box by your cursor; an empty box sends it back', () => {
  const frames = run(9, (t) => ({ home: HOME, phase: 'start', text: t >= 1 && t < 4 ? 'fix the login bug' : '' }));
  const when = (t) => frames[Math.round(t * 30)].o;
  expect(when(0.5).where).toBe('home');
  expect(when(0.5).at).toEqual({ x: 60, y: 15 });
  expect(when(0.5).shadow).not.toBeNull(); // its shadow on the page
  expect(when(2.6).where).toBe('box');
  expect(when(2.6).pose.size).toBe('mini');
  expect(when(2.6).at.y).toBe(BOX.top * 2); // feet on the box's top edge
  expect(Math.abs(when(3.5).at.x - (4 + 17 - 4))).toBeLessThanOrEqual(2); // just left of the cursor
  expect(when(8.9).where).toBe('home'); // 3 s after the box emptied
  for (const f of frames) for (const c of f.cells) expect(c.row).toBeLessThanOrEqual(BOX.top); // never inside the box
});

test('/bot hides it (a wave, a dive into the box, then nothing drawn) and shows it again (it pops out)', () => {
  const frames = run(9, (t) => ({ home: HOME, phase: 'start', text: '', hidden: t >= 1 && t < 5 }));
  const when = (t) => frames[Math.round(t * 30)];
  expect(when(1.3).o.says).toBe('hiding');
  expect(when(4).o.where).toBe('hidden');
  expect(when(4).cells).toEqual([]);
  expect(when(5.2).o.says).toBe('coming back');
  expect(when(6).o.where).toBe('box');
  expect(when(8.9).o.where).toBe('home');
  for (const f of frames) for (const c of f.cells) expect(c.row).toBeLessThanOrEqual(BOX.top);
});

test('with no room over the title, or in a conversation, it lives on the box; the model working, done, off', () => {
  const frames = run(6, (t) => ({ home: null, phase: 'chat', text: '', model: t < 2 ? 'working' : t < 4 ? 'done' : 'off' }));
  expect(frames[3].o.where).toBe('box');
  expect(frames[30].o.pose.arms).toBe('type'); // tapping while it works
  expect(frames[30].o.moving).toBe(true);
  expect(frames[75].o.pose.eyes).toBe('happy');
  expect(frames[170].o.pose.state).toBe('off');
});

test('its eyes follow the pointer; kept moving off to one side it walks over, never past its range, then back', () => {
  const frames = run(14, (t) => ({ home: HOME, phase: 'start', text: '', mouse: t < 5 ? { col: Math.round(110 + 3 * Math.sin(t * 6)), row: 12 } : t < 6 ? { col: 110, row: 12 } : null }));
  expect(frames[20].o.pose.look.x).toBeGreaterThan(0);
  expect(frames.some((f) => f.o.says === 'walk')).toBe(true);
  for (const f of frames) expect(Math.abs(f.o.at.x - HOME.x)).toBeLessThanOrEqual(16);
  expect(frames.at(-1).o.at.x).toBe(HOME.x);
  // the same inputs give the same frames
  const again = run(14, (t) => ({ home: HOME, phase: 'start', text: '', mouse: t < 5 ? { col: Math.round(110 + 3 * Math.sin(t * 6)), row: 12 } : t < 6 ? { col: 110, row: 12 } : null }));
  expect(again.map((f) => f.o.at)).toEqual(frames.map((f) => f.o.at));
});

test('the cells: only what it covers, nothing for a hidden bot, nothing below the clip', () => {
  expect(botCellsAt(null, { x: 10, y: 20 })).toEqual([]);
  const cells = botCellsAt({}, { x: 10, y: 21 }, { cols: 40, rows: 20 });
  expect(cells.length).toBeGreaterThan(20);
  expect(cells.every((c) => c.col >= 5 && c.col <= 15)).toBe(true);
  expect(botCellsAt({ size: 'mini' }, { x: 10, y: 30 }, { clip: 26 }).every((c) => c.row <= 13)).toBe(true);
});

test('/bot is in the / menu where there is room, and typing /b finds it in any window; the pointer moving is read', () => {
  expect(matchCommands('/', { room: 40 }).map((c) => c.name)).toContain('bot');
  expect(matchCommands('/b', { room: 18 }).map((c) => c.name)).toContain('bot');
  expect(parseMouse('\x1b[<35;12;7M')).toEqual({ kind: 'move', col: 12, row: 7, shift: false });
  expect(parseMouse('\x1b[<32;12;7M').kind).toBe('drag');
});

test('the real window: the bot over the Menu’s title, onto the box as you type, /bot hides it and brings it back, kept', async () => {
  const { ENGINE, MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs'); // inside the test: an early import would fix HOME for later files
  const D = MODELS[DEFAULT_MODEL];
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  const halves = /[▀▄]/;
  const lines = (s) => s.split('\n');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_LOAD_MS: '300', AGENTIC_HOME_LOOK: '', AGENTIC_BOT: 'on' }, cols: 150, rows: 50, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: 'tab to pick from this page', ms: 30_000 }, { waitGone: 'loading · ctrl+t stop', ms: 30_000 }, { sleep: 1500 }, { snapshot: 'shown' },
    { type: 'fix' }, { sleep: 2500 }, { snapshot: 'typed' },
    { key: 'backspace' }, { key: 'backspace' }, { key: 'backspace' }, { sleep: 200 },
    { type: '/bot' }, { sleep: 300 }, { key: 'enter' }, { wait: 'The bot is hidden' }, { sleep: 2500 }, { snapshot: 'hidden' },
    { type: '/bot' }, { sleep: 300 }, { key: 'enter' }, { wait: 'The bot is back' }, { sleep: 1500 }, { snapshot: 'back' },
    ...quit,
  ] });
  const shown = lines(r.snapshots.shown);
  const title = shown.findIndex((l) => l.includes('Agentic Coder'));
  expect(title).toBeGreaterThan(8);
  expect(shown.slice(title - 7, title).some((l) => halves.test(l))).toBe(true); // over the title
  expect(r.raw.includes(MOTION_ON)).toBe(true); // its eyes may follow the pointer
  const typed = lines(r.snapshots.typed);
  const boxTop = typed.findLastIndex((l) => l.startsWith('╭'));
  expect(typed.slice(boxTop - 3, boxTop + 1).some((l) => halves.test(l.slice(0, 20)))).toBe(true); // on the box by the cursor
  expect(typed.slice(0, title).some((l) => halves.test(l))).toBe(false); // and gone from over the title
  expect(halves.test(r.snapshots.hidden)).toBe(false);
  expect(halves.test(r.snapshots.back)).toBe(true);
  expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).bot).toBe(true);
}, 120_000);
