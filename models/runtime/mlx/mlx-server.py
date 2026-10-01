#!/usr/bin/env python3
"""The model server for a model on Apple's MLX (engine 'mlx' in models/registry.mjs): Bonsai 2 27B ConstantKV,
whose closed runtime (crystal_runtime, a research license) keeps the attention memory of its 16 full-attention
layers at a fixed size. It answers the parts of llama-server's API that Agentic Coder uses, so the app talks to it
the way it talks to llama.cpp:

  GET  /health                 200 once the model is loaded (503 while it loads)
  GET  /props, /v1/models      its context, two slots, no vision
  POST /v1/chat/completions    the chat template (tools, enable_thinking, reasoning_effort), streamed: thinking as
                               reasoning_content, the answer as content, tool calls as real tool_calls; the
                               thinking ends at the budget with the budget message; sampling as asked
  POST /tokenize, /apply-template, /completion   for reading the instructions ahead (warmup.mjs) and for a pick
                               among a few words (flows/llm.mjs decide: n_probs)
  POST /slots/N?action=save    accepted; nothing is written to disk (the state lives here while the server runs)

Only the runtime's own calls are used, the ones its Apache-licensed scripts make: load_text_model,
load_crystal_params, install, make_fest_cache, prefill, model.model, model.lm_head, and the caches' get_state /
set_state and state. Nothing looks inside the runtime.

What it keeps between requests: one model state (the attention memory is the same size at any length) and one
checkpoint, taken where the conversation's last prompt ends (slot 0, or no slot). A request that starts with the
tokens the state holds reads only what is new; one that starts with the checkpoint's goes back to it (0.04 s) and
reads on from there; anything else starts over. Slot 1 (the app's side requests: sorting, helpers) never moves the
checkpoint, so they never cost the conversation its reading. Measured 1 Oct 2026 on the M4: a checkpoint restored
three times gave the same next-word scores to the last bit.

    python mlx-server.py --pack <model folder> --port 17600 [--host 127.0.0.1] [-c 65536]
        [--reasoning-budget 2048] [--reasoning-budget-message " I have thought enough. Now I act on it."]
        [--api-key-file <file> [--ssl-cert-file <cert> --ssl-key-file <key>]]   (coding serve)"""
import argparse, json, os, queue, random, re, sys, threading, time, traceback, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--pack', required=True)
ap.add_argument('--host', default='127.0.0.1')
ap.add_argument('--port', type=int, default=17600)
ap.add_argument('-c', '--ctx', type=int, default=65536)
ap.add_argument('--store', type=int, default=8192, help='exact tokens per key-value head (the runtime default)')
ap.add_argument('--chunk', type=int, default=512, help='tokens read in one pass')
ap.add_argument('--reasoning-budget', type=int, default=2048)
ap.add_argument('--reasoning-budget-message', default=' I have thought enough. Now I act on it.')
ap.add_argument('--api-key', default=None)
ap.add_argument('--api-key-file', default=None, help='the key on its first line (coding serve)')
ap.add_argument('--ssl-cert-file', default=None)
ap.add_argument('--ssl-key-file', default=None)
ap.add_argument('--alias', default='coding')
A = ap.parse_args()
PACK = Path(A.pack)
if A.api_key_file and not A.api_key:
    A.api_key = Path(A.api_key_file).read_text().split('\n')[0].strip() or None


def log(msg):
    print(f'{time.strftime("%H:%M:%S")} {msg}', flush=True)


# ---------------------------------------------------------------- the tokenizer and the chat template (no model)
from tokenizers import Tokenizer
from jinja2.sandbox import ImmutableSandboxedEnvironment

TK = Tokenizer.from_file(str(PACK / 'tokenizer.json'))
TC = json.loads((PACK / 'tokenizer_config.json').read_text())
TEMPLATE_TEXT = (PACK / 'chat_template.jinja').read_text() if (PACK / 'chat_template.jinja').is_file() else TC.get('chat_template')
EOS = {TK.token_to_id(t) for t in ('<|im_end|>', '<|endoftext|>') if TK.token_to_id(t) is not None}
_env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True, extensions=['jinja2.ext.loopcontrols'])
_env.filters['tojson'] = lambda x, indent=None, ensure_ascii=False: json.dumps(x, indent=indent, ensure_ascii=ensure_ascii)
def _raise(m): raise ValueError(m)
_env.globals['raise_exception'] = _raise
TEMPLATE = _env.from_string(TEMPLATE_TEXT)


