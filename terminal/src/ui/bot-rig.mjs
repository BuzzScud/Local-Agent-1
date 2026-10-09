// The Visor bot as a puppet (8 Oct 2026, the owner's ask: "make it detailed and animate live … natural,
// animated like pixar"; their picks: today's Visor bot with more moving parts, then "smaller by 35%" and a
// more detailed look, then "smaller by 40%" again, then "make it more detailed, the look of the agent"). The start page's bot (start.jsx botPixels: a white helmet, a dark glass visor, blue
// eyes, an antenna, ear lights, a chest strip) redrawn small, 10 × 9 pixels (10 columns × 5 rows, where
// it was 22 × 11), each pixel placed, lit like a glossy white toy (EVE's look: white with cool blue
// shading and a white highlight, a black glass face, eyes that glow and light the glass under them): a lit helmet with a rim, a glass visor with a reflection and a light
// lip, eyes with a glint, ear lights in the pods, a chest light. Drawn from a pose: squashed or stretched,
// the head leaning and turning, eyes that look anywhere, blink, smile, go wide or half shut, an antenna on
// a spring, arms that swing, cheer, wave or type, feet that walk or tuck in; a small version (6 × 6
// pixels, three rows) for riding the prompt box, and a ball (curled up mid-jump, spinning) to change between
// the two in the air. Pure: a pose in, pixels out (xterm-256 numbers, null where the window shows through),
// two pixels to a character. Nothing here knows about the screen: bot-paint.mjs puts the pixels on it.
import { HUE } from './theme.mjs';

// Every pose is drawn on one canvas, its feet on the bottom row, its middle between columns 15 and 16.
const RIG_W = 32, RIG_H = 32, MID = 15.5;
export const GROUND = RIG_H - 1;

// A rounded rectangle, both ends included; the corners cut on a circle of radius r (as start.jsx).
function roundRect(x0, y0, x1, y1, r = 0) {
  const pts = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - Math.min(Math.max(x, x0 + r), x1 - r), dy = y - Math.min(Math.max(y, y0 + r), y1 - r);
    if (dx * dx + dy * dy <= r * r + r * 0.6) pts.push([x, y]);
  }
  return pts;
}
const inside = (x, y) => x >= 0 && x < RIG_W && y >= 0 && y < RIG_H;
const fill = (px, pts, c) => { for (const [x, y] of pts) if (inside(x, y)) px[y][x] = c; };
const edgeOf = (pts) => { const has = new Set(pts.map(([x, y]) => `${x},${y}`)); return (x, y) => has.has(`${x},${y}`); };
// Lit from the top left: tones = [rim light, top, middle, bottom, shadow rim], by height in the shape.
function shade(px, pts, tones) {
  if (!pts.length) return;
  const inn = edgeOf(pts);
  const ys = pts.map(([, y]) => y), top = Math.min(...ys), span = Math.max(1, Math.max(...ys) - top);
  for (const [x, y] of pts) {
    if (!inside(x, y)) continue;
    const t = (y - top) / span;
    let tone = t < 0.3 ? tones[1] : t < 0.68 ? tones[2] : tones[3];
    if (!inn(x, y + 1) || !inn(x + 1, y)) tone = tones[4];
    if (!inn(x, y - 1) || (!inn(x - 1, y) && t < 0.6)) tone = tones[0];
    px[y][x] = tone;
  }
}
// Colours by xterm-256 number. Awake: glossy white (231 white, 255, 254, 252) with the app's sky blue only
// where the light turns away at its edges (153 #afd7ff, then 110 #87afd7, 67 #5f87af on arms and feet), the visor black glass with a soft shine, the eyes two-tone
// (159 #afffff over 81 #5fd7ff) with a blue glow (24 #005f87) on the glass's lip under them, pink cheeks
// (217) when it smiles. Asleep (the model off): plain greys, a shade darker, nothing lit.
const AWAKE = { helm: [231, 255, 254, 252, 153], body: [231, 255, 254, 252, 153], arm: [255, 254, 252, 153, 110], foot: [254, 252, 153, 110, 67], hand: 252, visor: [236, 233, 232], lip: 236, edge: 234, glint: 231, glint2: 239, shine: 239, pod: 254, podShade: 153, neck: 67, neckDark: 238, stalk: 110, stalkDark: 67, stripOff: 237, panel: 110, eyeHi: 159, halo: 24, blush: 217 };
const ASLEEP = { helm: [250, 248, 246, 244, 241], body: [249, 247, 245, 243, 240], arm: [247, 245, 243, 241, 239], foot: [245, 243, 241, 239, 237], hand: 243, visor: [234, 233, 232], lip: 237, edge: 233, glint: 240, glint2: 236, shine: 236, pod: 244, podShade: 241, neck: 239, neckDark: 237, stalk: 241, stalkDark: 239, stripOff: 236, panel: 239, eyeHi: null, halo: null, blush: null };

