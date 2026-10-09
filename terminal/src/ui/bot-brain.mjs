// What the Visor bot does, frame by frame (8 Oct 2026, the owner's picks: the living companion, eyes then a
// short walk after the mouse, calm; then "timing / speed": slower, smoother moves, every duration here). One step a frame: what happened (the time, the pointer, the prompt's
// text and cursor, the model) in, the bot's pose and place out (bot-rig.mjs draws the pose, bot-paint.mjs
// puts it on the screen). Pure and seeded: the same inputs give the same frames, in the app, its tests and
// the preview page alike.
//
// How it moves, by the old animation rules: it crouches before a jump (anticipation), stretches as it
// leaves and squashes as it lands, flies on a curve (a parabola, slow at the top), curls into a spinning
// ball in the air to come down small, and its antenna, lean and squash are springs, so they overshoot and
// settle after a stop (follow-through). Between things it breathes, blinks every few seconds and glances.
//
// Where it is: on the start page it stands above the title (`home`; null where the page leaves no room
// above it, or in a conversation: then it lives on the box); when you type it jumps onto the
// prompt box's top edge and sits by your cursor, hopping along as it moves; with the box empty for 3 s on
// the start page it jumps back; in the chat it stays on the box and shows what the model is doing.
// The mouse: its eyes follow the pointer; keep moving it and the bot walks a few steps toward it, then
// gets bored and walks back. Alone for `napAfter` seconds it naps until something happens.
// /bot hides it (`hidden`: it waves, then dives into the prompt box) and shows it again (it pops up out of
// the box); while hidden it draws nothing (pose null).

import { EYE_UP } from './bot-rig.mjs';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const spring = (p = 0) => ({ p, v: 0 });
function pull(sp, target, k, c, dt) {
  // a few small steps, so a long frame cannot blow the spring up
  const n = Math.max(1, Math.ceil(dt / 0.01));
  for (let i = 0; i < n; i++) { sp.v += (k * (target - sp.p) - c * sp.v) * (dt / n); sp.p += sp.v * (dt / n); }
}
const bez = (a, b, c, u) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c;

// The rows each size takes on the screen (10 and 6 pixels tall, two to a row).
export const BOT_ROWS = { full: 5, mini: 3 };