def tokenize(text):
    return TK.encode(text, add_special_tokens=False).ids


def detok(ids):
    return TK.decode(ids, skip_special_tokens=False)


def text_of(content):
    """A message's content as the template takes it: text, or its text parts (no pictures: text only)."""
    if content is None: return ''
    if isinstance(content, str): return content
    if isinstance(content, list):
        if any(isinstance(p, dict) and p.get('type') in ('image_url', 'image', 'input_image') for p in content):
            raise ValueError('this model cannot look at pictures (text only)')
        return ''.join(p.get('text', '') for p in content if isinstance(p, dict))
    return str(content)


def template_messages(messages):
    """OpenAI messages → what the chat template reads: tool call arguments as objects, contents as text."""
    out = []
    for m in messages:
        x = {k: v for k, v in m.items() if k not in ('content', 'tool_calls')}
        x['content'] = text_of(m.get('content'))
        if m.get('tool_calls'):
            calls = []
            for c in m['tool_calls']:
                f = dict(c.get('function') or {})
                a = f.get('arguments')
                if isinstance(a, str):
                    try: a = json.loads(a) if a.strip() else {}
                    except Exception: a = {'arguments': a}
                f['arguments'] = a if isinstance(a, dict) else {}
                calls.append({**c, 'function': f})
            x['tool_calls'] = calls
        out.append(x)
    return out


def render(messages, tools=None, kwargs=None, add_generation_prompt=True):
    kw = dict(kwargs or {})
    return TEMPLATE.render(messages=template_messages(messages), tools=tools or None, add_generation_prompt=add_generation_prompt,
                           bos_token=TC.get('bos_token') or '', eos_token=TC.get('eos_token') or '', **kw)


# ---------------------------------------------------------------- tool calls written in the template's XML
CALL_OPEN, CALL_CLOSE = '<tool_call>', '</tool_call>'


def param_types(tools):
    out = {}
    for t in tools or []:
        f = t.get('function') or {}
        props = ((f.get('parameters') or {}).get('properties') or {})
        out[f.get('name')] = {k: (v or {}).get('type') for k, v in props.items()}
    return out


def typed(value, kind):
    """A parameter's text as its schema says: a string as it is, anything else as JSON when it reads as JSON."""
    if kind in (None, 'string'):
        if kind is None and re.fullmatch(r'\s*(-?\d+(\.\d+)?|true|false|null|\{[\s\S]*\}|\[[\s\S]*\])\s*', value):
            try: return json.loads(value)
            except Exception: return value
        return value
    try: return json.loads(value)
    except Exception: return value