// The parts' sizes by squash (+1, +2: wider and shorter) or stretch (−1, −2: narrower and taller).
// Widths stay even, so every part centres on the canvas's middle.
// eyeIn: the eyes' distance in from the visor's sides; lip: the visor's light bottom edge; pods: the side
// pods and their lights.
const SIZES = {
  full: {
    dims: {
      '-2': { helm: [6, 6], body: [4, 3], neck: 0 },
      '-1': { helm: [8, 6], body: [6, 2], neck: 0 },
      0: { helm: [8, 5], body: [6, 2], neck: 0 },
      1: { helm: [10, 4], body: [8, 2], neck: 0 },
      2: { helm: [10, 4], body: [8, 1], neck: 0 },
    },
    footH: 1, footW: 2, helmR: 1, stalk: 1, inset: [1, 1, 1], eye: [1, 2], eyeIn: 1, glint: false, lip: true, pods: true,
  },
  mini: {
    dims: {
      '-2': { helm: [4, 5], body: [2, 1], neck: 0 },
      '-1': { helm: [6, 5], body: [4, 1], neck: 0 },
      0: { helm: [6, 4], body: [4, 1], neck: 0 },
      1: { helm: [8, 3], body: [4, 1], neck: 0 },
      2: { helm: [8, 3], body: [4, 1], neck: 0 },
    },
    footH: 0, footW: 0, helmR: 1, stalk: 0, inset: [1, 1, 0], eye: [1, 1], eyeIn: 0, glint: false, lip: false, pods: false,
  },
};
const clampI = (v, a, b) => Math.max(a, Math.min(b, Math.round(v ?? 0)));
const left = (w, shift = 0) => 16 - w / 2 + shift; // the first column of a part w wide, centred

export const POSE = {
  size: 'full', // full · mini · ball
  state: 'ready', // off · trust · loading · ready
  sq: 0, lean: 0, breath: 0, turn: 0,
  look: { x: 0, y: 0 }, // the eyes' offset in pixels
  eyes: 'open', // open · blink · happy · shut · wide · half · squint
  ant: { x: 0, y: 0 }, antColor: null,
  arms: 'down', armPhase: 0, // down · swing · up · wave · type
  feet: 'stand', footPhase: 0, // stand · walk · tuck
  strip: null, // { lit: 0–1, color, run: index of a running light }
  z: null, spin: 0, k: 0,
};
// How high each size's eyes are over its feet, in pixels: for the brain (it stands 10, 6 and 7 tall).
export const EYE_UP = { full: 6, mini: 3, ball: 3 };

