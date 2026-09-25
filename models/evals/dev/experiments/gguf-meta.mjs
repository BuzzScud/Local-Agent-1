// Print the scalar metadata of a GGUF header (arrays shown by type + length only).
import { readFileSync } from 'node:fs';
const b = readFileSync(process.argv[2]);
let o = 0;
const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
const u64 = () => { const v = b.readBigUInt64LE(o); o += 8; return Number(v); };
const str = () => { const n = u64(); const s = b.toString('utf8', o, o + n); o += n; return s; };
const size = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
function val(t) {
  switch (t) {
    case 0: return b.readUInt8(o++); case 1: return b.readInt8(o++);
    case 2: { const v = b.readUInt16LE(o); o += 2; return v; } case 3: { const v = b.readInt16LE(o); o += 2; return v; }
    case 4: return u32(); case 5: { const v = b.readInt32LE(o); o += 4; return v; }
    case 6: { const v = b.readFloatLE(o); o += 4; return v; } case 7: return !!b.readUInt8(o++);
    case 8: return str();
    case 9: { const et = u32(); const n = u64();
      if (et === 8) { for (let i = 0; i < n; i++) str(); return `[string × ${n}]`; }
      if (n <= 80) { const a = []; for (let i = 0; i < n; i++) a.push(val(et)); return `[${a.join(',')}]`; }
      o += size[et] * n; return `[type ${et} × ${n}]`; }
    case 10: return u64(); case 11: { const v = b.readBigInt64LE(o); o += 8; return Number(v); }
    case 12: { const v = b.readDoubleLE(o); o += 8; return v; }
  }
  throw new Error('type ' + t);
}
if (b.toString('utf8', 0, 4) !== 'GGUF') throw new Error('not gguf');
o = 4; u32(); const nt = u64(); const nkv = u64();
console.log('tensors', nt);
for (let i = 0; i < nkv; i++) { const k = str(); const t = u32(); const v = val(t); if (!/tokenizer\.ggml\.(tokens|merges|token_type|scores)|chat_template/.test(k)) console.log(k, '=', v); else if (k.includes('chat_template')) console.log(k, '= (', String(v).length, 'chars)'); }
