// The terminal window as the app sees it. Resizing redraws everything, like
// Claude Code: while you drag the window edge nothing is drawn; once the size
// has held still for a moment the window is cleared and the whole
// conversation is printed again at the new size, with the prompt box on the
// last lines. (Ink on its own only redraws the live part, and on a narrower
// window leaves copies of it behind, because Terminal re-wraps the old lines
// before Ink erases them.)
import { EventEmitter } from 'node:events';

export const SETTLE_MS = 150;
// The smallest window the screen is laid out for; smaller shows a note instead.
export const MIN_COLS = 80;
export const MIN_ROWS = 24;
export const CLEAR = '\x1b[2J\x1b[3J\x1b[H'; // screen, scrollback, cursor home

export class TerminalWindow extends EventEmitter {
  constructor(out = process.stdout, { settleMs = SETTLE_MS } = {}) {
    super();
    this.out = out;
    this.settleMs = settleMs;
    this.columns = out.columns;
    this.rows = out.rows;
    this.isTTY = out.isTTY;
    this.resizing = false;
    this.redraws = 0;
    this.timer = null;
    this.onResize = () => {
      if (!this.resizing && out.columns === this.columns && out.rows === this.rows) return;
      this.resizing = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.settle(), this.settleMs);
    };
    out.on('resize', this.onResize);
  }

  // Ink writes through here. Mid-drag frames are dropped: the whole screen is
  // drawn again once the size settles.
  write(chunk, encoding, cb) {
    if (this.resizing) { (typeof encoding === 'function' ? encoding : cb)?.(); return true; }
    return this.out.write(chunk, encoding, cb);
  }

  settle() {
    this.timer = null;
    this.resizing = false;
    this.columns = this.out.columns;
    this.rows = this.out.rows;
    this.redraws++;
    // Frames were dropped during the drag, so the whole screen is drawn again,
    // even when the size ended where it started. The conversation is printed
    // again after blank lines (see Screen), so the prompt box ends on the last lines.
    this.out.write(CLEAR);
    // Only the app hears about it (not Ink's own resize handling, which would
    // draw one frame of the old layout at the new size first); the app's
    // next render lays everything out again at the new size.
    this.emit('redraw', { columns: this.columns, rows: this.rows });
  }

  // Stream bits Ink looks at.
  get writable() { return this.out.writable; }
  get writableEnded() { return this.out.writableEnded; }
  get destroyed() { return this.out.destroyed; }
  get writableLength() { return this.out.writableLength; }
  get _writableState() { return this.out._writableState; }
  getColorDepth(...a) { return this.out.getColorDepth?.(...a); }
  hasColors(...a) { return this.out.hasColors?.(...a); }

  dispose() { clearTimeout(this.timer); this.out.off('resize', this.onResize); }
}
