// The pickers (screen.jsx): mode, a choice, /jump, /rewind, /settings and /effort with its
// limits. Moved from screen.jsx word for word.
import React from 'react';
import { Box, Text } from 'ink';
import { C } from '../ui/theme.mjs';
import { wrap } from '../ui/parts.jsx';
import { showLimit, limitNote, isDefault, effortNote, defaultLevelId, shownLimits, tuneGroup } from './limits.mjs';
import { jumpRows, rowStatus, jumpInfo } from './jump-box.mjs';
import { DETACH_LABEL } from './sessions.mjs';
import { spillWord } from './profiles.mjs';
import { NamedRule } from './screen-ask.jsx';
import { memoryWarning } from './screen-live.jsx';

// What "Starting" is waiting for.
export const START_PHASE = {
  loading: 'loading the model ',
  reading: 'reading its instructions, about 30 s the first time ',
  restoring: 'restoring its instructions from last time ',
  waiting: 'waiting for memory ',
  connecting: 'connecting to it ',
};

// /mode (and /permissions' start-up mode): the five modes as Claude Code's menu draws
// them: the name (Auto with its Recommended tag) over what it does, the number on the
// right, ✓ by the one in use. Bypass is red: nothing asks in it.
function ModePicker({ app }) {
  const pk = app.picker;
  const inner = app.width - 4; // the border and one space each side
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>{pk.title}</Text>
      <Text color={C.dim} wrap="truncate-end">{pk.blurb}</Text>
      <Text> </Text>
      {pk.options.map((o, i) => {
        const on = i === pk.index;
        const cur = o.id === pk.current;
        return (
          <Box key={o.id} flexDirection="column">
            <Box width={inner} justifyContent="space-between">
              <Text>
                <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} </Text>
                <Text color={o.id === 'bypass' ? C.bypass : on ? C.accent : undefined} bold={on}>{o.label}</Text>
                {o.recommended ? <Text>  <Text backgroundColor="ansi256(238)" color="ansi256(252)"> Recommended </Text></Text> : null}
              </Text>
              <Text>{cur ? <Text color={C.ok}>✓ </Text> : null}<Text color={C.dim}>{i + 1}</Text></Text>
            </Box>
            <Text color={C.dim} wrap="truncate-end">  {o.note}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text color={C.dim}>↑↓ to choose · a number or enter to select · esc to go back</Text>
    </Box>
  );
}

// /mode and /meters alone: their choices as a menu, like Claude Code's.
// The ❯ starts on the one in use; ↑↓ or a number, enter picks, esc goes back.
export function ChoicePicker({ app }) {
  const pk = app.picker;
  if (pk.id === 'mode' || pk.id === 'startmode') return <ModePicker app={app} />;
  // A question the app asks for itself (ask: true), drawn as the model's questions are (AskChoices):
  // one line a choice, "(recommended)" beside one, what the highlighted one means under the list.
  if (pk.ask) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.ask} paddingX={1} width={app.width}>
        <Text>{pk.title}</Text>
        {pk.options.map((o, i) => {
          const on = i === pk.index;
          return <Text key={o.id} color={on ? C.ask : undefined}>{on ? '❯' : ' '} {i + 1}. {o.label}{o.recommended ? <Text color={C.dim}>  (recommended)</Text> : null}</Text>;
        })}
        <Box marginTop={1} paddingX={2}><Text color={C.dim}>{pk.options[pk.index]?.note ? `ⓘ ${pk.options[pk.index].note}` : ''}</Text></Box>
        <Box marginTop={1}><Text color={C.dim}>Enter pick · ↑/↓ move · Esc {pk.escWord ?? 'go back'}</Text></Box>
      </Box>
    );
  }
  const w = Math.max(...pk.options.map((o) => o.label.length)) + 2;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>{pk.title}</Text>
      <Text color={C.dim}>{pk.blurb}</Text>
      <Text> </Text>
      {pk.options.map((o, i) => {
        const on = i === pk.index;
        return (
          <Text key={o.id}>
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {i + 1}. {o.label.padEnd(w)}</Text>
            <Text color={C.dim}>{o.note}</Text>
            {o.id === pk.current ? <Text color={C.ok}>  ✔ in use</Text> : null}
          </Text>
        );
      })}
      <Text> </Text>
      <Text color={C.dim}>↑↓ to choose · enter to select · esc to go back</Text>
    </Box>
  );
}

