// A stand-in for the small model that compares meanings: words that mean
// the same share a slot, so "the suite" lands beside "the tests" as it
// does with the real model. Counts what it was asked, for the tests.
const SAME = [['test', 'tests', 'suite', 'check', 'checks', 'passes', 'pass'], ['page', 'pages', 'report', 'diagram', 'html'], ['legend', 'symbol', 'symbols', 'menu', 'dropdown', 'z-index', 'zindex'],
  ['commit', 'push', 'github'], ['docs', 'folder', 'save', 'saved'], ['flag', 'flags', 'json', 'export'], ['deploy', 'deploys', 'ssh', 'server']];
const slot = new Map(SAME.flatMap((g, i) => g.map((w) => [w, i])));
export class FakeEmbedder {
  constructor({ cut = 0.56, margin = 0.02, fail = false } = {}) { this.model = { id: 'fake', file: 'fake.gguf', cut, margin }; this.calls = []; this.fail = fail; }
  async embed(texts) {
    if (this.fail) throw new Error('not running');
    this.calls.push(texts);
    return texts.map((t) => {
      const v = new Float32Array(SAME.length + 24);
      for (const w of String(t).toLowerCase().match(/[a-z][a-z-]+/g) ?? []) {
        if (slot.has(w)) v[slot.get(w)] += 3;
        else if (w.length > 4) v[SAME.length + ([...w].reduce((s, c) => s + c.charCodeAt(0), 0) % 24)] += 0.4;
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / n);
    });
  }
}
