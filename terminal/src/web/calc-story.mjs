// The calculator link's log told as a story, and its last 24 hours as stretches (9 Oct 2026, the owner's picks for the
// hub's Calculator tab: "one row per outage", the "Chain" design with its lanes). Both read the link's events
// (calc-link.mjs event(): { at, kind, text }) and nothing else, so the tab, /calc and the tests tell the same story.
//   storyOf  one row per thing that happened: an outage and its tries as one row ("Dropped, back 14 s later"), a burst of
//            reports as one, a new login with its sign-in; each row { at, kind, text, sub, lane } (lane: the timeline's
//            sign, prob or rep), newest first
//   dayOf    the last 24 hours as stretches: up (live), down (trying again), off (not running), none (no record)

const dur = (ms) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min`);
const many = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
// What took the connection away, from the event's own words.
function causeOf(text) {
  const close = /close (\d+)( "([^"]*)")?/.exec(text);
  if (close) return `${close[1] === '1008' ? 'the session ran out' : close[1] === '4000' ? 'no answer to the heartbeat' : 'the network'} · close ${close[1]}${close[3] ? ` “${close[3]}”` : ''}`;
  if (/could not reach/i.test(text)) return 'could not reach the calculator';
  if (/answered (\d+)/.test(text)) return `sign-in answered ${/answered (\d+)/.exec(text)[1]}`;
  if (/went quiet/.test(text)) return 'no answer to the heartbeat';
  if (/could not open/.test(text)) return 'the connection could not open';
  return '';
}
const DOWN = new Set(['drop', 'retry']);
const renewal = (e) => /^The session ran out|said the session had run out/.test(e.text);
const WHY = { stopped: 'Stopped', 'handed over': 'Handed over to its background service', moved: 'Moved to the other place', 'the login changed': 'New login saved' };

export function storyOf(events, { now = Date.now(), bootAt = null } = {}) {
  const evs = [...events].sort((a, b) => a.at - b.at);
  if (bootAt && evs.length && bootAt > evs[0].at && bootAt <= now) { evs.push({ at: bootAt, kind: 'restart', text: '' }); evs.sort((a, b) => a.at - b.at); }
  const rows = [];
  const next = (i, ...kinds) => (kinds.includes(evs[i]?.kind) ? i : -1);
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    // the session ran out (or a route said so): a new sign-in, not an outage
    if (e.kind === 'drop' && renewal(e)) {
      const lasted = /after ([^(]+?) \(/.exec(e.text)?.[1];
      let j = i;
      if (next(j + 1, 'signin') > 0) { j++; if (next(j + 1, 'live') > 0) j++; }
      rows.push({ at: e.at, kind: 'live', lane: 'sign', text: 'The session ran out: signed in again', sub: lasted ? `it lasted ${lasted}` : '' });
      i = j; continue;
    }
    // an outage: its drops and failed tries, until it was live again
    if (DOWN.has(e.kind)) {
      let j = i;
      while (j + 1 < evs.length && (DOWN.has(evs[j + 1].kind) || evs[j + 1].kind === 'asked' || evs[j + 1].kind === 'woke') && !renewal(evs[j + 1])) j++;
      const tries = evs.slice(i, j + 1).filter((x) => DOWN.has(x.kind)).length;
      let k = j + 1;
      if (evs[k]?.kind === 'signin' && evs[k + 1]?.kind === 'live') k++;
      const cause = causeOf(e.text), sub = [cause, many(tries, 'try', 'tries')].filter(Boolean).join(' · ');
      if (evs[k]?.kind === 'live') { rows.push({ at: e.at, kind: 'outage', lane: 'prob', text: `Dropped, back ${dur(evs[k].at - e.at)} later`, sub }); i = k; continue; }
      if (k >= evs.length) { rows.push({ at: e.at, kind: 'down', lane: 'prob', text: 'Dropped: trying again', sub: `${cause ? `${cause} · ` : ''}${many(tries, 'try', 'tries')} so far` }); i = j; continue; }
      rows.push({ at: e.at, kind: 'outage', lane: 'prob', text: 'Dropped, and not back before it stopped', sub }); i = j; continue;
    }
    if (e.kind === 'report') {
      if (/^Problem seen: /.test(e.text)) { rows.push({ at: e.at, kind: 'problem', lane: 'prob', text: e.text.replace(/\. It is filed once.*$/, ''), sub: 'filed once, with the next session' }); continue; }
      let j = i;
      while (evs[j + 1]?.kind === 'report' && /^Filed /.test(evs[j + 1].text)) j++;
      const run = evs.slice(i, j + 1);
      const feats = run.filter((x) => /feature request/.test(x.text)).length, issues = run.length - feats;
      const what = [feats ? many(feats, 'feature request') : '', issues ? many(issues, 'issue') : ''].filter(Boolean).join(' and ');
      rows.push({ at: e.at, kind: 'report', lane: 'rep', n: run.length, text: `Filed ${what} with the calculator`, sub: run.length === 1 ? run[0].text.replace(/^Filed [^:]+: /, '') : '' });
      i = j; continue;
    }
    // a start, or a new login, with the sign-in and the live that follow it
    const loginChange = e.kind === 'stopped' && /the login changed/.test(e.text);
    if (loginChange || e.kind === 'start') {
      let j = i;
      if (loginChange && evs[j + 1]?.kind === 'start') j++;
      const where = /background service/.test(evs[j].kind === 'start' ? evs[j].text : '') ? 'as its background service' : 'inside the web';
      const signed = evs[j + 1]?.kind === 'signin', live = signed && evs[j + 2]?.kind === 'live';
      if (signed) j += live ? 2 : 1;
      const head = loginChange ? 'New login saved' : `Started ${where}`;
      rows.push({ at: e.at, kind: live ? 'live' : signed ? 'live' : 'stop', lane: signed ? 'sign' : undefined, text: [head, signed ? 'signed in' : '', live ? 'live' : ''].filter(Boolean).join(' · '), sub: '' });
      i = j; continue;
    }
    if (e.kind === 'stopped') {
      let j = i;
      while (evs[j + 1]?.kind === 'stopped' && !/the login changed/.test(evs[j + 1].text) && evs[j + 1].at - evs[j].at < 60_000) j++;
      const why = /\(([^)]*)\)/.exec(e.text)?.[1] ?? 'stopped';
      rows.push(j > i ? { at: e.at, kind: 'stop', text: 'Switched where it runs, back and forth', sub: `${j - i + 1} steps in ${dur(evs[j].at - e.at)}` } : { at: e.at, kind: 'stop', text: WHY[why] ?? `Stopped (${why})`, sub: '' });
      i = j; continue;
    }
    if (e.kind === 'signin') {
      const live = evs[i + 1]?.kind === 'live';
      rows.push({ at: e.at, kind: 'live', lane: 'sign', text: `${e.text}${live ? ' · live' : ''}`, sub: '' });
      if (live) i++;
      continue;
    }
    if (e.kind === 'live') { rows.push({ at: e.at, kind: 'live', text: 'Live again', sub: '' }); continue; }
    if (e.kind === 'wrong-login') { rows.push({ at: e.at, kind: 'down', lane: 'prob', text: 'Sign-in refused: the password is wrong', sub: 'it waits for a new login (tried once, so the account is never locked)' }); continue; }
    if (e.kind === 'restart') {
      const after = evs.slice(i + 1).find((x) => x.kind !== 'restart');
      const soon = after && after.at - e.at < 5 * 60_000 && (after.kind === 'start' || after.kind === 'signin');
      rows.push({ at: e.at, kind: 'restart', lane: 'prob', text: 'This Mac restarted', sub: soon ? 'the link started with it' : after ? `the link was not running until it was started again, ${dur(after.at - e.at)} later` : 'the link did not start again' });
      continue;
    }
    rows.push({ at: e.at, kind: e.kind === 'woke' || e.kind === 'asked' ? 'stop' : e.kind, text: e.text, sub: '' });
  }
  return rows.reverse();
}

// running: the link answers now (its state: live, waiting…); not running: it was last heard at aliveAt (saved each
// minute while it runs) or its last event, and bootAt (this Mac's start) ends what is not known.
export function dayOf(events, { now = Date.now(), bootAt = null, aliveAt = null, running = false, hours = 24 } = {}) {
  const from = now - hours * 3_600_000, segs = [];
  let cur = 'none', t0 = from;
  const go = (s, t) => {
    if (t <= from) { cur = s; return; }
    if (s === cur) return;
    if (t > t0) segs.push({ s: cur, a: t0, b: Math.min(t, now) });
    cur = s; t0 = Math.min(t, now);
  };
  const evs = [...events].sort((a, b) => a.at - b.at).filter((e) => e.at <= now);
  // This Mac restarted between two events: the link stopped with it (at its last "still running" mark, else some
  // time after its last word: not known) and ran again only from the next event.
  let prev = null;
  const restart = (until) => {
    if (!bootAt || prev == null || !(bootAt > prev && bootAt <= until) || cur === 'off') return;
    if (aliveAt && aliveAt > prev && aliveAt < bootAt) go('off', aliveAt + 1);
    else { go('none', prev + 1); go('off', bootAt); }
  };
  for (const e of evs) { restart(e.at); go(e.kind === 'live' ? 'up' : DOWN.has(e.kind) ? 'down' : e.kind === 'stopped' || e.kind === 'wrong-login' ? 'off' : cur, e.at); prev = e.at; }
  if (!running && evs.length && cur !== 'off') {
    const last = Math.max(evs.at(-1).at, aliveAt ?? 0);
    if (aliveAt && aliveAt >= evs.at(-1).at) go('off', aliveAt + 1);
    else { go('none', last + 1); if (bootAt && bootAt > last) go('off', bootAt); }
  }
  if (now > t0) segs.push({ s: cur, a: t0, b: now });
  return { from, to: now, segs: segs.filter((x) => x.b > x.a) };
}
