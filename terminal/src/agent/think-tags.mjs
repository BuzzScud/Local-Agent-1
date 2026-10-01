// A model that writes its thinking between tags of its own (thinkTags in its
// model.mjs: K2 Horizon's <ifm|think>, <ifm|think_fast>, <ifm|think_faster>).
// llama.cpp's server learns one pair from the chat template, so depending on
// the level the thinking arrives one of three ways:
//   split already: thinking in reasoning_content, the answer in content;
//   all in content: "…thinking</ifm|think_fast>the answer";
//   all as thinking: "…thinking</ifm|think_fast>the answer <ifm|tool_calls>…"
//     (the server waits for the closing tag it learned and never sees it).
// This puts each piece where it belongs: before a closing tag is thinking,
// after it is the answer (with any tool call written in it, which
// toolCallInText reads), and the tags themselves are left out. A tag cut in two
// by the stream is held back until the next piece shows what it is.
export async function* splitThink(events, tags, { thinking = false } = {}) {
  const marks = tags.flat();
  const closes = new Set(tags.map((t) => t[1]));
  const longest = Math.max(...marks.map((m) => m.length));
  let closed = false; // a closing tag went by: the rest is the answer
  let inside = false; // between an opening tag and its closing one: thinking, asked or not
  let ws = ''; // thinking that is only blank so far: dropped if nothing follows (an empty think block)
  let serverThought = false; // the server sent thinking of its own (so its content is the answer)
  let afterClose = false; // the newlines right after a closing tag are left out
  let from = null; // the stream the held text came from
  let held = '';
  const where = (src) => (inside ? 'reasoning' : src === 'reasoning' ? (closed ? 'text' : 'reasoning') : thinking && !closed && !serverThought ? 'reasoning' : 'text');
  function* out(s) {
    if (!s) return;
    const to = where(from);
    if (to === 'reasoning') {
      if (!/\S/.test(s)) { ws += s; return; }
      s = ws + s;
      ws = '';
    }
    if (to === 'text' && afterClose) {
      s = s.replace(/^\n+/, '');
      if (!s) return;
      afterClose = false;
    }
    yield { type: to, text: s };
  }
  // Give out what is sure: up to each mark, and all but a tail that could still
  // grow into one (all of it at the end).
  function* drain(final) {
    for (;;) {
      let at = -1;
      let mark = null;
      for (const m of marks) {
        const i = held.indexOf(m);
        if (i >= 0 && (at < 0 || i < at)) { at = i; mark = m; }
      }
      if (at < 0) break;
      yield* out(held.slice(0, at));
      held = held.slice(at + mark.length);
      if (closes.has(mark)) { closed = true; afterClose = true; inside = false; ws = ''; } else inside = true;
    }
    let keep = 0;
    if (!final) {
      for (let k = Math.min(longest - 1, held.length); k > 0; k--) {
        if (marks.some((m) => m.startsWith(held.slice(-k)))) { keep = k; break; }
      }
    }
    yield* out(held.slice(0, held.length - keep));
    held = held.slice(held.length - keep);
  }
  for await (const ev of events) {
    if (ev.type === 'reasoning' || ev.type === 'text') {
      if (from && from !== ev.type) yield* drain(true);
      if (ev.type === 'reasoning') serverThought = true;
      from = ev.type;
      held += ev.text;
      yield* drain(false);
      continue;
    }
    // A tool call or the end: what is held goes first.
    yield* drain(true);
    yield ev;
  }
  yield* drain(true);
}