class CallStream:
    """Reads the text after the answer's first <tool_call> as it grows and hands back tool_call deltas the way
    llama-server streams them: the name first, then the arguments as a JSON text that only ever grows."""
    PARAM = re.compile(r'<parameter=([^>\s]+)>\n?')

    def __init__(self, types):
        self.types = types
        self.calls = []  # {id, name, done, params: [(k, v)], open: (k, text) | None, sent: str}

    def feed(self, text, final=False):
        """text: everything from the first <tool_call> on. Returns the deltas to send now."""
        deltas = []
        blocks = text.split(CALL_OPEN)[1:]
        for i, block in enumerate(blocks):
            closed = CALL_CLOSE in block
            body = block.split(CALL_CLOSE)[0]
            m = re.match(r'\s*<function=([^>\s]+)>', body)
            if not m: continue
            if i >= len(self.calls):
                self.calls.append({'id': f'call_{uuid.uuid4().hex[:24]}', 'name': m.group(1), 'sent': ''})
                deltas.append({'index': i, 'id': self.calls[i]['id'], 'type': 'function', 'function': {'name': m.group(1), 'arguments': ''}})
            c = self.calls[i]
            kinds = self.types.get(c['name'], {})
            rest = body[m.end():]
            # its parameters: each <parameter=k> … </parameter>
            done_params, open_param = [], None
            for pm in self.PARAM.finditer(rest):
                start = pm.end()
                end = rest.find('</parameter>', start)
                if end < 0:
                    open_param = (pm.group(1), rest[start:])
                    break
                v = rest[start:end]
                if v.endswith('\n'): v = v[:-1]
                done_params.append((pm.group(1), v))
            items = [f'{json.dumps(k)}: {json.dumps(typed(v, kinds.get(k)), ensure_ascii=False)}' for k, v in done_params]
            whole = closed or final
            if whole and open_param is not None:  # cut off mid-parameter (the reply ran out of room): what it has
                items.append(f'{json.dumps(open_param[0])}: {json.dumps(open_param[1], ensure_ascii=False)}')
                open_param = None
            js = '{' + ', '.join(items)
            if whole:
                js += '}'
            elif open_param is not None and kinds.get(open_param[0]) == 'string':
                v = open_param[1]
                # hold back what may still turn out to be the end of the parameter (a newline, a half closing tag)
                for cut in range(min(len(v), 13), 0, -1):
                    if '\n</parameter>'.startswith(v[-cut:]) or '</parameter>'.startswith(v[-cut:]):
                        v = v[:-cut]; break
                js += (', ' if items else '') + f'{json.dumps(open_param[0])}: ' + json.dumps(v, ensure_ascii=False)[:-1]
            if js.startswith(c['sent']) and len(js) > len(c['sent']):
                deltas.append({'index': i, 'function': {'arguments': js[len(c['sent']):]}})
                c['sent'] = js
            c['done'] = whole
        return deltas

    def final_calls(self):
        return [{'id': c['id'], 'type': 'function', 'function': {'name': c['name'], 'arguments': c['sent'] if c['sent'].endswith('}') else (c['sent'] or '{') + '}'}} for c in self.calls]


# ---------------------------------------------------------------- the model, on one thread of its own
JOBS = queue.Queue()
STATE = {'loaded': False}


BLOCK = 2048  # tokens read between two looks at whether the request was closed


def held(text, *tags):
    """How much of the end of `text` may still be the start of one of `tags` (kept back until it is known)."""
    for k in range(min(len(text), max(len(t) for t in tags)), 0, -1):
        if any(t.startswith(text[-k:]) for t in tags): return k
    return 0