// /jumptomac alone: "Jump to a Mac" (jump-box.mjs; Design 2 of the 3 Oct round): the saved Macs, the ones only
// Tailscale knows, "+ Add a Mac", each with what Tailscale says, and the line under them.
export function JumpPicker({ app }) {
  const pk = app.picker;
  const rows = jumpRows(pk);
  const at = Math.min(pk.index, rows.length - 1);
  const info = jumpInfo(pk);
  const tone = { on: C.accent, off: C.dim, dim: C.dim };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Box justifyContent="space-between">
        <Text bold>Jump to a Mac</Text>
        <Text color={C.dim} wrap="truncate-start">{pk.here ? `from ${pk.here}` : ''}</Text>
      </Box>
      <Text color={C.dim} wrap="truncate-end">Its sessions open in this window; this one keeps running, and {DETACH_LABEL} there comes back.</Text>
      <Text> </Text>
      {rows.map((r, i) => {
        const on = i === at;
        const typing = r.add && pk.adding !== null;
        return (
          <Text key={r.name} wrap="truncate-end">
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {r.name.padEnd(19)}</Text>
            {typing ? <><Text>{pk.adding}</Text><Text inverse> </Text><Text>{'   '}</Text></> : null}
            {rowStatus(pk, r).map((x, j) => <Text key={j} color={tone[x.tone]}>{x.text}</Text>)}
          </Text>
        );
      })}
      <Text> </Text>
      <Box paddingX={2}><Text color={info.tone === 'warn' ? C.warn : C.dim} wrap="truncate-end">ⓘ  {info.text}</Text></Box>
      <Text color={C.dim} wrap="truncate-end">{pk.adding !== null ? 'type the Mac’s Tailscale name · enter tries it · esc stops' : 'enter jumps · ↑↓ choose · ⌫ forgets a saved Mac · esc cancels'}</Text>
    </Box>
  );
}

// /rewind: your messages, newest first (a window of them when there are
// many), then what to put back to before the one picked and what that does.
export function RewindPicker({ app }) {
  const pk = app.picker;
  const cut = (t, w) => { const one = t.split('\n')[0]; return one.length > w || t.includes('\n') ? `${one.slice(0, Math.max(1, w - 1))}…` : one; };
  if (pk.stage === 'choose') {
    const m = pk.items[pk.index];
    const w = Math.max(...pk.options.map((o) => o.label.length)) + 2;
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
        <Text bold wrap="truncate-end">Rewind to before "{cut(m.text, app.width - 30)}"</Text>
        <Text> </Text>
        {pk.options.map((o, i) => {
          const on = i === pk.choice;
          return (
            <Text key={o.id}>
              <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {i + 1}. {o.label.padEnd(w)}</Text>
              <Text color={C.dim}>{o.note}</Text>
            </Text>
          );
        })}
        <Text> </Text>
        {pk.lines.map((l, i) => <Text key={i} color={l.tone === 'warn' ? C.warn : l.tone === 'dim' ? C.dim : undefined} wrap="wrap">{l.text}</Text>)}
        <Text> </Text>
        <Text color={C.dim}>↑↓ to choose · enter to select · esc to go back</Text>
      </Box>
    );
  }
  const view = Math.max(3, Math.min(pk.items.length, app.rows - 14));
  const top = Math.max(0, Math.min(pk.index - Math.floor(view / 2), pk.items.length - view));
  const noteW = Math.max(...pk.items.map((m) => m.note.length));
  const longest = Math.max(...pk.items.map((m) => m.text.split('\n')[0].length + (m.text.includes('\n') ? 1 : 0)));
  const textW = Math.max(12, Math.min(longest, 70, app.width - noteW - 12));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Text bold>Rewind</Text>
      <Text color={C.dim}>Put the files the model changed, and the conversation, back to before one of your messages.</Text>
      <Text> </Text>
      {top > 0 ? <Text color={C.dim}>  ↑ {top} newer</Text> : null}
      {pk.items.slice(top, top + view).map((m, i) => {
        const on = top + i === pk.index;
        return (
          <Text key={m.n} wrap="truncate-end">
            <Text color={on ? C.accent : undefined} bold={on}>{on ? '❯' : ' '} {cut(m.text, textW).padEnd(textW)}</Text>
            <Text color={C.dim}>  {m.note}</Text>
          </Text>
        );
      })}
      {top + view < pk.items.length ? <Text color={C.dim}>  ↓ {pk.items.length - top - view} older</Text> : null}
      <Text> </Text>
      <Text color={C.dim}>↑↓ to choose · enter to see what goes back · esc to close</Text>
    </Box>
  );
}

