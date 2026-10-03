// The hub's tab icon (1 Oct 2026): the Visor bot, ready, as a 48 × 48 PNG. Without one, every page
// the hub served (the design pages, All docs, each tab) asked for /favicon.ico, got a 404, and the
// browser logged an error. Drawn from the start page's own pixels, so it is the bot in the terminal.
import { deflateSync } from 'node:zlib';
import { botPixels } from './start.jsx';

const CUBE = [0, 95, 135, 175, 215, 255];
const BASE16 = [[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192], [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];
// An xterm-256 colour as red, green, blue.
export function rgbOf(n) {
  if (n < 16) return BASE16[n];
  if (n >= 232) { const g = 8 + (n - 232) * 10; return [g, g, g]; }
  const i = n - 16;
  return [CUBE[Math.floor(i / 36)], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]];
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
// A PNG of rgba (w × h × 4 bytes): 8-bit colour with alpha, rows unfiltered.
export function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6; // 8 bits, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const ICON_SIZE = 48;
let icon = null;
// The bot (22 × 20 pixels) twice as big, in the middle of a clear 48 × 48 square.
export function faviconPng() {
  if (icon) return icon;
  const px = botPixels('ready');
  const S = ICON_SIZE, scale = 2;
  const ox = (S - px[0].length * scale) >> 1, oy = (S - px.length * scale) >> 1;
  const rgba = new Uint8Array(S * S * 4);
  px.forEach((row, y) => row.forEach((c, x) => {
    if (c == null) return;
    const [r, g, b] = rgbOf(c);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) rgba.set([r, g, b, 255], ((oy + y * scale + dy) * S + ox + x * scale + dx) * 4);
  }));
  icon = png(S, S, rgba);
  return icon;
}