def worker():
    try:
        import mlx.core as mx
        from crystal_runtime.mlx_bonsai import load_text_model, load_crystal_params
        from crystal_runtime.mlx_crystal import install
        from crystal_runtime.kristall_fest import make_fest_cache
        from crystal_runtime.monorail_routes import prefill
        from crystal_runtime import gated_delta_cuda
        mx.set_cache_limit(256 * 2**20)  # as the runtime's own scripts: keeps a 16 GB Mac out of swap
        t = time.time()
        model, cfg = load_text_model(str(PACK))
        params, opts = load_crystal_params(str(PACK), 'crystal'); install()
        gated_delta_cuda.aktivieren()  # CUDA only; nothing on Metal
        log(f'model loaded in {time.time() - t:.1f} s from {PACK.name}; context {A.ctx}, store {A.store}')
    except Exception as e:
        log(f'the model did not load: {type(e).__name__}: {e}'); traceback.print_exc()
        os._exit(1)  # the app sees the server end while loading and says so
    STATE['loaded'] = True

    def copy_box(x):
        if isinstance(x, dict): return {k: copy_box(v) for k, v in x.items()}
        if isinstance(x, list): return [copy_box(v) for v in x]
        if isinstance(x, tuple): return tuple(copy_box(v) for v in x)
        return x

    def snapshot(cache):
        # The runtime keeps writing into the boxes get_state hands out: the boxes are copied, the arrays shared.
        return [('f', copy_box(c.get_state())) if hasattr(c, 'get_state') else ('a', list(c.state)) for c in cache]

    def restore(cache, snap):
        for c, (k, v) in zip(cache, snap):
            if k == 'f': c.set_state(*copy_box(v))
            else: c.state = list(v)

    def last_logits(h):
        lg = model.lm_head(h[:, -1:]).astype(mx.float32)[0, -1]
        mx.eval(lg)
        return lg

    # The conversation (slot 0, or no slot): one state and its checkpoint where the last prompt ended.
    S = {'cache': make_fest_cache(model, params, opts, A.store), 'tokens': [], 'logits': None, 'check': None}

    class Run:
        """The state one request reads and writes: the conversation's, or a side request's own."""
        def __init__(self, cache, main):
            self.cache, self.main = cache, main

        def read(self, ids, job):
            # The runtime's own reading routine (as its quickstart reads), a block at a time so a closed request
            # stops between blocks: 39 tokens a second on the M4 against ~15 for one model call per 512 tokens.
            h = None
            if self.main: S['logits'] = None
            for s in range(0, len(ids), BLOCK):
                if job.get('cancel'): raise InterruptedError
                h = prefill(model, np.asarray(ids[s:s + BLOCK], np.int64), self.cache, A.chunk)
                mx.eval(h)
                if self.main: S['tokens'].extend(ids[s:s + BLOCK])
            lg = last_logits(h)
            if self.main: S['logits'] = lg
            return lg

        def feed(self, tok):
            h = model.model(mx.array([[tok]]), cache=self.cache)
            lg = model.lm_head(h[:, -1]).astype(mx.float32)[0]
            mx.eval(lg)
            if self.main: S['tokens'].append(tok); S['logits'] = lg
            return lg

    def start(ids, slot, job):
        """A state at `ids`: (run, logits after the last token, tokens read now, tokens reused)."""
        if slot == 1:
            # A side request (sorting, a helper): its own state, never the conversation's. Up to 16k tokens the
            # model's own cache (exact, and small for a short request), past that a constant one.
            run = Run(model.make_cache() if len(ids) <= 16384 else make_fest_cache(model, params, opts, A.store), False)
            return run, run.read(ids, job), len(ids), 0
        cur, check = S['tokens'], S['check']
        if S['logits'] is not None and len(cur) <= len(ids) and ids[:len(cur)] == cur:
            at = len(cur)
        elif check and len(check[0]) <= len(ids) and ids[:len(check[0])] == check[0]:
            restore(S['cache'], check[1]); S['tokens'] = list(check[0]); S['logits'] = check[2]; at = len(check[0])
        else:
            S['check'] = None; S['cache'] = None; mx.clear_cache()
            S['cache'] = make_fest_cache(model, params, opts, A.store); S['tokens'] = []; S['logits'] = None; at = 0
        run = Run(S['cache'], True)
        lg = run.read(ids[at:], job) if len(ids) > at else S['logits']
        S['check'] = (list(ids), snapshot(S['cache']), lg)
        return run, lg, len(ids) - at, at

    def pick(lg, o):
        t = float(o['temperature']) if o.get('temperature') is not None else 0.8
        x = np.array(lg).reshape(-1)
        if t <= 0: return int(x.argmax())
        k = int(o.get('top_k') or 0)
        idx = np.argpartition(-x, k)[:k] if 0 < k < x.size else np.arange(x.size)
        idx = idx[np.argsort(-x[idx])]
        p = np.exp((x[idx] - x[idx[0]]) / t); p /= p.sum()
        top_p = float(o['top_p']) if o.get('top_p') is not None else 1.0
        if top_p < 1:
            keep = min(int(np.searchsorted(np.cumsum(p), top_p)) + 1, len(p)); idx, p = idx[:keep], p[:keep]
        min_p = float(o.get('min_p') or 0)
        if min_p > 0:
            keep = p >= min_p * p[0]; idx, p = idx[keep], p[keep]
        return int(np.random.choice(idx, p=p / p.sum()))

    while True:
        job = JOBS.get()
        out = job['out']
        try:
            o = job['body']
            if job['kind'] == 'completion':
                prompt = o.get('prompt', '')
                ids = [int(x) for x in prompt] if isinstance(prompt, list) else tokenize(prompt)
                t0 = time.time()
                run, lg, n_read, reused = start(ids, o.get('id_slot'), job)
                res = {'content': '', 'tokens_evaluated': len(ids), 'timings': {'prompt_n': n_read, 'cache_n': reused, 'prompt_ms': (time.time() - t0) * 1e3}}
                if int(o.get('n_probs') or 0) > 0:
                    x = np.array(lg).reshape(-1).astype(np.float64)
                    lp = x - (x.max() + np.log(np.exp(x - x.max()).sum()))
                    top = np.argsort(-lp)[:int(o['n_probs'])]
                    res['completion_probabilities'] = [{'id': int(top[0]), 'token': detok([int(top[0])]), 'logprob': float(lp[top[0]]),
                                                        'top_logprobs': [{'id': int(i), 'token': detok([int(i)]), 'logprob': float(lp[i])} for i in top]}]
                log(f'completion: {len(ids)} tokens, read {n_read} (reused {reused}) in {time.time() - t0:.1f} s')
                out.put(('done', res))
                continue

            # ---- a chat completion
            ids, kinds, think, tools_on = job['ids'], job['types'], job['think'], job['tools_on']
            t0 = time.time()
            run, lg, n_read, reused = start(ids, o.get('id_slot'), job)
            t_read = time.time() - t0
            room = max(0, A.ctx - len(ids))
            max_new = min(int(o.get('max_tokens') or o.get('max_completion_tokens') or room), room)
            cap = min(A.reasoning_budget, int(o.get('thinking_budget_tokens') or A.reasoning_budget)) if think else 0
            stops = [x for x in o['stop'] if x] if isinstance(o.get('stop'), list) else ([o['stop']] if o.get('stop') else [])
            calls = CallStream(kinds) if tools_on else None
            gen, n_think, answer_from = [], 0, 0
            T = {'phase': 'think' if think else 'answer', 'think': '', 'answer': '', 'said_think': '', 'said_answer': ''}

            def emit():
                """Sends what the new tokens added. True: a stop word ended the answer."""
                if T['phase'] == 'think':
                    full = detok(gen)
                    if full.endswith('�'): return False
                    if '</think>' in full:
                        T['think'] = full.split('</think>')[0].rstrip('\n')
                        if len(T['think']) > len(T['said_think']): out.put(('reasoning', T['think'][len(T['said_think']):]))
                        T['said_think'] = T['think']; T['phase'] = 'answer'; T['answer_from'] = len(gen)
                        return False
                    T['think'] = full
                    safe = full[:len(full) - held(full, '\n</think>')]
                    if len(safe) > len(T['said_think']): out.put(('reasoning', safe[len(T['said_think']):])); T['said_think'] = safe
                    return False
                full = detok(gen[T.get('answer_from', 0):])
                if full.endswith('�'): return False
                full = full.lstrip('\n')
                for x in stops:
                    if x in full:
                        T['answer'] = full = full.split(x)[0]
                        if len(full) > len(T['said_answer']) and full.startswith(T['said_answer']): out.put(('content', full[len(T['said_answer']):]))
                        T['said_answer'] = full
                        return True
                T['answer'] = full
                at = full.find(CALL_OPEN) if calls else -1
                if at < 0:
                    before = full[:len(full) - max([held(full, CALL_OPEN) if calls else 0] + [held(full, x) for x in stops])]
                else:
                    before = full[:at].rstrip()
                if len(before) > len(T['said_answer']) and before.startswith(T['said_answer']):
                    out.put(('content', before[len(T['said_answer']):])); T['said_answer'] = before
                if at >= 0:
                    for d in calls.feed(full[at:]): out.put(('tool', d))
                return False

            finish, t1 = 'stop', time.time()
            tok = pick(lg, o)
            while True:
                if job.get('cancel'): finish = 'cancelled'; break
                if tok in EOS: break
                if len(gen) >= max_new: finish = 'length'; break
                gen.append(tok); lg = run.feed(tok)
                if T['phase'] == 'think': n_think += 1
                if emit(): break
                if T['phase'] == 'think' and cap and n_think >= cap:
                    # the thinking budget: the message, the end of the thinking, then the answer
                    for f in tokenize(A.reasoning_budget_message + '\n</think>\n\n'):
                        gen.append(f); lg = run.feed(f)
                    emit()
                    log(f'thinking stopped at the budget ({cap} tokens)')
                tok = pick(lg, o)
            if T['phase'] == 'think': T['think'] = detok(gen)
            if calls is not None and CALL_OPEN in T['answer']:
                for d in calls.feed(T['answer'][T['answer'].find(CALL_OPEN):], final=True): out.put(('tool', d))
            t_gen = time.time() - t1
            if calls is not None and calls.calls and finish == 'stop': finish = 'tool_calls'
            timings = {'prompt_n': n_read, 'cache_n': reused, 'prompt_ms': t_read * 1e3, 'prompt_per_second': n_read / t_read if n_read and t_read > 0 else None,
                       'predicted_n': len(gen), 'predicted_ms': t_gen * 1e3, 'predicted_per_second': len(gen) / t_gen if gen and t_gen > 0 else None}
            usage = {'prompt_tokens': len(ids), 'completion_tokens': len(gen), 'total_tokens': len(ids) + len(gen)}
            log(f'chat{" (side)" if o.get("id_slot") == 1 else ""}: prompt {len(ids)} tokens, read {n_read} (reused {reused}) in {t_read:.1f} s'
                + (f' ({n_read / t_read:.1f}/s)' if n_read and t_read > 0 else '')
                + f'; wrote {len(gen)} in {t_gen:.1f} s' + (f' ({len(gen) / t_gen:.1f}/s)' if gen and t_gen > 0 else '')
                + f'; {finish}' + (f'; {len(calls.calls)} tool call(s)' if calls and calls.calls else ''))
            msg = {'role': 'assistant', 'content': (T['answer'].split(CALL_OPEN)[0].rstrip() if calls and calls.calls else T['answer']) or ''}
            if think and T['think'].strip(): msg['reasoning_content'] = T['think'].rstrip('\n')
            if calls is not None and calls.calls: msg['tool_calls'] = calls.final_calls()
            out.put(('done', {'finish': 'stop' if finish == 'cancelled' else finish, 'usage': usage, 'timings': timings, 'message': msg}))
        except InterruptedError:
            log('stopped: the request was closed while reading')
            out.put(('done', {'finish': 'stop', 'usage': None, 'timings': None, 'message': {'role': 'assistant', 'content': ''}}))
        except Exception as e:
            log(f'error: {type(e).__name__}: {e}'); traceback.print_exc()
            out.put(('error', f'{type(e).__name__}: {e}'))


