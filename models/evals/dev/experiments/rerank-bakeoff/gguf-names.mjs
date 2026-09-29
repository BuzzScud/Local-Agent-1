import { openSync, readSync } from 'node:fs';
const fd = openSync(process.argv[2], 'r');
const buf = Buffer.alloc(8 * 1024 * 1024); readSync(fd, buf, 0, buf.length, 0);
let o = 4; const u32 = () => { const v = buf.readUInt32LE(o); o += 4; return v; }; const u64 = () => { const v = Number(buf.readBigUInt64LE(o)); o += 8; return v; };
const str = () => { const n = u64(); const s = buf.toString('utf8', o, o + n); o += n; return s; };
const SZ = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const val = (t) => { if (t === 8) return str(); if (t === 9) { const at = u32(); const n = u64(); const out = []; for (let i = 0; i < n; i++) out.push(val(at)); return n > 8 ? `[${n} items]` : out; } const s = SZ[t]; const v = t === 6 ? buf.readFloatLE(o) : t === 4 ? buf.readUInt32LE(o) : t === 5 ? buf.readInt32LE(o) : t === 7 ? buf[o] : s === 8 ? Number(buf.readBigUInt64LE(o)) : buf[o]; o += s; return v; };
u32(); const nt = u64(); const nkv = u64();
const kv = {}; for (let i = 0; i < nkv; i++) { const k = str(); const t = u32(); kv[k] = val(t); }
const names = []; for (let i = 0; i < nt; i++) { const n = str(); const d = u32(); for (let j = 0; j < d; j++) u64(); u32(); u64(); names.push(n); }
console.log('arch', kv['general.architecture'], '| pooling', kv[`${kv['general.architecture']}.pooling_type`], '| labels', JSON.stringify(kv['classifier.output_labels'] ?? kv[`${kv['general.architecture']}.classifier.output_labels`] ?? null));
console.log('head tensors:', names.filter((n) => /cls|classif|pooler/i.test(n)).join(', ') || 'NONE', '| tensors', nt);