// /settings: the commands kept out of the / menu, under their groups, each
// with what it holds now. ↑↓ to choose, enter opens it, esc goes back.
export function SettingsPicker({ app }) {
  const pk = app.picker;
  const all = pk.groups.flatMap((g) => g.rows);
  const on = all[pk.index];
  const lw = Math.max(...all.map((r) => r.label.length)) + 2;
  const vw = Math.min(26, Math.max(...all.map((r) => r.value.length)) + 2);
  const leftW = 2 + lw + vw;
  const rightW = Math.max(20, app.width - 4 - leftW);
  // 22 rows: the rule, then each group's heading and rows; a short window (24 rows, with the status
  // bar or the memory note under it) drops the last group's heading (its rows follow the ones above)
  const under = app.meters || memoryWarning(app.stats.ctxUsed ?? 0, app.ctx, app.stats.replyRoom ?? 0) ? 1 : 0;
  const noLastHead = all.length + pk.groups.length + 1 + under + 1 > app.rows;
  const blurb = all.length + pk.groups.length + 2 + under + 1 <= app.rows;
  return (
    <Box flexDirection="column" paddingX={2}>
      <NamedRule name={pk.title ?? 'Settings'} more="↑↓ choose · enter open · esc back" width={app.width - 4} />
      {blurb ? <Text color={C.dim} wrap="truncate-end">{pk.blurb ?? 'Everything not in the / menu. Each still works typed in full, like /doctor.'}</Text> : null}
      <Box>
        <Box flexDirection="column" width={leftW} flexShrink={0}>
          {pk.groups.flatMap((g, gi) => [
            ...(noLastHead && gi === pk.groups.length - 1 ? [] : [<Text key={g.group} bold color={C.dim}>{g.group.split(' · ')[0]}</Text>]),
            ...g.rows.map((r) => {
              const sel = r === on;
              return <Text key={r.name} wrap="truncate-end"><Text color={sel ? C.accent : undefined} bold={sel}>{sel ? '❯ ' : '  '}{r.label.padEnd(lw)}</Text><Text color={sel ? C.accent : C.dim}>{r.value.length > vw - 1 ? `${r.value.slice(0, vw - 2)}…` : r.value}</Text></Text>;
            }),
          ])}
        </Box>
        <Box flexDirection="column" borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={C.faint} paddingLeft={2} width={rightW}>
          <Text bold color={C.accent}>{on?.label}</Text>
          <Text color="ansi256(255)">{on?.value}</Text>
          <Text> </Text>
          {wrap(on?.note ?? '', rightW - 3).map((l, i) => <Text key={i}>{l}</Text>)}
          <Text> </Text>
          <Text color={C.dim}>enter opens it</Text>
        </Box>
      </Box>
    </Box>
  );
}
// /effort, one panel: the Effort row, then the search's rows (Embedder,
// Retriever, Reranker) and every limit that can move, each under its heading,
// each value between ◀ ▶ with what it costs. ↻ marks the two that restart
// the model; • a value not saved yet. Thinking cap is dimmed while Effort is Low.
// Eleven limits (Look first last) keep the panel within 22 lines because the keys' hint sits on the
// Reset all line, not a line of its own: it fits a 24-row window (app-effort.test.mjs).
// On an Ollama service the Effort row is Thinking (the model's own choices: Off · On, Off · Max…),
// the Thinking cap is a line saying why it is not there, and the ranks page's values are suggested
// beside the rows (remote-suggested.mjs). /model's menu for one model (pk.own, 2 Oct 2026) is this
// panel with only the rows each model keeps for itself, and a line on why those values are suggested.
// /tune (pk.tune, 27 Oct 2026) is that menu for the model in use with /tune's rows (TUNE_ROWS: Preset on top,
// How it writes, then Limits) and a row for its own instructions; t saves and tests them.
export function LimitsPicker({ app }) {
  const pk = app.picker;
  const own = pk.own ?? null;
  const tune = Boolean(pk.tune);
  const svc = Boolean(own || pk.model.remote?.ollama);
  const shown = shownLimits(pk.model, { own: Boolean(own), tune });
  const sg = pk.suggested ?? null;
  const levels = pk.model.thinkingLevels ?? [];
  const lv = levels[pk.level];
  const off = lv ? 1 : 0; // the Effort row, when the model has levels
  const effortOn = lv ? !!lv.effort : undefined;
  const effortWord = svc ? 'Thinking' : 'Effort';
  const lw = Math.max(...shown.map((l) => l.label.length), off ? effortWord.length : 0, svc ? 'Thinking cap'.length : 0) + 2;
  // Wide enough for every name a search row can show, so the notes do not move.
  const vw = Math.max(...shown.flatMap((l) => (l.choice ? l.steps(pk.model).map((s) => showLimit(l.id, s).length) : [showLimit(l.id, pk.values[l.id]).length])), ...levels.map((l) => l.label.length)) + 1;
  const heading = (name) => <Text key={`h-${name}`} color={C.faint}>{`── ${name} `}{'─'.repeat(Math.max(0, app.width - 8 - name.length))}</Text>;
  const env = { ...pk.env, values: pk.values, effortOn, effortLevel: lv?.effort ?? null, effortWord };
  const pr = own?.profile ?? null; // /model's step 3: a profile's settings (app-profiles.mjs)
  const onNotes = tune && pk.index === off + shown.length;
  const reset = pk.index === off + shown.length + (pr ? 2 : 0) + (tune ? 1 : 0);
  // Its two rows fit 80 × 24 by leaving out three lines there: the Suggested line, the Thinking cap line and the Profile heading.
  const roomy = !pr || (app.rows ?? 24) >= 30;
  const onEffort = off && pk.index === 0;
  const effortUnsaved = pk.level !== pk.savedLevel;
  // What the ranks page suggests for a row: ✓ when it already has it.
  const suggests = (v, want, show) => (want === undefined || want === null ? '' : v === want ? '✓ suggested · ' : `suggested ${show(want)} · `);
  const where = pr ? `${own.id} · enter saves ${pr.name}; the next request that uses it goes there` : own ? (own.inUse ? 'in use · enter saves, from its next step' : 'nothing loads until you press enter') : '←→ moves a row; its cost is on the right. Kept for next time.';
  const keys = tune ? `↑↓ choose · ←→ change${sg ? ' · s suggested' : ''} · enter saves · t saves and tests on 3 Arena tasks · esc cancels`
    : pr ? `↑↓ choose · ←→ change${sg ? ' · s suggested' : ''} · enter saves ${pr.name} · esc back` : own ? `↑↓ choose · ←→ change${sg ? ' · s suggested' : ''} · enter ${own.inUse ? 'saves' : 'switches to it'} · esc ${own.back ? 'back to the list' : 'cancels'}`
    : `↑↓ choose · ←→ change${sg ? ' · s suggested' : ''} · enter saves · esc cancels${svc ? '' : ' · ↻ restarts model'}`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      {/* The hint sits on the title's line: the panel stays within 22 lines with Who decides in it. */}
      <Text wrap="truncate-end"><Text bold>{tune ? `/tune · ${own.id}` : pr ? `/model · 3 of 3: ${pr.name}’s settings` : own ? `${own.id} · its own settings` : svc ? `Effort and limits · ${pk.model.remote.model}` : 'Effort and limits'}</Text><Text color={C.dim}>{'   '}{where}</Text></Text>
      {own && roomy ? (
        <Text color={C.dim} wrap="truncate-end">{sg ? `Suggested: ${sg.why} · ${sg.source}` : 'Nothing suggested for it on the ranks page: each row starts from the shared settings.'}</Text>
      ) : null}
      {lv ? (
        <>
          <Text wrap="truncate-end">
            <Text color={onEffort ? C.accent : undefined} bold={onEffort}>{onEffort ? '❯' : ' '} {effortWord.padEnd(lw)}</Text>
            <Text color={onEffort && pk.level > 0 ? C.accent : C.faint}>◀ </Text>
            <Text color={effortUnsaved ? C.accent : undefined} bold={effortUnsaved}>{lv.label.padEnd(vw)}</Text>
            <Text color={onEffort && pk.level < levels.length - 1 ? C.accent : C.faint}>▶ </Text>
            <Text color={effortUnsaved ? C.accent : C.faint}>{effortUnsaved ? '•' : ' '}</Text>
            <Text color={C.dim}>{'  '}{suggests(lv.id, sg?.level, (id) => levels.find((l) => l.id === id)?.label ?? id)}{lv.id === defaultLevelId(pk.model) && !svc ? 'default · ' : ''}{effortNote(lv, pk.values.thinking)}</Text>
          </Text>
        </>
      ) : null}
      {shown.map((l, i) => {
        // A heading where a group starts: "Search" over the search's rows, "Limits" over the rest.
        // Who decides (group 'Effort') sits under the Effort row with no heading of its own.
        // On a service /effort says which rows the model keeps for itself.
        const groupOf = (x) => (tune ? tuneGroup(x.id) : x.group ?? 'Limits');
        const group = groupOf(l);
        const title = svc && !own ? 'Limits · this model’s own' : group;
        const head = group !== 'Effort' && (i === 0 || groupOf(shown[i - 1]) !== group) ? heading(title) : null;
        const on = off + i === pk.index;
        const v = pk.values[l.id];
        const steps = l.steps(pk.model);
        const unsaved = v !== pk.saved[l.id];
        const note = limitNote(l.id, env);
        const idle = l.id === 'thinking' && effortOn === false; // not used while Effort is Low
        return (
          <React.Fragment key={l.id}>
          {head}
          <Text wrap="truncate-end">
            <Text color={on ? C.accent : idle ? C.dim : undefined} bold={on}>{on ? '❯' : ' '} {l.label.padEnd(lw)}</Text>
            <Text color={on && v !== steps[0] ? C.accent : C.faint}>◀ </Text>
            <Text color={unsaved ? C.accent : idle ? C.dim : undefined} bold={unsaved}>{showLimit(l.id, v).padEnd(vw)}</Text>
            <Text color={on && v !== steps.at(-1) ? C.accent : C.faint}>▶ </Text>
            <Text color={unsaved ? C.accent : C.faint}>{unsaved ? '•' : ' '}</Text>
            <Text color={C.dim}>{l.restart && !svc ? '↻ ' : '  '}</Text>
            <Text color={note.startsWith('⚠') ? C.warn : C.dim}>{suggests(v, sg?.limits?.[l.id], (x) => showLimit(l.id, x))}{isDefault(l.id, pk.values, pk.model) ? 'default · ' : ''}{note}</Text>
          </Text>
          {/* Their place on a service: why there is no Thinking cap there (and, in /effort, where the search went). One line, so the panel keeps its 22. */}
          {svc && l.id === 'context' && roomy && !tune ? (own
            ? <Text color={C.dim} wrap="truncate-end">{'  '}{'Thinking cap'.padEnd(lw)}{'  '}not on a service: Ollama has no thinking limit, so Reply length holds the thinking and the answer</Text>
            : <Text color={C.dim} wrap="truncate-end">{'  '}{'Not here'.padEnd(lw)}{'  '}Thinking cap: Ollama has none, Reply length holds it all · Search: the service’s own, /profiles gives it a model</Text>) : null}
          </React.Fragment>
        );
      })}
      {pr ? (() => {
        const base = off + shown.length;
        const bk = pr.backups[pr.backup];
        const sp = pr.spills[pr.spill];
        const line = (k, label, value, first, last, note, idle) => {
          const on = pk.index === base + k;
          return (
            <Text key={label} wrap="truncate-end">
              <Text color={on ? C.accent : idle ? C.dim : undefined} bold={on}>{on ? '❯' : ' '} {label.padEnd(lw)}</Text>
              <Text color={on && !first ? C.accent : C.faint}>◀ </Text>
              <Text color={idle ? C.dim : undefined}>{value.padEnd(vw)}</Text>
              <Text color={on && !last ? C.accent : C.faint}>▶ </Text>
              <Text color={C.dim}>{'   '}{note}</Text>
            </Text>
          );
        };
        return (
          <>
            {roomy ? heading(`Profile · ${pr.name}${pr.isNew ? ' (new)' : ''}`) : null}
            {line(0, 'Backup', bk ?? 'none', pr.backup === 0, pr.backup === pr.backups.length - 1, bk ? `when this server is busy or slow, the request goes to ${bk}` : 'no backup: a busy server is waited for, as today')}
            {line(1, 'Spill after', bk ? spillWord(sp) : '—', pr.spill === 0, pr.spill === pr.spills.length - 1, bk ? (sp ? `no first word in ${sp} s → ${bk}; a "busy" answer goes at once` : `only when the server answers "busy"`) : 'needs a backup', !bk)}
          </>
        );
      })() : null}
      {/* /tune: its own instructions, one line: enter puts them in the prompt box to change (/tune notes …). */}
      {tune ? (
        <Text wrap="truncate-end">
          <Text color={onNotes ? C.accent : undefined} bold={onNotes}>{onNotes ? '❯' : ' '} {'Instructions'.padEnd(lw)}</Text>
          <Text color={pk.notes ? undefined : C.dim}>{'  '}{pk.notes ? pk.notes.replace(/\s+/g, ' ') : 'none of its own'}</Text>
          <Text color={C.dim}>{'  · '}{onNotes ? 'enter: change them in the prompt box (/tune notes …), saved with enter there' : 'the last part of its working instructions'}</Text>
        </Text>
      ) : null}
      <Text wrap="truncate-end">
        <Text color={reset ? C.accent : undefined} bold={reset}>{reset ? '❯' : ' '} {(svc ? 'Use shared' : 'Reset all').padEnd(lw)}</Text>
        <Text color={C.dim}>{'  '}{reset && svc ? `enter: ${own?.id ?? pk.model.remote?.model ?? 'it'} back to the shared settings${own && !own.inUse ? ', then it switches' : ''}` : keys}</Text>
      </Text>
    </Box>
  );
}