// The pixels of a pose: RIG_H rows of RIG_W colours (null: the window shows through).
export function rigPixels(pose = {}) {
  const p = { ...POSE, ...pose, look: { ...POSE.look, ...pose.look }, ant: { ...POSE.ant, ...pose.ant } };
  const px = Array.from({ length: RIG_H }, () => Array(RIG_W).fill(null));
  const asleep = p.state === 'off' || p.state === 'trust';
  const P = asleep ? ASLEEP : AWAKE;
  if (p.size === 'ball') return ball(px, p, P, asleep);
  const mini = p.size === 'mini';
  const Z = SIZES[mini ? 'mini' : 'full'];
  const sq = clampI(p.sq, -2, 2);
  const D = Z.dims[sq];
  const ready = p.state === 'ready';
  const eyeLit = asleep ? HUE.deep : HUE.bright;
  const eyeGlint = ready ? P.eyeHi ?? HUE.lighter : HUE.light;

  // From the ground up: feet, body, neck, helmet, antenna.
  const [bw, bh] = D.body;
  const bBottom = GROUND - Z.footH, bTop = bBottom - bh + 1;
  const bx0 = left(bw), bx1 = bx0 + bw - 1;
  const small = Z.footH < 2;
  const neck = D.neck + (p.breath ? 1 : 0); // a breath lifts the head on its neck, never off the body
  const [hw, hh] = D.helm;
  const lean = clampI(p.lean, -2, 2);
  const hBottom = bTop - neck - 1, hTop = hBottom - hh + 1;
  const hx0 = left(hw, lean), hx1 = hx0 + hw - 1;

  // feet
  const tuck = p.feet === 'tuck' ? 1 : 0;
  const liftL = p.feet === 'walk' ? (p.footPhase ? 0 : 1) : tuck;
  const liftR = p.feet === 'walk' ? (p.footPhase ? 1 : 0) : tuck;
  const foot = (x0, lift, side) => {
    const y1 = GROUND - lift, y0 = y1 - Z.footH + 1;
    for (let i = 0; i < Z.footW; i++) {
      const outer = side < 0 ? i === 0 : i === Z.footW - 1;
      fill(px, roundRect(x0 + i, y0, x0 + i, y1), Z.footW > 1 && i === Z.footW - 1 ? P.foot[Z.footW > 2 ? 4 : 3] : outer ? P.foot[1] : P.foot[2]);
    }
    if (Z.footH > 1) fill(px, [[x0, y0]], P.foot[0]); // the toe's light
  };
  if (Z.footH) { foot(bx0 + tuck, liftL, -1); foot(bx1 - Z.footW + 1 - tuck, liftR, 1); }

  // arms beside the body, then the body over them
  const arm = (s) => {
    const ax = s < 0 ? bx0 - (small ? 1 : 2) : bx1 + (small ? 1 : 2);
    let pose = p.arms === 'wave' ? (s > 0 ? 'wave' : 'down') : p.arms;
    if (pose === 'up' || pose === 'wave') {
      const reach = small ? 1 : 2;
      for (let i = 0; i <= reach; i++) fill(px, [[ax + s * (i + (pose === 'wave' && p.armPhase ? 1 : 0)), bTop - i]], i === reach ? P.hand : P.arm[1]);
      if (!small) fill(px, [[s < 0 ? bx0 - 1 : bx1 + 1, bTop]], P.arm[2]);
      return;
    }
    if (pose === 'type') {
      const up = (s < 0 ? p.armPhase === 0 : p.armPhase === 1) ? 1 : 0;
      if (!small) fill(px, [[ax, bTop], [s < 0 ? bx0 - 1 : bx1 + 1, bTop]], P.arm[2]);
      else if (bh > 1) fill(px, [[ax, bTop]], P.arm[2]);
      fill(px, [[s < 0 ? bx0 + (small ? 0 : 1) : bx1 - (small ? 0 : 1), bBottom - up]], P.hand);
      return;
    }
    const lift = pose === 'swing' && (s < 0 ? p.armPhase === 0 : p.armPhase === 1) ? 1 : 0;
    if (small) { for (let i = 0; i < bh; i++) fill(px, [[ax, bTop + i - lift]], i === bh - 1 ? P.hand : P.arm[1]); return; }
    const len = Math.max(1, bh - 1);
    for (let i = 0; i < len; i++) fill(px, [[ax, bTop + i - lift]], i === 0 ? P.arm[1] : P.arm[2]);
    fill(px, [[ax, bTop + len - lift]], P.hand);
    fill(px, [[s < 0 ? bx0 - 1 : bx1 + 1, bTop]], P.arm[3]); // the shoulder
  };
  arm(-1); arm(1);
  shade(px, roundRect(bx0, bTop, bx1, bBottom), P.body);
  // the chest light: lit from the left, or one light running
  const inS = small && bw < 6 ? 1 : 2;
  const sx0 = bx0 + inS, sx1 = bx1 - inS, sw = Math.max(1, sx1 - sx0 + 1);
  const sy = small ? bBottom : bh >= 3 ? bTop + 1 : bBottom;
  const strip = p.strip ?? { lit: asleep ? 0 : ready ? 1 : ((p.k % 9) / 8), color: ready ? HUE.accent : HUE.bright };
  for (let i = 0; i < sw; i++) {
    const on = strip.run != null ? Math.abs(((strip.run % sw) + sw) % sw - i) < 1 : i < Math.round(strip.lit * sw);
    fill(px, [[sx0 + i, sy]], on ? strip.color : P.stripOff);
  }
  if (inS === 2 && (small || bh >= 3)) { fill(px, [[sx0 - 1, sy]], P.panel); fill(px, [[sx1 + 1, sy]], P.panel); }
  // the neck
  if (neck > 0) { const nw = small ? 2 : 4, nx = left(nw, Math.trunc(lean / 2)); fill(px, roundRect(nx, bTop - neck, nx + nw - 1, bTop - 1), P.neck); fill(px, [[nx + nw - 1, bTop - 1]], P.neckDark); }

  // the side pods and their lights
  if (Z.pods) {
    const podTop = hTop + (small ? 1 : 2), podBottom = hBottom - (small ? 1 : 2);
    fill(px, roundRect(hx0 - 1, podTop, hx0 - 1, podBottom), P.pod);
    fill(px, roundRect(hx1 + 1, podTop, hx1 + 1, podBottom), P.podShade);
    const ear = asleep ? 239 : p.antColor ?? (ready ? HUE.accent : (p.k % 4 < 2 ? HUE.bright : HUE.dim));
    const earY = Math.round((podTop + podBottom) / 2);
    fill(px, [[hx0 - 1, earY], [hx1 + 1, earY]], ear);
  }
  // the helmet
  shade(px, roundRect(hx0, hTop, hx1, hBottom, Z.helmR), P.helm);
  // the antenna: a stalk and its light, both on a spring
  const ax = clampI(p.ant.x, -2, 2), ay = clampI(p.ant.y, -1, 1);
  const stalk = Z.stalk ? Math.max(0, Z.stalk - ay) : 0;
  const lx0 = left(2, lean + ax);
  const antLight = asleep ? 240 : p.antColor ?? (ready ? HUE.accent : [HUE.dim, HUE.accent, HUE.bright, HUE.light, HUE.bright, HUE.accent][p.k % 6]);
  if (stalk) { const st = left(2, lean + Math.trunc(ax / 2)); fill(px, roundRect(st, hTop - stalk, st + 1, hTop - 1), P.stalk); fill(px, [[st + 1, hTop - 1]], P.stalkDark); }
  fill(px, [[lx0, hTop - stalk - 1], [lx0 + 1, hTop - stalk - 1]], antLight);
  if (!asleep) fill(px, [[lx0, hTop - stalk - 1]], p.antColor ?? (ready ? P.eyeHi ?? HUE.light : antLight)); // the bulb's glint

  // the visor, turned a pixel toward where it looks: dark glass, lighter at the top, a light lip
  const turn = clampI(p.turn, -1, 1);
  const [ix, it, ib] = Z.inset;
  const vx0 = hx0 + ix + turn, vx1 = hx1 - ix + turn, vTop = hTop + it, vBottom = hBottom - (hh <= 5 ? 1 : ib);
  const visor = roundRect(vx0, vTop, vx1, vBottom, small ? 0 : 1);
  const inV = edgeOf(visor);
  for (const [x, y] of visor) {
    if (!inside(x, y)) continue;
    const row = y - vTop, rows = vBottom - vTop;
    px[y][x] = Z.lip && !inV(x, y + 1) ? P.lip : !inV(x + 1, y) ? P.edge : row === 0 ? P.visor[0] : row < rows / 2 ? P.visor[1] : P.visor[2];
  }
  if (Z.glint) { fill(px, [[vx0 + 1, vTop]], P.glint); fill(px, [[vx0, vTop + 1]].filter(([x, y]) => inV(x, y)), P.glint2); }
  else fill(px, [[vx0, vTop]], P.shine); // the glass's shine, top left

  // the eyes
  const [ew, eh] = Z.eye;
  const dx = clampI(p.look.x, -1, 1), dy = clampI(p.look.y, -1, 1);
  const eyeY = vTop + (small ? 0 : 1);
  const eyeXs = [vx0 + Z.eyeIn + dx, vx1 - Z.eyeIn - ew + 1 + dx];
  const floor = Z.lip ? vBottom - 1 : vBottom;
  const put = (pts, c) => fill(px, pts.filter(([x, y]) => inV(x, y) && y <= floor), c);
  const ey = Math.max(vTop, Math.min(floor - eh + 1, eyeY + dy));
  const block = (ex, y0, h) => Array.from({ length: ew * h }, (_, j) => [ex + (j % ew), y0 + Math.floor(j / ew)]);
  for (const [i, ex] of eyeXs.entries()) {
    const s = i === 0 ? -1 : 1;
    switch (asleep ? 'shut' : p.eyes) {
      case 'blink': put(block(ex, ey + eh - 1, 1), eh > 1 ? eyeLit : HUE.deep); break;
      case 'half': put(block(ex, ey + eh - 1, 1), eh > 1 ? eyeLit : HUE.dim); break;
      case 'shut': put(Array.from({ length: ew + 1 }, (_, j) => [ex - (s < 0 ? 0 : 1) + j, ey + eh - 1]), asleep ? HUE.deep : eyeLit); break;
      case 'happy':
        put(ew > 1 ? [[ex - 1, ey + 1], [ex, ey], [ex + 1, ey], [ex + 2, ey + 1]] : [[ex - 1, ey + 1], [ex, ey], [ex + 1, ey + 1]], eyeLit);
        put([[ex, ey]], eyeGlint);
        if (P.blush && hBottom > vBottom) fill(px, [[s < 0 ? hx0 + 1 : hx1 - 1, vBottom + 1]], P.blush); // pink cheeks
        break;
      case 'squint': put(ew > 1 ? [[ex + (s < 0 ? 0 : 1), ey], [ex + (s < 0 ? 1 : 0), ey + 1]] : [[ex, ey + 1]], eyeLit); break;
      case 'wide': {
        const top = Math.max(vTop, ey - 1);
        put(block(ex, top, Math.min(eh + 1, floor - top + 1)), eyeLit);
        put([[ex, top]], eyeGlint);
        break;
      }
      default:
        put(block(ex, ey, eh), eyeLit);
        put(block(ex, ey, 1), eyeGlint); // the top of each eye lit brighter
    }
    // the eye's glow on the glass's lip under it
    if (P.halo && Z.lip && ['open', 'wide', 'happy'].includes(p.eyes)) for (let j = 0; j < ew; j++) if (inV(ex + j, vBottom)) px[vBottom][ex + j] = P.halo;
  }
  // asleep: a z drifting up from the helmet's corner
  if (p.z != null) {
    const zx = hx1 - 1 + Math.floor(p.z / 2), zy = hTop - (small ? 3 : 4) - p.z;
    fill(px, [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]].map(([x, y]) => [zx + x, zy + y]), p.z >= 3 ? 239 : 243);
  }
  return px;
}