threading.Thread(target=worker, daemon=True).start()


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def err(self, code, message, kind='invalid_request_error'):
        self.send_json(code, {'error': {'code': code, 'message': message, 'type': kind}})

    def authorized(self):
        if not A.api_key or self.path in ('/health', '/v1/health'): return True
        if self.headers.get('authorization', '') == f'Bearer {A.api_key}': return True
        self.err(401, 'Invalid API Key', 'authentication_error')
        return False

    def body(self):
        n = int(self.headers.get('content-length') or 0)
        try: return json.loads(self.rfile.read(n) or b'{}')
        except Exception: return {}

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/health', '/v1/health'):
            return self.send_json(200, {'status': 'ok'}) if STATE['loaded'] else self.err(503, 'Loading model', 'unavailable_error')
        if not self.authorized(): return
        if path == '/props':
            return self.send_json(200, {'default_generation_settings': {'n_ctx': A.ctx}, 'total_slots': 2, 'model_path': str(PACK), 'modalities': {'vision': False, 'audio': False},
                                        'chat_template': TEMPLATE_TEXT, 'build_info': 'mlx-server (crystal_runtime)'})
        if path in ('/v1/models', '/models'):
            return self.send_json(200, {'object': 'list', 'data': [{'id': A.alias, 'object': 'model', 'owned_by': 'agentic-coder', 'meta': {'n_ctx_train': A.ctx}}]})
        if path == '/slots':
            return self.send_json(200, [{'id': 0}, {'id': 1}])
        self.err(404, 'File Not Found', 'not_found_error')

    def do_POST(self):
        u = urlparse(self.path)
        path = u.path
        if not self.authorized(): return
        b = self.body()
        try:
            if path == '/tokenize':
                return self.send_json(200, {'tokens': tokenize(str(b.get('content', '')))})
            if path == '/detokenize':
                return self.send_json(200, {'content': detok([int(x) for x in b.get('tokens', [])])})
            if path == '/apply-template':
                return self.send_json(200, {'prompt': render(b.get('messages') or [], b.get('tools'), b.get('chat_template_kwargs'))})
            if path.startswith('/slots/'):
                action = (parse_qs(u.query).get('action') or [''])[0]
                if action == 'save': return self.send_json(200, {'id_slot': int(path.split('/')[2] or 0), 'filename': b.get('filename'), 'n_saved': 0, 'kept': 'in the server, not on disk'})
                return self.err(400, 'this server keeps its state in memory only: nothing to restore from a file')
            if not STATE['loaded']:
                return self.err(503, 'Loading model', 'unavailable_error')
            if path == '/completion':
                return self.run({'kind': 'completion', 'body': b}, stream=False)
            if path in ('/v1/chat/completions', '/chat/completions'):
                kw = dict(b.get('chat_template_kwargs') or {})
                if b.get('reasoning_effort') and 'reasoning_effort' not in kw: kw['reasoning_effort'] = b['reasoning_effort']
                tools = b.get('tools') or None
                text = render(b.get('messages') or [], tools, kw)
                ids = tokenize(text)
                if len(ids) >= A.ctx:
                    return self.err(400, f'the request exceeds the available context size ({len(ids)} tokens, context {A.ctx}), try increasing it', 'exceed_context_size_error')
                think = text.rstrip('\n').endswith('<think>')
                tools_on = bool(tools) and b.get('tool_choice') != 'none'
                return self.run({'kind': 'chat', 'body': b, 'ids': ids, 'think': think, 'tools_on': tools_on, 'types': param_types(tools)}, stream=bool(b.get('stream')))
        except ValueError as e:
            return self.err(400, str(e))
        self.err(404, 'File Not Found', 'not_found_error')

    def run(self, job, stream):
        job['out'] = queue.Queue()
        JOBS.put(job)
        if job['kind'] == 'completion':
            kind, val = job['out'].get()
            return self.send_json(200, val) if kind == 'done' else self.err(500, val, 'server_error')
        cid, created = f'chatcmpl-{uuid.uuid4().hex[:24]}', int(time.time())
        chunk = lambda delta, finish=None, **x: {'id': cid, 'object': 'chat.completion.chunk', 'created': created, 'model': A.alias,
                                                  'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}], **x}
        if not stream:
            while True:
                kind, val = job['out'].get()
                if kind == 'done':
                    return self.send_json(200, {'id': cid, 'object': 'chat.completion', 'created': created, 'model': A.alias,
                                                'choices': [{'index': 0, 'message': val['message'], 'finish_reason': val['finish']}], 'usage': val['usage'], 'timings': val['timings']})
                if kind == 'error': return self.err(500, val, 'server_error')
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.send_header('cache-control', 'no-cache')
        self.send_header('connection', 'close')
        self.end_headers()
        self.close_connection = True

        def send(obj):
            self.wfile.write(f'data: {json.dumps(obj, ensure_ascii=False)}\n\n'.encode()); self.wfile.flush()
        try:
            send(chunk({'role': 'assistant', 'content': None}))
            while True:
                kind, val = job['out'].get()
                if kind == 'reasoning': send(chunk({'reasoning_content': val}))
                elif kind == 'content': send(chunk({'content': val}))
                elif kind == 'tool': send(chunk({'tool_calls': [val]}))
                elif kind == 'error': send({'error': {'code': 500, 'message': val, 'type': 'server_error'}}); break
                elif kind == 'done':
                    send(chunk({}, val['finish'], timings=val['timings']))
                    if (job['body'].get('stream_options') or {}).get('include_usage') and val['usage']:
                        send({'id': cid, 'object': 'chat.completion.chunk', 'created': created, 'model': A.alias, 'choices': [], 'usage': val['usage'], 'timings': val['timings']})
                    self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
                    break
        except (BrokenPipeError, ConnectionResetError):
            job['cancel'] = True
            while True:  # let the model thread finish this job before the next one starts
                kind, _ = job['out'].get()
                if kind in ('done', 'error'): break


log(f'mlx-server listening on {A.host}:{A.port} (loading {PACK.name})')
srv = ThreadingHTTPServer((A.host, A.port), Handler)
srv.daemon_threads = True
if A.ssl_cert_file and A.ssl_key_file:  # coding serve over https
    import ssl
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(A.ssl_cert_file, A.ssl_key_file)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
