// A user's own folder (Agentic Coder Web, the Mac copy): list, read, upload (a .zip is unpacked),
// download one file or all of it as a .zip, delete. Every path is checked to stay inside the
// folder, links included: nothing here reads or writes outside it.
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, rmSync, lstatSync } from 'node:fs';
import { join, resolve, relative, sep, dirname, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const MAX_LIST = 3000;
export const MAX_UPLOAD = 200 * 1024 * 1024;
const SHOW_MAX = 512 * 1024;
// Agentic Coder's own notes in a folder are listed but not offered as plain files.
const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store']);

// The real path of `rel` inside `root`, or an Error saying why not. `make`: the parent may not exist yet.
export function inside(root, rel, { make = false } = {}) {
  const base = realpathSync(root);
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').some((p) => p === '..')) return new Error('a path may not go up out of your folder');
  const abs = resolve(base, clean);
  if (abs !== base && !abs.startsWith(`${base}${sep}`)) return new Error('that path is outside your folder');
  // Every part that exists must be a real place inside the folder (a link out of it is refused).
  let probe = abs;
  while (!existsSync(probe) && probe !== base) probe = dirname(probe);
  const real = realpathSync(probe);
  if (real !== base && !real.startsWith(`${base}${sep}`)) return new Error('that path leads outside your folder');
  if (make) mkdirSync(dirname(abs), { recursive: true });
  return abs;
}

export function listFiles(root) {
  const out = [];
  if (!existsSync(root)) return { files: out, cut: false };
  const base = realpathSync(root);
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (HIDDEN.has(name) || out.length >= MAX_LIST) continue;
      const p = join(dir, name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      const rel = relative(base, p);
      if (st.isDirectory()) { out.push({ path: rel, dir: true, at: st.mtimeMs }); walk(p); } else out.push({ path: rel, bytes: st.size, at: st.mtimeMs });
    }
  };
  walk(base);
  return { files: out, cut: out.length >= MAX_LIST };
}

// A file to show in the page: its text when it is small and text, else only that it is there.
export async function showFile(root, rel) {
  const abs = inside(root, rel);
  if (abs instanceof Error) return abs;
  if (!existsSync(abs) || statSync(abs).isDirectory()) return new Error('no such file');
  const st = statSync(abs);
  if (st.size > SHOW_MAX) return { path: rel, bytes: st.size, text: null, why: 'too big to show here: download it' };
  const buf = Buffer.from(await Bun.file(abs).arrayBuffer());
  const binary = buf.subarray(0, 8000).includes(0);
  return { path: rel, bytes: st.size, text: binary ? null : buf.toString('utf8'), why: binary ? 'not text: download it' : null };
}

export function fileResponse(root, rel) {
  const abs = inside(root, rel);
  if (abs instanceof Error || !existsSync(abs) || statSync(abs).isDirectory()) return null;
  return new Response(Bun.file(abs), { headers: { 'content-disposition': `attachment; filename="${basename(abs).replace(/"/g, '')}"`, 'cache-control': 'no-store' } });
}

// Upload one file at rel. A .zip (unzip: true) is unpacked into the folder it names, after its
// list of entries is checked: no entry may go up and out, or be a link.
export async function putFile(root, rel, data, { unzip = false } = {}) {
  if (data.byteLength > MAX_UPLOAD) return new Error(`a file may be ${MAX_UPLOAD / 1024 / 1024} MB at most`);
  if (unzip && /\.zip$/i.test(rel)) {
    const at = inside(root, dirname(rel) === '.' ? '' : dirname(rel), { make: true });
    if (at instanceof Error) return at;
    mkdirSync(at, { recursive: true });
    const tmp = join(realpathSync(root), `.upload-${process.pid}-${Date.now()}.zip`);
    await Bun.write(tmp, data);
    try {
      const list = spawnSync('/usr/bin/unzip', ['-Z1', tmp], { encoding: 'utf8' });
      if (list.status !== 0) return new Error('that .zip could not be read');
      const names = list.stdout.split('\n').filter(Boolean);
      if (names.some((n) => n.startsWith('/') || n.split('/').includes('..'))) return new Error('that .zip has paths that go outside the folder; nothing was unpacked');
      const links = spawnSync('/usr/bin/zipinfo', [tmp], { encoding: 'utf8' }).stdout.split('\n').some((l) => /^l/.test(l));
      if (links) return new Error('that .zip holds links; nothing was unpacked');
      const r = spawnSync('/usr/bin/unzip', ['-o', '-q', tmp, '-d', at], { encoding: 'utf8' });
      if (r.status !== 0) return new Error(`unpacking failed: ${(r.stderr || '').trim().slice(0, 200)}`);
      return { unpacked: names.length, at: relative(realpathSync(root), at) || '.' };
    } finally { rmSync(tmp, { force: true }); }
  }
  const abs = inside(root, rel, { make: true });
  if (abs instanceof Error) return abs;
  if (existsSync(abs) && statSync(abs).isDirectory()) return new Error('there is a folder with that name');
  await Bun.write(abs, data);
  return { path: relative(realpathSync(root), abs), bytes: data.byteLength };
}

export function removePath(root, rel) {
  const abs = inside(root, rel);
  if (abs instanceof Error) return abs;
  if (abs === realpathSync(root)) return new Error('your folder itself stays');
  if (!existsSync(abs)) return new Error('no such file');
  rmSync(abs, { recursive: true, force: true });
  return { removed: rel };
}

// The whole folder as a .zip, streamed as zip writes it (without .git and node_modules).
export function zipResponse(root, name = 'folder') {
  const base = realpathSync(root);
  const p = spawn('/usr/bin/zip', ['-r', '-q', '-y', '-', '.', '-x', '.git/*', '*/.git/*', 'node_modules/*', '*/node_modules/*'], { cwd: base, stdio: ['ignore', 'pipe', 'ignore'] });
  const body = new ReadableStream({
    start(ctl) {
      p.stdout.on('data', (d) => ctl.enqueue(new Uint8Array(d)));
      p.stdout.on('end', () => ctl.close());
      p.on('error', (e) => ctl.error(e));
    },
    cancel() { p.kill(); },
  });
  return new Response(body, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}.zip"`, 'cache-control': 'no-store' } });
}
