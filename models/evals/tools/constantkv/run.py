#!/usr/bin/env python3
"""The model half of the ConstantKV check (models/evals/tools/constantkv-check.mjs starts it, in the Python of
~/.agentic-coder/engine/mlx-crystal-2.0.0). It uses only the calls the model's own Apache-licensed scripts use:
load_text_model, load_crystal_params, install, make_fest_cache, prefill, model.model, model.lm_head. The runtime
itself is closed (a research license that forbids taking it apart), so nothing here looks inside it.

It decides three of the check's four items, each printed as a PASS or FAIL line the moment it is known:
  (a) it loads and answers;
  (b) it reads >= 40 tokens a second up to 16k tokens;
  (c) it holds 64k tokens with a peak footprint <= 12.5 GB.
The fourth, (d) the app's tool calls, is read afterwards by the .mjs from the replies saved here.

Part 1: the app's start (its instructions and the tools a model gets, from app-prompt.json), one request, 3 tries
with Bonsai's sampling (temperature 0.7, top_p 0.8, top_k 20), thinking off; each reply is saved as agent-tryN.txt.
Part 2: two PG19 books from the model's own folder joined, read in blocks of 512 up to 65,536 tokens, 16 tokens
written at 4k, 16k, 32k and 64k; it stops early once (b) or (c) has failed, or the footprint passes 14 GB.
Everything also goes, one JSON object a line, into results.jsonl.

    python run.py <out folder> <app-prompt.json>        (CKV_PACK: the model's folder, if not the usual one)"""
import json, os, re, signal, subprocess, sys, threading, time
from pathlib import Path
import numpy as np

PACK = Path(os.environ.get('CKV_PACK') or os.path.expanduser('~/.agentic-coder/models/Ternary-Bonsai-2-27B-ConstantKV'))
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
APP = json.loads(Path(sys.argv[2]).read_text())
REQUEST = 'Create hello.py that prints the first 10 Fibonacci numbers, one per line, then run it.'
BAR_READ, BAR_PEAK, GUARD = 40.0, 12.5e9, 14e9
RES = open(OUT / 'results.jsonl', 'w')
said = set()


def rec(**kw):
    kw['at'] = time.strftime('%H:%M:%S'); RES.write(json.dumps(kw) + '\n'); RES.flush()
def say(s=''):
    print(s, flush=True)
def bar(item, ok, text, value=None):
    """One of (a)-(c), decided: a PASS or FAIL line (what the Arena counts) and its row in results.jsonl."""
    if item in said: return
    said.add(item)
    say(f'{"PASS" if ok else "FAIL"}  ({item}) {text}')
    rec(phase='bar', item=item, ok=bool(ok), value=value, text=text)
gb = lambda b: f'{b / 1e9:.1f} GB'
n = lambda x: f'{x:,}'


# Stop (the Arena's ■ Stop sends SIGTERM): end the way Control-C does, with what it has.
def stop(*_): raise KeyboardInterrupt
signal.signal(signal.SIGTERM, stop)

# ---- memory: this process's macOS footprint (what the app's memory guard reads), every 2 s
peak = {'fp': 0.0, 'now': 0.0, 'stop': False}
def footprint():
    r = subprocess.run(['/usr/bin/footprint', '-p', str(os.getpid())], capture_output=True, text=True, timeout=10)
    m = re.search(r'phys_footprint:\s+([\d.]+)\s*([KMG])B', r.stdout + r.stderr) or re.search(r'Footprint:\s+([\d.]+)\s*([KMG])B', r.stdout + r.stderr)
    return float(m.group(1)) * {'K': 1e3, 'M': 1e6, 'G': 1e9}[m.group(2)] if m else 0.0
def sampler():
    while not peak['stop']:
        try:
            v = footprint(); peak['now'] = v; peak['fp'] = max(peak['fp'], v)
        except Exception: pass
        time.sleep(2)
threading.Thread(target=sampler, daemon=True).start()
def mem_now():
    vm = subprocess.run(['vm_stat'], capture_output=True, text=True).stdout
    pg = lambda k: int(re.search(rf'{k}:\s+(\d+)', vm).group(1)) * 16384
    swap = re.search(r'used = ([\d.]+)M', subprocess.run(['sysctl', '-n', 'vm.swapusage'], capture_output=True, text=True).stdout)
    return dict(free_gb=round((pg('Pages free') + pg('Pages inactive') + pg('Pages purgeable')) / 1e9, 2), swap_gb=round(float(swap.group(1)) / 1e3, 2) if swap else None)


