// The workbench's debugger (27 Nov 2026, the owner's pick: "breakpoints, step through, see variables, node and bun
// first"; workbench-debug.js draws it). A file of the folder runs under node's or bun's own inspector, and this file
// speaks to that inspector over its WebSocket: node's Chrome DevTools protocol, or bun's WebKit one, which share the
// calls used here. What the page asks comes as { t: 'wbx-dbg', op, id, … } and what happens goes back the same way:
// started, paused (with the call stack and its scopes), resumed, out (what the program prints), answer (a scope's
// variables, an expression's value), ended. Nothing is installed for it.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside } from './workbench.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BANNER = /^(Debugger listening on|For help, see|Debugger attached|Waiting for the debugger to disconnect|-+ Bun Inspector -+|Listening:|Inspect in browser:|\s+(ws|https?):\/\/\S+\s*$|-{20,})/;

// node, unless the file uses bun's own calls (node 22.6 and later runs TypeScript too). The page can pick either. Bun
// stays open after the program ends while a debugger is attached (tried 27 Nov 2026, bun 1.4.2: nothing in its inspector
// says the program is done), so a bun run ends with Stop; node ends by itself.
export function runtimeFor(folder, rel) {
  try { if (/from\s+['"]bun(:|['"])|\bBun\.\w/.test(readFileSync(join(folder, rel), 'utf8').slice(0, 200_000))) return 'bun'; } catch {}
  return 'node';
}
const freePort = () => { const s = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } }); const p = s.port; s.stop(true); return p; };
// A value as the variables list shows it: its own text for a short one, else what kind of thing it is.
export function valueOf(o) {
  if (!o) return 'undefined';
  if (o.type === 'string') { const s = JSON.stringify(o.value ?? ''); return s.length > 300 ? `${s.slice(0, 299)}…"` : s; }
  if (o.type === 'undefined') return 'undefined';
  if (o.subtype === 'null') return 'null';
  if (o.type === 'number' || o.type === 'boolean' || o.type === 'bigint') return String(o.value ?? o.description ?? o.unserializableValue);
  if (o.type === 'symbol') return o.description ?? 'Symbol()';
  if (o.type === 'function') return `ƒ ${String(o.description ?? '').split('\n')[0].replace(/^function\s*/, '').slice(0, 80)}`;
  return o.description ?? o.className ?? o.type;
}