// Curled up mid-jump: a helmet ball, spinning (spin 0 its visor to you, 1 turned right, 2 its back,
// 3 turned left), the antenna light going round with it.
function ball(px, p, P, asleep) {
  const cx = MID, cy = GROUND - 3, r = 3.5;
  const pts = [];
  for (let y = GROUND - 7; y <= GROUND; y++) for (let x = 9; x <= 22; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) pts.push([x, y]);
  shade(px, pts, P.helm);
  const inB = edgeOf(pts);
  const spin = ((p.spin % 4) + 4) % 4;
  const lit = asleep ? 240 : p.antColor ?? HUE.accent;
  const vy = Math.round(cy) - 1;
  if (spin !== 2) {
    const off = spin === 1 ? 1 : spin === 3 ? -1 : 0, w = spin === 0 ? 4 : 3;
    const vx0 = Math.round(cx - w / 2 + 0.5 + off), vx1 = vx0 + w - 1;
    for (let y = vy; y <= vy + 1; y++) for (let x = vx0; x <= vx1; x++) if (inB(x, y) && inB(x + 1, y) && inB(x - 1, y)) px[y][x] = y === vy + 1 ? P.lip : P.visor[1];
    const eyes = spin === 0 ? [vx0, vx1] : [spin === 1 ? vx1 : vx0];
    for (const ex of eyes) if (inB(ex, vy)) px[vy][ex] = HUE.light;
  } else fill(px, [[15, vy], [16, vy]], P.helm[3]);
  const at = [[15, GROUND - 7], [Math.round(cx + 3.5), vy], [15, GROUND + 1], [Math.round(cx - 4.5), vy]][spin];
  fill(px, [[at[0], at[1]], [at[0] + 1, at[1]]].filter(([, y]) => y <= GROUND), lit);
  return px;
}

