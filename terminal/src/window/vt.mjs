// A small terminal screen (12 Oct 2026, for the window: terminal/src/window/server.mjs runs the app in a
// pretend terminal and keeps what it drew here). Enough of what Ink and the app write: text and wide
// characters, the cursor moves, erasing, colours (xterm-256 and true colour), the other screen, scrolling,
// and the app's question where the cursor is (answered through `reply`). Plain data, no screen of its own:
// the window draws a part of it where it has no view of its own yet (a picker, /agents' tree, /loop's board).
import stringWidth from 'string-width';

const blank = () => ({ ch: ' ', fg: null, bg: null, b: false, d: false, i: false, u: false, v: false });
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
const graphemes = (s) => (seg ? [...seg.segment(s)].map((x) => x.segment) : [...s]);

export class VtScreen {
  constructor(cols = 120, rows = 40, { reply = () => {} } = {}) {
    this.reply = reply;
    this.cols = cols; this.rows = rows;
    this.main = this.#grid(); this.alt = this.#grid(); this.grid = this.main; this.onAlt = false;
    this.x = 0; this.y = 0; this.pending = false; this.saved = { x: 0, y: 0 };
    this.st = blank(); this.cursorOn = true;
    this.state = 'text'; this.buf = '';
    this.changed = 0; // grows with every write: the window asks for the screen again only when it did
  }
  #grid() { return Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, blank)); }
  resize(cols, rows) {
    const fit = (g) => {
      const out = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => g[y + Math.max(0, g.length - rows)]?.[x] ?? blank()));
      return out;
    };
    this.main = fit(this.main); this.alt = fit(this.alt); this.grid = this.onAlt ? this.alt : this.main;
    this.cols = cols; this.rows = rows;
    this.x = Math.min(this.x, cols - 1); this.y = Math.min(this.y, rows - 1); this.changed++;
  }
  // What was drawn, as text rows (for tests and a quick look) and as cells (for the window).
  text() { return this.grid.map((r) => r.map((c) => c.ch).join('').replace(/\s+$/, '')); }
  cells() { return this.grid; }

  write(data) {
    const s = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    let run = '';
    const flush = () => { if (run) { this.#print(run); run = ''; } };
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (this.state === 'text') {
        if (c === '\x1b') { flush(); this.state = 'esc'; continue; }
        if (c < ' ' || c === '\x7f') { flush(); this.#control(c); continue; }
        run += c;
        continue;
      }
      if (this.state === 'esc') {
        if (c === '[') { this.state = 'csi'; this.buf = ''; continue; }
        if (c === ']') { this.state = 'osc'; this.buf = ''; continue; }
        if (c === '(' || c === ')') { this.state = 'charset'; continue; }
        if (c === '7') this.saved = { x: this.x, y: this.y };
        else if (c === '8') { this.x = this.saved.x; this.y = this.saved.y; this.pending = false; }
        else if (c === 'D') this.#lf();
        else if (c === 'M') { if (this.y === 0) this.#scrollDown(1); else this.y--; }
        else if (c === 'E') { this.x = 0; this.#lf(); }
        else if (c === 'c') { this.grid = this.onAlt ? (this.alt = this.#grid()) : (this.main = this.#grid()); this.x = this.y = 0; }
        this.state = 'text';
        continue;
      }
      if (this.state === 'charset') { this.state = 'text'; continue; }
      if (this.state === 'osc') {
        if (c === '\x07') { this.state = 'text'; continue; }
        if (c === '\x1b' && s[k + 1] === '\\') { k++; this.state = 'text'; continue; }
        this.buf += c;
        continue;
      }
      if (this.state === 'csi') {
        if (c >= '@' && c <= '~') { this.#csi(this.buf, c); this.state = 'text'; continue; }
        this.buf += c;
      }
    }
    flush();
    this.changed++;
  }

  #print(text) {
    for (const g of graphemes(text)) {
      const w = Math.max(0, stringWidth(g));
      if (w === 0) { const prev = this.grid[this.y][Math.max(0, this.x - 1)]; if (prev) prev.ch += g; continue; }
      if (this.pending || this.x + w > this.cols) { this.x = 0; this.#lf(); this.pending = false; }
      const row = this.grid[this.y];
      row[this.x] = { ...this.st, ch: g };
      if (w === 2 && this.x + 1 < this.cols) row[this.x + 1] = { ...this.st, ch: '' };
      this.x += w;
      if (this.x >= this.cols) { this.x = this.cols - 1; this.pending = true; }
    }
  }
  #control(c) {
    if (c === '\r') { this.x = 0; this.pending = false; }
    else if (c === '\n' || c === '\x0b' || c === '\x0c') { this.#lf(); this.pending = false; }
    else if (c === '\b') { this.x = Math.max(0, this.x - 1); this.pending = false; }
    else if (c === '\t') { this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8); }
  }
  #lf() { if (this.y === this.rows - 1) this.#scrollUp(1); else this.y++; }
  #scrollUp(n) { for (let k = 0; k < n; k++) { this.grid.shift(); this.grid.push(Array.from({ length: this.cols }, blank)); } }
  #scrollDown(n) { for (let k = 0; k < n; k++) { this.grid.pop(); this.grid.unshift(Array.from({ length: this.cols }, blank)); } }
  #erase(y, from, to) { const r = this.grid[y]; if (!r) return; for (let x = Math.max(0, from); x < Math.min(this.cols, to); x++) r[x] = { ...blank(), bg: this.st.bg }; }

  #csi(params, f) {
    const priv = params.startsWith('?');
    const ps = (priv ? params.slice(1) : params).split(';').map((p) => (p === '' ? null : Number(p)));
    const n = (i = 0, d = 1) => (ps[i] == null || Number.isNaN(ps[i]) ? d : ps[i]);
    this.pending = false;
    switch (f) {
      case 'A': this.y = Math.max(0, this.y - n()); break;
      case 'B': this.y = Math.min(this.rows - 1, this.y + n()); break;
      case 'C': this.x = Math.min(this.cols - 1, this.x + n()); break;
      case 'D': this.x = Math.max(0, this.x - n()); break;
      case 'E': this.x = 0; this.y = Math.min(this.rows - 1, this.y + n()); break;
      case 'F': this.x = 0; this.y = Math.max(0, this.y - n()); break;
      case 'G': this.x = Math.min(this.cols - 1, n() - 1); break;
      case 'd': this.y = Math.min(this.rows - 1, n() - 1); break;
      case 'H': case 'f': this.y = Math.min(this.rows - 1, n(0) - 1); this.x = Math.min(this.cols - 1, n(1) - 1); break;
      case 'J': {
        const m = n(0, 0);
        if (m === 0) { this.#erase(this.y, this.x, this.cols); for (let y = this.y + 1; y < this.rows; y++) this.#erase(y, 0, this.cols); }
        else if (m === 1) { this.#erase(this.y, 0, this.x + 1); for (let y = 0; y < this.y; y++) this.#erase(y, 0, this.cols); }
        else for (let y = 0; y < this.rows; y++) this.#erase(y, 0, this.cols);
        break;
      }
      case 'K': { const m = n(0, 0); if (m === 0) this.#erase(this.y, this.x, this.cols); else if (m === 1) this.#erase(this.y, 0, this.x + 1); else this.#erase(this.y, 0, this.cols); break; }
      case 'X': this.#erase(this.y, this.x, this.x + n()); break;
      case 'P': { const r = this.grid[this.y]; r.splice(this.x, n()); while (r.length < this.cols) r.push(blank()); break; }
      case '@': { const r = this.grid[this.y]; r.splice(this.x, 0, ...Array.from({ length: n() }, blank)); r.length = this.cols; break; }
      case 'L': for (let k = 0; k < n(); k++) { this.grid.splice(this.y, 0, Array.from({ length: this.cols }, blank)); this.grid.length = this.rows; } break;
      case 'M': for (let k = 0; k < n(); k++) { this.grid.splice(this.y, 1); this.grid.push(Array.from({ length: this.cols }, blank)); } break;
      case 'S': this.#scrollUp(n()); break;
      case 'T': this.#scrollDown(n()); break;
      case 's': this.saved = { x: this.x, y: this.y }; break;
      case 'u': this.x = this.saved.x; this.y = this.saved.y; break;
      case 'n': if (n(0, 0) === 6) this.reply(`\x1b[${this.y + 1};${this.x + 1}R`); break;
      case 'c': if (!priv) this.reply('\x1b[?1;2c'); break;
      case 'h': case 'l': {
        const on = f === 'h';
        for (const p of ps) {
          if (!priv) continue;
          if (p === 25) this.cursorOn = on;
          if (p === 1049 || p === 1047 || p === 47) {
            if (on && !this.onAlt) { this.saved = { x: this.x, y: this.y }; this.alt = this.#grid(); this.grid = this.alt; this.onAlt = true; }
            else if (!on && this.onAlt) { this.grid = this.main; this.onAlt = false; this.x = this.saved.x; this.y = this.saved.y; }
          }
        }
        break;
      }
      case 'm': this.#sgr(ps.map((p) => p ?? 0)); break;
      default: break;
    }
  }
  #sgr(ps) {
    if (!ps.length) ps = [0];
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      if (p === 0) this.st = blank();
      else if (p === 1) this.st.b = true;
      else if (p === 2) this.st.d = true;
      else if (p === 3) this.st.i = true;
      else if (p === 4) this.st.u = true;
      else if (p === 7) this.st.v = true;
      else if (p === 22) { this.st.b = false; this.st.d = false; }
      else if (p === 23) this.st.i = false;
      else if (p === 24) this.st.u = false;
      else if (p === 27) this.st.v = false;
      else if (p >= 30 && p <= 37) this.st.fg = p - 30;
      else if (p >= 90 && p <= 97) this.st.fg = p - 82;
      else if (p >= 40 && p <= 47) this.st.bg = p - 40;
      else if (p >= 100 && p <= 107) this.st.bg = p - 92;
      else if (p === 39) this.st.fg = null;
      else if (p === 49) this.st.bg = null;
      else if ((p === 38 || p === 48) && ps[k + 1] === 5) { this.st[p === 38 ? 'fg' : 'bg'] = ps[k + 2]; k += 2; }
      else if ((p === 38 || p === 48) && ps[k + 1] === 2) { const h = (v) => Number(v ?? 0).toString(16).padStart(2, '0'); this.st[p === 38 ? 'fg' : 'bg'] = `#${h(ps[k + 2])}${h(ps[k + 3])}${h(ps[k + 4])}`; k += 4; }
    }
    this.st = { ...this.st };
  }
}