export function makeDebugger({ folder, env = process.env, send = () => {}, which = (n) => Bun.which(n) } = {}) {
  const runs = new Map();
  const say = (s, o) => send({ t: 'wbx-dbg', id: s.id, ...o });
  const relOf = (url) => {
    let abs = String(url ?? ''); if (!abs) return null;
    if (abs.startsWith('file://')) { try { abs = fileURLToPath(abs); } catch { return null; } }
    if (!abs.startsWith('/')) return null;
    const rel = relative(folder, abs).split(sep).join('/');
    return rel.startsWith('..') ? null : rel;
  };
  function call(s, method, params = {}) {
    return new Promise((res) => {
      if (!s.ws || s.ws.readyState !== 1) return res({ error: 'not connected' });
      const id = ++s.seq; s.pending.set(id, res);
      try { s.ws.send(JSON.stringify({ id, method, params })); } catch (e) { s.pending.delete(id); res({ error: e.message }); }
      setTimeout(() => { if (s.pending.delete(id)) res({ error: `${method} took too long` }); }, 10_000);
    });
  }
  async function setBp(s, path, line) {
    const abs = inside(folder, path); if (!abs) return;
    const key = `${path}:${line}`; if (s.bps.has(key)) return;
    const r = await call(s, 'Debugger.setBreakpointByUrl', { lineNumber: line - 1, urlRegex: `^(file://)?${esc(abs)}$`, columnNumber: 0 });
    s.bps.set(key, r?.result?.breakpointId ?? null);
  }
  async function dropBp(s, path, line) {
    const key = `${path}:${line}`; const bid = s.bps.get(key); s.bps.delete(key);
    if (bid) await call(s, 'Debugger.removeBreakpoint', { breakpointId: bid });
  }
  function onEvent(s, m) {
    if (m.method === 'Debugger.scriptParsed') { if (m.params?.url) s.scripts.set(m.params.scriptId, m.params.url); return; }
    if (m.method === 'Debugger.paused') {
      const p = m.params ?? {};
      // node stops before the first line under --inspect-brk; that is not a stop of yours
      if (!s.stopOnEntry && !s.entryDone && /Break on start/i.test(p.reason ?? '')) { s.entryDone = true; call(s, 'Debugger.resume'); return; }
      s.entryDone = true;
      const frames = (p.callFrames ?? []).slice(0, 60).map((f) => {
        const url = f.url || s.scripts.get(f.location?.scriptId) || '';
        return { callFrameId: f.callFrameId, name: f.functionName || '(anonymous)', path: relOf(url), url, line: (f.location?.lineNumber ?? 0) + 1, col: (f.location?.columnNumber ?? 0) + 1,
          scopes: (f.scopeChain ?? []).map((sc) => ({ type: sc.type, name: sc.name ?? null, objectId: sc.object?.objectId ?? null })).filter((sc) => sc.objectId) };
      });
      s.paused = { frames };
      say(s, { op: 'paused', reason: p.reason ?? 'pause', frames, hit: p.hitBreakpoints?.length > 0, error: p.reason === 'exception' ? valueOf(p.data) : null });
      return;
    }
    if (m.method === 'Debugger.resumed') { s.paused = null; say(s, { op: 'resumed' }); return; }
    if (m.method === 'Runtime.executionContextDestroyed' && s.proto === 'cdp') { try { s.ws.close(); } catch {} }
  }
  async function connect(s, url) {
    const ws = new WebSocket(url); s.ws = ws;
    ws.onmessage = (e) => { let m; try { m = JSON.parse(String(e.data)); } catch { return; } if (m.id && s.pending.has(m.id)) { const r = s.pending.get(m.id); s.pending.delete(m.id); r(m); } else if (m.method) onEvent(s, m); };
    ws.onclose = () => { s.ws = null; };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('the inspector did not answer')); });
    if (s.proto === 'webkit') await call(s, 'Inspector.enable');
    await call(s, 'Runtime.enable');
    await call(s, 'Debugger.enable');
    if (s.proto === 'webkit') await call(s, 'Debugger.setBreakpointsActive', { active: true });
    for (const [path, lines] of Object.entries(s.want ?? {})) for (const line of lines) await setBp(s, path, line);
    if (s.proto === 'webkit') await call(s, 'Inspector.initialized');
    else await call(s, 'Runtime.runIfWaitingForDebugger');
    say(s, { op: 'started', runtime: s.runtime, path: s.path });
  }

  return {
    start({ id, path, runtime = null, args = [], bps = {}, stopOnEntry = false } = {}) {
      if (!id || runs.has(id)) return { ok: false, why: 'That run is under way.' };
      const abs = inside(folder, String(path ?? ''));
      if (!abs || !existsSync(abs)) return { ok: false, why: 'That file is not in this folder.' };
      const rt = runtime === 'bun' || runtime === 'node' ? runtime : runtimeFor(folder, path);
      const bin = which(rt); if (!bin) return { ok: false, why: `${rt} is not on this Mac's PATH.` };
      const port = rt === 'bun' ? freePort() : 0;
      const cmd = rt === 'bun' ? [bin, `--inspect-wait=127.0.0.1:${port}/wbx${Math.random().toString(36).slice(2, 8)}`, abs, ...args] : [bin, '--inspect-brk=127.0.0.1:0', abs, ...args];
      const childEnv = { ...env, FORCE_COLOR: '0' };
      for (const k of ['AGENTIC_WINDOW_SOCK', 'AGENTIC_WINDOW_KEY', 'AGENTIC_WINDOW_CHILD', 'AGENTIC_WINDOW_URL', 'AGENTIC_IN_HOST', 'NODE_OPTIONS']) delete childEnv[k];
      let proc; try { proc = spawn(cmd[0], cmd.slice(1), { cwd: folder, env: childEnv, detached: true }); } catch (e) { return { ok: false, why: e.message }; }
      const s = { id, path, runtime: rt, proto: rt === 'bun' ? 'webkit' : 'cdp', proc, ws: null, seq: 0, pending: new Map(), scripts: new Map(), bps: new Map(), want: bps, paused: null, stopOnEntry, entryDone: rt === 'bun', connecting: false };
      runs.set(id, s);
      let buf = '';
      const out = (d, err) => {
        const text = d.toString('utf8');
        if (!s.ws && !s.connecting) {
          buf += text;
          const m = /(ws:\/\/[^\s]+)/.exec(buf);
          if (m) { s.connecting = true; connect(s, m[1]).catch((e) => say(s, { op: 'out', text: `The debugger could not attach: ${e.message}\n`, err: true })); }
        }
        if (/Waiting for the debugger to disconnect/.test(text)) { try { s.ws?.close(); } catch {} }
        const shown = text.split('\n').filter((l) => !BANNER.test(l)).join('\n');
        if (shown.trim()) say(s, { op: 'out', text: shown, err });
      };
      proc.stdout.on('data', (d) => out(d, false)); proc.stderr.on('data', (d) => out(d, true));
      proc.on('error', (e) => say(s, { op: 'out', text: `${e.message}\n`, err: true }));
      proc.on('close', (code) => { runs.delete(id); try { s.ws?.close(); } catch {} for (const r of s.pending.values()) r({ error: 'ended' }); say(s, { op: 'ended', code }); });
      return { ok: true, id, runtime: rt };
    },
    async cmd({ id, op, req = null, ...a } = {}) {
      const s = runs.get(id); if (!s) return;
      const answer = (o) => say(s, { op: 'answer', req, ...o });
      if (op === 'resume' || op === 'stepOver' || op === 'stepInto' || op === 'stepOut' || op === 'pause') return void call(s, `Debugger.${op}`);
      if (op === 'bp') { if (a.on) await setBp(s, a.path, a.line); else await dropBp(s, a.path, a.line); return; }
      if (op === 'props') {
        const r = await call(s, 'Runtime.getProperties', { objectId: a.objectId, ownProperties: true, generatePreview: false });
        const list = r?.result?.result ?? r?.result?.properties ?? [];
        // a let or const not reached yet comes with no value: said so, as VS Code does
        return answer({ vars: list.filter((p) => p.name !== '__proto__').slice(0, 400).map((p) => ({ name: p.name, value: p.value ? valueOf(p.value) : p.get ? '(getter)' : '(not set yet)', type: p.value?.type ?? (p.get ? 'accessor' : 'undefined'), objectId: p.value?.objectId ?? null })), why: r?.error ? String(r.error.message ?? r.error) : null });
      }
      if (op === 'eval') {
        const expr = String(a.expression ?? '').slice(0, 4000);
        const r = s.paused && a.callFrameId ? await call(s, 'Debugger.evaluateOnCallFrame', { callFrameId: a.callFrameId, expression: expr, generatePreview: false }) : await call(s, 'Runtime.evaluate', { expression: expr });
        const res = r?.result?.result, bad = r?.result?.exceptionDetails || r?.result?.wasThrown;
        return answer({ value: r?.error ? String(r.error.message ?? r.error) : valueOf(res), objectId: res?.objectId ?? null, bad: Boolean(bad || r?.error) });
      }
    },
    stop(id) { const s = runs.get(id); if (!s) return; try { s.ws?.close(); } catch {} try { process.kill(-s.proc.pid, 'SIGTERM'); } catch { try { s.proc.kill('SIGTERM'); } catch {} } },
    stopAll() { for (const id of [...runs.keys()]) this.stop(id); },
    get size() { return runs.size; },
  };
}