// ── Pixels to characters ──────────────────────────────────────────────────────────────────────
// Two pixel rows to a character, drawn for how Terminal.app draws SF Mono (start.jsx botGlyph, measured
// from Terminal's own font): each cell takes the glyph whose thin sliver matches the pixels beside it.
const WINDOW_GREY = 30;
const CUBE = [0, 95, 135, 175, 215, 255];
function greyOf(n) {
  if (n == null) return WINDOW_GREY;
  if (n >= 232) return 8 + (n - 232) * 10;
  if (n < 16) return [0, 128, 0, 128, 0, 128, 0, 192, 128, 255, 0, 255, 0, 255, 0, 255][n] ?? 128;
  const i = n - 16;
  return Math.round(0.3 * CUBE[Math.floor(i / 36)] + 0.59 * CUBE[Math.floor(i / 6) % 6] + 0.11 * CUBE[i % 6]);
}
const apart = (a, b) => Math.abs(greyOf(a) - greyOf(b));
export function botGlyph(up, top, bottom, down) {
  if (top == null && bottom == null) return { ch: ' ' };
  if (top === bottom) return { ch: ' ', bg: top };
  const lower = 0.175 * Math.min(apart(top, bottom), apart(top, down));
  const upper = top == null ? Infinity : 2.145 * Math.min(apart(bottom, up), apart(bottom, top));
  if (upper < lower) return { ch: '▀', fg: top, bg: bottom ?? undefined };
  if (bottom == null) return { ch: '▄', fg: top, inverse: true };
  return { ch: '▄', fg: bottom, bg: top ?? undefined };
}

// The pose's pixels cut to what it covers: { px, x0, y0 } (x0, y0: where the cut starts on the canvas).
export function trimmed(px) {
  let x0 = RIG_W, x1 = -1, y0 = RIG_H, y1 = -1;
  px.forEach((row, y) => row.forEach((c, x) => { if (c != null) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  if (x1 < 0) return { px: [], x0: 0, y0: 0 };
  return { px: px.slice(y0, y1 + 1).map((row) => row.slice(x0, x1 + 1)), x0, y0 };
}