export function makeBrain({ seed = 7, napAfter = 120, emptyBack = 3 } = {}) {
  const rnd = rng(seed);
  const s = {
    t: 0, ready: false, where: 'home', act: null,
    x: 0, gy: 0, vx: 0, vy: 0, size: 'full', spin: 0,
    sq: spring(), lean: spring(), antX: spring(), antY: spring(),
    look: { x: 0, y: 0.15 }, blinkUntil: -1, nextBlink: 1.8, glanceTo: null, glanceUntil: -1, nextGlance: 5,
    text: '', keyAt: -99, mouse: null, mouseAt: -99, streakFrom: -99, active: 0, emptySince: 0,
    model: 'ready', modelAt: 0, phase: 'start', happyUntil: -1, wideUntil: -1, squintUntil: -1, napping: false,
    walked: 0, says: 'standing', hidden: false,
  };

  // where the bot's eyes are on the screen, and a look at a cell as -1…1 each way
  const lookAt = (col, row) => {
    const eyePx = s.gy - EYE_UP[s.size];
    const dx = col + 0.5 - (s.x + 0.5), dy = row * 2 + 1 - eyePx;
    return { x: Math.tanh(dx / 14), y: Math.tanh(dy / 12) };
  };
  const boxX = (inp) => {
    const { box, caret } = inp;
    const want = caret ? caret.col - 4 : box.left + 10;
    return clamp(want, box.left + 4, box.right - 5);
  };
  const boxY = (inp) => inp.box.top * 2; // feet on the top half of the box's top edge: planted on the line

  function start(kind, extra = {}) { s.act = { kind, t0: s.t, ...extra }; }
  function jump(inp, toBox, extra = {}) {
    const x1 = toBox ? boxX(inp) : inp.home.x, y1 = toBox ? boxY(inp) : inp.home.y;
    start('crouch', { toBox, x1, y1, dur: s.size === 'mini' ? 0.16 : 0.22, ...extra });
  }

  function step(dt, inp) {
    dt = clamp(dt, 0, 0.1);
    s.t += dt;
    const t = s.t;
    if (!s.ready) {
      if (inp.home) { s.x = inp.home.x; s.gy = inp.home.y; } else { s.where = 'box'; s.size = 'mini'; s.x = boxX(inp); s.gy = boxY(inp); }
      s.ready = true; s.active = t;
    }

    // ── what happened ──
    const text = inp.text ?? '';
    if (text !== s.text) {
      if (text.length - s.text.length > 8) s.wideUntil = t + 0.6; // a paste: eyes wide
      if (s.where === 'box' && !s.act) s.sq.v += 9; // a key: a little bob
      s.text = text; s.keyAt = t; s.active = t;
      if (!text) s.emptySince = t;
    }
    const m = inp.mouse;
    if (m && (!s.mouse || m.col !== s.mouse.col || m.row !== s.mouse.row)) {
      if (t - s.mouseAt > 0.4) s.streakFrom = t;
      s.mouseAt = t; s.active = t;
    }
    s.mouse = m ?? null;
    const model = inp.model ?? 'ready';
    if (model !== s.model) {
      if (model === 'done' && s.model === 'working' && !s.act) { start('cheer', { h: 5 }); s.happyUntil = t + 1.8; }
      if (model === 'asks') s.wideUntil = t + 1.0;
      s.model = model; s.modelAt = t; s.active = t;
    }
    if (inp.phase !== s.phase) {
      if (inp.phase === 'chat' && s.where === 'box' && !s.act) { start('cheer', { h: 6 }); s.happyUntil = t + 1.4; }
      s.phase = inp.phase;
      s.active = t;
    }
    if (s.napping && t - s.active < 0.05) { s.napping = false; start('startle'); s.wideUntil = t + 0.5; }
    // /bot hide · /bot show: a wave and a dive into the box; out of it again with a pop
    if (Boolean(inp.hidden) !== s.hidden) {
      s.hidden = Boolean(inp.hidden); s.active = t; s.napping = false;
      if (s.hidden) { start('wave', { dur: 0.75 }); s.happyUntil = t + 0.75; }
      else { s.where = 'box'; s.size = 'mini'; s.x = boxX(inp); s.gy = boxY(inp) + 12; start('popup', { dur: 0.5 }); s.emptySince = t - emptyBack + 1.4; }
    }
    const gone = { pose: null, at: { x: 0, y: 0 }, shadow: null, clip: null, moving: false, says: 'hidden', where: 'hidden' };
    if (s.where === 'hidden') return gone;

    // ── what to do next ──
    const mouseMoving = t - s.mouseAt < 0.4;
    const quiet = t - s.mouseAt;
    // its place went (the page printed, the window too short for it): down to the box, wherever it was
    if (!inp.home && s.where === 'home' && !['crouch', 'fly', 'wave'].includes(s.act?.kind)) { s.act = null; jump(inp, true); }
    if (!s.act) {
      if (s.where === 'home') {
        if (text || inp.phase === 'chat') jump(inp, true);
        else if (m && mouseMoving && t - s.streakFrom > 1.0 && Math.abs(m.col - s.x) > 6) {
          const range = inp.walkRange ?? 16;
          const tx = clamp(m.col - sign(m.col - s.x) * 4, inp.home.x - range, inp.home.x + range);
          if (Math.abs(tx - s.x) > 2) start('walk', { tx, speed: 7 });
        } else if (Math.abs(s.x - inp.home.x) > 0.5 && quiet > 1.8) start('bored', { dur: 1.3 });
      } else if (s.where === 'box') {
        if (inp.phase === 'start' && inp.home && !text && t - s.emptySince > emptyBack) jump(inp, false);
        else if (text) {
          // it follows the cursor only while there is text: an emptied box leaves it where it sat
          const tx = boxX(inp);
          if (Math.abs(tx - s.x) >= 3) start('hop', { x0: s.x, x1: tx, dur: clamp(0.2 + 0.015 * Math.abs(tx - s.x), 0.22, 0.42), h: 5 });
        }
      }
    }
    if (!s.act && !s.napping && t - s.active > (inp.napAfter ?? napAfter) && s.model !== 'working' && s.model !== 'off') s.napping = true;

    // ── the act under way ──
    const px = s.x, py = s.gy;
    let sqTarget = 0, leanTarget = 0, arms = 'down', feet = 'stand', footPhase = 0, armPhase = 0, eyesAct = null, lookAct = null, size = s.where === 'box' ? 'mini' : 'full';
    const a = s.act;
    if (a) {
      const e = t - a.t0;
      switch (a.kind) {
        case 'crouch': {
          sqTarget = 2; s.sq.p = Math.max(s.sq.p, (e / a.dur) * 2);
          lookAct = lookAt(a.x1, (a.y1 >> 1) + 1);
          if (e >= a.dur) {
            const x0 = s.x, y0 = s.gy;
            const up = a.toBox ? 6 : 10;
            const dur = clamp(0.7 + Math.abs(a.y1 - y0) * 0.004, 0.7, 1.1);
            start('fly', { toBox: a.toBox, dive: a.dive, x0, y0, x1: a.x1, y1: a.y1, cx: (x0 + a.x1) / 2, cy: Math.min(y0, a.y1) - up, dur });
            s.sq.p = -2; s.sq.v = 0; s.antY.v += 30;
          }
          break;
        }
        case 'fly': {
          // the far end follows the cursor while it flies there
          if (a.toBox) a.x1 += (boxX(inp) - a.x1) * Math.min(1, dt * 6);
          const u = clamp(e / a.dur, 0, 1);
          s.x = bez(a.x0, a.cx, a.x1, u); s.gy = bez(a.y0, a.cy, a.y1, u);
          const first = a.toBox ? 'full' : 'mini', last = a.toBox ? 'mini' : 'full';
          size = u < 0.28 ? first : u < 0.72 ? 'ball' : last;
          s.spin = Math.floor(u * 14);
          sqTarget = u < 0.28 ? -2 : -1;
          arms = u < 0.28 ? 'up' : 'down'; feet = 'tuck';
          lookAct = lookAt(a.x1, (a.y1 >> 1));
          if (u >= 1 && a.dive) { s.x = a.x1; s.gy = a.y1; s.where = 'box'; start('sink', { dur: 0.4 }); break; }
          if (u >= 1) { s.x = a.x1; s.gy = a.y1; s.where = a.toBox ? 'box' : 'home'; start('land'); s.sq.p = 2; s.sq.v = 0; s.antY.v -= 40; s.squintUntil = t + 0.1; if (!a.toBox) s.emptySince = t; }
          break;
        }
        case 'land': {
          if (e > 0.3) s.act = null;
          break;
        }
        case 'hop': {
          const u = clamp(e / a.dur, 0, 1);
          s.x = a.x0 + (a.x1 - a.x0) * u;
          s.gy = boxY(inp) - 4 * a.h * u * (1 - u) / 2;
          sqTarget = u < 0.15 ? 1 : u < 0.85 ? -1 : 1; feet = u > 0.1 && u < 0.9 ? 'tuck' : 'stand';
          if (u >= 1) { s.gy = boxY(inp); s.act = null; s.sq.v += 10; }
          break;
        }
        case 'walk': {
          if (m && mouseMoving) a.tx = clamp(m.col - sign(m.col - s.x) * 4, inp.home.x - (inp.walkRange ?? 16), inp.home.x + (inp.walkRange ?? 16));
          const d = a.tx - s.x, dir = sign(d), stepLen = a.speed * dt;
          if (Math.abs(d) <= stepLen) { s.x = a.tx; s.act = null; s.lean.v -= dir * 8; }
          else { s.x += dir * stepLen; s.walked += stepLen; }
          footPhase = Math.floor(s.walked / 1.5) % 2; armPhase = footPhase; arms = 'swing'; feet = 'walk'; leanTarget = dir;
          if (!mouseMoving && quiet > 1.8) start('bored', { dur: 1.3 });
          break;
        }
        case 'bored': {
          eyesAct = e < 0.9 ? 'half' : null; lookAct = { x: sign(inp.home.x - s.x) * 0.3, y: 0.8 };
          sqTarget = e < 0.55 ? 1 : 0;
          if (e >= a.dur) start('return', { tx: inp.home.x, speed: 5 });
          break;
        }
        case 'return': {
          const d = a.tx - s.x, dir = sign(d), stepLen = a.speed * dt;
          if (Math.abs(d) <= stepLen) { s.x = a.tx; s.act = null; s.lean.v -= dir * 6; }
          else { s.x += dir * stepLen; s.walked += stepLen; }
          footPhase = Math.floor(s.walked / 1.5) % 2; armPhase = footPhase; arms = 'swing'; feet = 'walk'; leanTarget = dir;
          lookAct = { x: dir * 0.8, y: 0.2 };
          if (text || (m && mouseMoving && t - s.streakFrom > 0.9)) s.act = null;
          break;
        }
        case 'cheer': {
          const dur = 0.6, u = clamp(e / dur, 0, 1);
          const base = s.where === 'box' ? boxY(inp) : inp.home.y;
          s.gy = base - 4 * a.h * u * (1 - u);
          arms = 'up'; feet = u > 0.08 && u < 0.92 ? 'tuck' : 'stand'; sqTarget = u < 0.1 ? 1 : u < 0.9 ? -1 : 1;
          if (u >= 1) { s.gy = base; s.act = null; s.sq.v += 12; }
          break;
        }
        case 'wave': {
          arms = 'wave'; armPhase = Math.floor(e / 0.15) % 2; eyesAct = 'happy';
          if (e >= a.dur) { if (s.where === 'home') jump(inp, true, { dive: true }); else start('sink', { dur: 0.4 }); }
          break;
        }
        case 'sink': {
          // a little hop up, then down into the box, stretched like a diver (cut off at the box's edge)
          const u = clamp(e / a.dur, 0, 1);
          s.gy = boxY(inp) + (u < 0.25 ? -3 * Math.sin((u / 0.25) * Math.PI / 2) : -3 + 15 * ((u - 0.25) / 0.75) ** 2);
          sqTarget = u < 0.25 ? 1 : -2; arms = 'up'; feet = 'tuck';
          if (u >= 1) { s.where = 'hidden'; s.act = null; }
          break;
        }
        case 'popup': {
          // up out of the box, past its edge, and a bouncy landing on it
          const u = clamp(e / a.dur, 0, 1);
          s.gy = u < 0.7 ? boxY(inp) + 12 - 16 * (1 - (1 - u / 0.7) ** 2) : boxY(inp) - 4 + 4 * ((u - 0.7) / 0.3) ** 2;
          sqTarget = u < 0.7 ? -2 : 0; arms = 'up'; feet = 'tuck'; eyesAct = u < 0.6 ? 'wide' : null;
          if (u >= 1) { s.gy = boxY(inp); s.act = null; s.sq.p = 2; s.sq.v = 0; s.antY.v -= 40; s.happyUntil = t + 1.0; }
          break;
        }
        case 'startle': {
          sqTarget = -2; arms = 'up';
          if (e > 0.35) s.act = null;
          break;
        }
        default: s.act = null;
      }
    } else if (s.where === 'box') s.gy = boxY(inp);
    else s.gy = inp.home.y;
    if (s.where === 'hidden') return gone; // the dive just ended: nothing drawn from this frame on
    if (s.act?.kind === 'fly') size = size; else if (s.where === 'box') size = 'mini'; else size = 'full';
    s.size = size;

    // the springs: squash, lean, the antenna pushed about by the bot's own speeding up and stopping
    const vx = dt > 0 ? (s.x - px) / dt : 0, vy = dt > 0 ? (s.gy - py) / dt : 0;
    const ax = dt > 0 ? (vx - s.vx) / dt : 0, ay = dt > 0 ? (vy - s.vy) / dt : 0;
    s.vx = vx; s.vy = vy;
    s.antX.v -= clamp(ax, -400, 400) * 0.02; s.antY.v -= clamp(ay, -800, 800) * 0.004;
    pull(s.sq, sqTarget, 220, 10, dt);
    pull(s.lean, leanTarget, 140, 10, dt);
    pull(s.antX, 0, 160, 4, dt);
    pull(s.antY, 0, 220, 7, dt);
    s.antX.p = clamp(s.antX.p, -2.4, 2.4); s.antY.p = clamp(s.antY.p, -1.4, 1.4); s.sq.p = clamp(s.sq.p, -2.4, 2.4);

    // ── the eyes ──
    const typing = s.where === 'box' && t - s.keyAt < 1.4 && inp.caret;
    let want = { x: 0, y: 0.15 };
    if (lookAct) want = lookAct;
    else if (typing) want = lookAt(inp.caret.col, inp.caret.row);
    else if (m && quiet < 2.5) want = lookAt(m.col, m.row);
    else if (s.model === 'working') want = { x: -0.5, y: -0.8 };
    else if (s.model === 'asks') want = { x: 0, y: -1 };
    else {
      if (t >= s.nextGlance && !s.napping) {
        s.glanceTo = [{ x: -0.9, y: 0 }, { x: 0.9, y: 0 }, { x: -0.6, y: -0.7 }, { x: 0.6, y: -0.7 }, { x: 0, y: 0.9 }][Math.floor(rnd() * 5)];
        s.glanceUntil = t + 0.8 + rnd() * 0.6; s.nextGlance = t + 4 + rnd() * 4;
      }
      if (t < s.glanceUntil) want = s.glanceTo;
    }
    const k = 1 - Math.exp(-dt * 14);
    s.look.x += (want.x - s.look.x) * k; s.look.y += (want.y - s.look.y) * k;
    if (t >= s.nextBlink) { s.blinkUntil = t + 0.13; s.nextBlink = t + 2.4 + rnd() * 3.6; if (rnd() < 0.2) s.nextBlink = t + 0.32; }

    // ── the pose ──
    const mini = size === 'mini';
    const state = s.model === 'off' ? 'off' : s.model === 'loading' ? 'loading' : 'ready';
    let eyes = 'open';
    if (eyesAct) eyes = eyesAct;
    else if (t < s.squintUntil) eyes = 'squint';
    else if (t < s.wideUntil || (s.model === 'asks')) eyes = 'wide';
    else if (t < s.happyUntil) eyes = 'happy';
    else if (s.napping) eyes = 'shut';
    else if (s.model === 'working') eyes = 'half';
    else if (s.model === 'error' && t - s.modelAt < 3) eyes = 'half';
    if (t < s.blinkUntil && (eyes === 'open' || eyes === 'wide')) eyes = 'blink';
    if (s.model === 'working' && !s.act) { arms = 'type'; armPhase = Math.floor(t / 0.14) % 2; }
    let antColor = null, strip = null;
    if (s.model === 'working') { antColor = [81, 75, 117, 75][Math.floor(t * 6) % 4]; strip = { run: Math.floor(t * 10), color: 81 }; }
    else if (s.model === 'asks') antColor = 147;
    else if (s.model === 'error' && t - s.modelAt < 3) antColor = 203;
    if (s.model === 'error' && t - s.modelAt < 3 && !s.act) sqTarget = 1;
    const breathPeriod = s.napping ? 5.5 : 3.6;
    const breath = !s.act && ((t % breathPeriod) / breathPeriod) < 0.42 ? 1 : (s.act?.kind === 'walk' || s.act?.kind === 'return') ? footPhase : 0;
    const pupils = { x: Math.round(clamp(s.look.x, -1, 1) * 1.4), y: Math.round(clamp(s.look.y, -1, 1) * 1.2) };
    const pose = {
      size, state, sq: Math.round(s.sq.p), lean: Math.round(s.lean.p), breath, turn: Math.abs(s.look.x) > 0.75 ? sign(s.look.x) : 0,
      look: pupils, eyes, ant: { x: Math.round(s.antX.p), y: Math.round(s.antY.p) }, antColor,
      arms, armPhase, feet, footPhase, strip, z: s.napping ? Math.floor(t / 0.7) % 4 : null, spin: s.spin, k: Math.floor(t * 2),
    };
    s.says = s.napping ? 'napping' : s.act ? s.act.kind : s.where === 'box' ? (s.model === 'working' ? 'working' : s.model === 'asks' ? 'asks' : typing ? 'riding the box' : 'on the box') : (m && quiet < 2.5 ? 'watching the mouse' : 'standing');
    const moving = Boolean(s.act) || Math.abs(s.sq.v) + Math.abs(s.antX.v) + Math.abs(s.lean.v) + Math.abs(s.antY.v) > 0.3 || s.model === 'working';
    // its shadow on the page: under it at its place, smaller the higher it is, none on the box
    let shadow = null;
    if (inp.phase === 'start' && inp.home && size !== 'mini') {
      const up = inp.home.y - s.gy;
      const w = Math.round(8 - Math.max(0, up) / 2 - (size === 'ball' ? 2 : 0));
      if (up > -2 && w >= 3) shadow = { x: Math.round(s.x), y: inp.home.y + 1, w };
    }
    const clip = s.act && (s.act.kind === 'sink' || s.act.kind === 'popup') ? boxY(inp) : null;
    if (s.act?.kind === 'wave' || s.act?.kind === 'sink') s.says = 'hiding';
    if (s.act?.kind === 'popup') s.says = 'coming back';
    return { pose, at: { x: Math.round(s.x), y: Math.round(s.gy) }, shadow, clip, moving, says: s.says, where: s.where };
  }
  return { step, state: s };
}