try:
    m0 = mem_now()
    say(f'Free memory at the start: {m0["free_gb"]:.1f} GB · swap used {m0["swap_gb"]} GB')
    rec(phase='start', **m0)

    # ---- load
    say('Loading the model (about a minute)…')
    import mlx.core as mx
    from crystal_runtime.mlx_bonsai import load_text_model, load_crystal_params
    from crystal_runtime.mlx_crystal import install
    from crystal_runtime.kristall_fest import make_fest_cache
    from crystal_runtime.monorail_routes import prefill
    from crystal_runtime import gated_delta_cuda
    mx.set_cache_limit(256 * 2**20)                       # as the author's scripts: keeps a 16 GB Mac out of swap
    t = time.time()
    model, cfg = load_text_model(str(PACK))
    params, opts = load_crystal_params(str(PACK), 'crystal'); install()
    gated_delta_cuda.aktivieren()                          # CUDA only; no-op on Metal
    time.sleep(2.5)
    say(f'Loaded in {time.time() - t:.0f} s · footprint {gb(peak["fp"])}')
    rec(phase='load', sec=round(time.time() - t, 1), mlx_active_gb=round(mx.get_active_memory() / 1e9, 2), footprint_gb=round(peak['fp'] / 1e9, 2))

    from tokenizers import Tokenizer
    from jinja2.sandbox import ImmutableSandboxedEnvironment
    tk = Tokenizer.from_file(str(PACK / 'tokenizer.json'))
    tc = json.loads((PACK / 'tokenizer_config.json').read_text())
    eos = {tk.token_to_id(x) for x in ('<|im_end|>', '<|endoftext|>') if tk.token_to_id(x) is not None}
    env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True, extensions=['jinja2.ext.loopcontrols'])
    env.filters['tojson'] = lambda x, indent=None, ensure_ascii=False: json.dumps(x, indent=indent, ensure_ascii=ensure_ascii)
    env.globals['raise_exception'] = lambda m: (_ for _ in ()).throw(ValueError(m))

    def sample(logits, rng, temperature=0.7, top_p=0.8, top_k=20):
        lg = np.array(logits.astype(mx.float32)).reshape(-1)
        idx = np.argpartition(-lg, top_k)[:top_k]; idx = idx[np.argsort(-lg[idx])]
        p = np.exp((lg[idx] - lg[idx[0]]) / temperature); p /= p.sum()
        keep = min(int(np.searchsorted(np.cumsum(p), top_p)) + 1, top_k)
        p = p[:keep] / p[:keep].sum()
        return int(rng.choice(idx[:keep], p=p))

    # ---- part 1: the app's real start, 3 tries
    txt = env.from_string((PACK / 'chat_template.jinja').read_text()).render(
        messages=[{'role': 'system', 'content': APP['system']}, {'role': 'user', 'content': REQUEST}],
        tools=APP['tools'], add_generation_prompt=True, enable_thinking=False, bos_token='', eos_token=tc.get('eos_token') or '')
    ids = tk.encode(txt, add_special_tokens=False).ids
    say(f'Part 1 of 2 · the app\'s real start ({n(len(ids))} tokens: its instructions, {len(APP["tools"])} tools, one request)')
    rec(phase='agent-prompt', tokens=len(ids))
    for k in (1, 2, 3):
        rng = np.random.default_rng(k)
        cache = make_fest_cache(model, params, opts, 8192)
        t = time.time()
        h = prefill(model, np.asarray(ids, np.int64), cache, 512)
        lg = model.lm_head(h[:, -1:])[0, -1]; mx.eval(lg)
        read_s = time.time() - t
        out, ts = [], []
        tok = sample(lg, rng)
        while tok not in eos and len(out) < 300:
            out.append(tok); s = time.perf_counter()
            h = model.model(mx.array([[tok]]), cache=cache); lg = model.lm_head(h[:, -1])[0]
            tok = sample(lg, rng); ts.append(time.perf_counter() - s)
        (OUT / f'agent-try{k}.txt').write_text(tk.decode(out, skip_special_tokens=False))
        wtps = 1 / float(np.median(ts[1:])) if len(ts) > 2 else None
        say(f'  Try {k}: read {n(len(ids))} tokens in {read_s:.0f} s ({len(ids) / read_s:.1f}/s) · wrote {len(out)} tokens'
            + (f' at {wtps:.1f}/s' if wtps else '') + f' · {"ended by itself" if tok in eos else "stopped at 300"}')
        rec(phase='agent', tri=k, read_tokens=len(ids), read_s=round(read_s, 1), read_tps=round(len(ids) / read_s, 1), wrote=len(out),
            write_tps=round(wtps, 2) if wtps else None, ended='eos' if tok in eos else 'cap', footprint_gb=round(peak['fp'] / 1e9, 2))
        if k == 1: bar('a', len(out) > 0, 'it loads and answers', len(out))
        del cache; mx.clear_cache()

    # ---- part 2: one long read, 64k tokens, written at 4k / 16k / 32k / 64k
    say('Part 2 of 2 · one long read up to 65,536 tokens (two books joined)')
    book = np.concatenate([np.load(PACK / 'eval/data/pg19_book06.npy'), np.load(PACK / 'eval/data/pg19_book07.npy')]).astype(np.int64)[:65536]
    cache = make_fest_cache(model, params, opts, 8192)
    done, t_read = 0, 0.0
    for point in (4096, 16384, 32768, 65536):
        t = time.time()
        for s in range(done, point, 512):
            h = model.model(mx.array(book[None, s:min(s + 512, point)]), cache=cache); mx.eval(h)
            if peak['now'] > GUARD:
                rec(phase='long', stopped='footprint over 14 GB', T=s, footprint_gb=round(peak['fp'] / 1e9, 2))
                bar('c', False, f'it holds 64k tokens at 12.5 GB or less: stopped at {n(s)} tokens, footprint over 14 GB (stopped to protect the Mac)', round(peak['fp'] / 1e9, 2))
                raise SystemExit
        t_read += time.time() - t; done = point
        mx.clear_cache()
        tok, ts = int(book[point - 1]), []
        for _ in range(16):
            s = time.perf_counter(); h = model.model(mx.array([[tok]]), cache=cache); tok = int(mx.argmax(model.lm_head(h[:, -1]), -1).item()); ts.append(time.perf_counter() - s)
        ms = float(np.median(ts[2:])) * 1e3
        m = mem_now()
        say(f'  at {n(point):>6}: reading {point / t_read:.1f}/s · writing {ms:.0f} ms a token ({1e3 / ms:.1f}/s) · footprint {gb(peak["fp"])} · free {m["free_gb"]:.1f} GB')
        rec(phase='long', T=point, read_s=round(t_read, 1), read_tps=round(point / t_read, 1), write_ms=round(ms, 1), write_tps=round(1e3 / ms, 2),
            mlx_peak_gb=round(mx.get_peak_memory() / 1e9, 2), footprint_gb=round(peak['fp'] / 1e9, 2), **m)
        if point == 16384:
            r = point / t_read
            bar('b', r >= BAR_READ, f'it reads 40+ tokens a second up to 16k: {r:.1f}/s', round(r, 1))
            if r < BAR_READ:
                say('  32k and 64k are skipped: (b) already failed'); rec(phase='long', stopped='reading under 40 a second at 16k'); break
        if point == 65536:
            bar('c', peak['fp'] <= BAR_PEAK, f'it holds 64k tokens at 12.5 GB or less: {gb(peak["fp"])} at the peak', round(peak['fp'] / 1e9, 2))
except KeyboardInterrupt:
    say('  stopped: what it has is kept'); rec(phase='stopped')
except SystemExit:
    pass
except Exception as e:
    say(f'  ERROR: {type(e).__name__}: {str(e)[:300]}'); rec(phase='error', error=f'{type(e).__name__}: {e}')
    if 'a' not in said: bar('a', False, f'it loads and answers: {type(e).__name__}: {str(e)[:160]}')
    elif 'b' in said and 'c' not in said: bar('c', False, f'it holds 64k tokens at 12.5 GB or less: {type(e).__name__} before 64k')
peak['stop'] = True
rec(phase='end', footprint_peak_gb=round(peak['fp'] / 1e9, 2), **mem_now())
