// /profiles and /model's step 2 on the screen (profiles.mjs has the rows, app-profiles.mjs the keys).
//   ProfileStep    /model · 2 of 3: which profile uses the model picked
//   ProfilesPanel  /profiles: the profiles (◀ model ▶ and today's meters), then one group's rows, each
//                  with ◀ profile ▶ (8 Oct 2026, the owner's pick of two designs: 1 · Rows)
import React from 'react';
import { Box, Text } from 'ink';
import { C } from '../ui/theme.mjs';
import { listRows as profileListRows, inheritedOf, cannotDo, usersOf, serverWord, spillWord } from './profiles.mjs';
import { readMetersSoon, meterWords } from '../agent/profile-meters.mjs';

const pad = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t.padEnd(n); };
const backupWord = (p) => (p?.backup ? `${p.backup} ${p.spillAfter ? `after ${spillWord(p.spillAfter)}` : 'when busy'}` : 'none');
// The service's models as cannotDo reads them.
const seen = (ctx) => ctx.models?.map((m) => ({ ...m, vision: m.vision ?? (m.caps ?? []).includes('vision'), embedding: m.embedding ?? (m.caps ?? []).includes('embedding') }));
// While a reply runs: a change here reaches its next step (the owner's ask, 8 Oct 2026).
function WorkingLine({ ctx }) {
  return ctx?.busy ? <Text color={C.accent} wrap="truncate-end">⏵ A reply is running: a change here reaches its next step. The step under way finishes where it started.</Text> : null;
}

export function ProfileStep({ app }) {
  const pk = app.picker;
  const ctx = app.profilesCtx ?? {};
  const d = pk.data;
  const e = pk.entry;
  const names = Object.keys(d.profiles);
  const nameW = Math.max(8, ...names.map((n) => n.length + 2));
  const modelW = Math.min(28, Math.max(14, ...names.map((n) => `now ${d.profiles[n].model}`.length + 2)));
  const cur = pk.rows[pk.at];
  const users = (n) => usersOf(n, d);
  const detail = cur?.kind === 'profile'
    ? (d.profiles[cur.name].model === e.id
      ? `${cur.name} uses ${e.id} already: its settings come next.`
      : `${cur.name} → ${e.id}: ${users(cur.name).length ? `${users(cur.name).slice(0, 3).join(', ')}${users(cur.name).length > 3 ? ` and ${users(cur.name).length - 3} more` : ''} move${users(cur.name).length === 1 ? 's' : ''} to it` : 'nothing uses it yet'}, from the ${ctx.busy ? 'next step' : 'next request'}.`)
    : cur?.kind === 'new' ? 'A new profile with this model. /profiles then gives it jobs (an AI, a task type, a category or a skill).'
      : 'Today’s switch: only this window’s conversation moves, no profile, and only once the reply ends.';
  const row = (r, k) => {
    const on = k === pk.at;
    const mark = <Text color={C.accent}>{on ? '❯ ' : '  '}</Text>;
    if (r.kind === 'profile') {
      const p = d.profiles[r.name];
      const u = users(r.name);
      return (
        <Text key={r.name} wrap="truncate-end">
          {mark}
          <Text bold={on} color={on ? C.accent : undefined}>{pad(r.name, nameW)}</Text>
          <Text color={C.dim}>{pad(`now ${p.model}`, modelW)}</Text>
          <Text color={C.dim}>{pad(serverWord(p.server), 12)}</Text>
          <Text color={u.length ? undefined : C.dim}>{u.length ? u.join(', ') : 'nothing uses it yet'}</Text>
        </Text>
      );
    }
    if (r.kind === 'new') return <Text key="new" wrap="truncate-end">{mark}{pk.naming !== null ? <Text><Text bold color={C.accent}>+ New profile: </Text>{pk.naming}<Text color={C.accent}>█</Text><Text color={C.dim}>   enter names it · esc cancels</Text></Text> : <Text bold={on} color={on ? C.accent : undefined}>+ New profile…</Text>}</Text>;
    return <Text key="window" wrap="truncate-end">{mark}<Text bold={on} color={on ? C.accent : C.dim}>Just this window (no profile)</Text></Text>;
  };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <Box justifyContent="space-between">
        <Text bold wrap="truncate-end">/model · 2 of 3: which profile uses it?</Text>
        <Text color={C.dim} wrap="truncate-start">{app.width < 100 ? `  ${e.id}` : `  ${e.id}${e.bytes ? ` · ${(e.bytes / 1e9).toFixed(1)} GB` : ''}${e.loaded ? ' · loaded' : ''}`}</Text>
      </Box>
      <Text color={C.dim} wrap="truncate-end">A profile is a server, a model and its settings by name. Everything that uses it moves with it.</Text>
      <WorkingLine ctx={ctx} />
      <Text> </Text>
      {pk.rows.map(row)}
      <Text> </Text>
      <Text color={C.dim} wrap="truncate-end">{`  ${detail}`}</Text>
      <Text> </Text>
      <Text color={C.dim} wrap="truncate-end">↑↓ choose · enter its settings (step 3) · esc back to the models</Text>
    </Box>
  );
}

// ---- /profiles --------------------------------------------------------------------------------


// A window under 30 rows (80 × 24) leaves out the explaining lines and the blank ones (roomy).
const roomyOf = (app) => (app.rows ?? 40) >= 30;
function PanelHead({ app, title, sub }) {
  const ctx = app.profilesCtx ?? {};
  return (
    <>
      <Box justifyContent="space-between">
        <Text bold wrap="truncate-end">{title}</Text>
        <Text color={C.dim} wrap="truncate-start">{`  every window on this Mac follows them${ctx.where ? ` · ${ctx.where}` : ''}`}</Text>
      </Box>
      {roomyOf(app) ? <Text color={C.dim} wrap="truncate-end">{sub}</Text> : null}
      <WorkingLine ctx={ctx} />
    </>
  );
}

// The profiles as a table (◀ model ▶ on the highlighted one), then the open group's rows, each with its profile between ◀ ▶.
export function ProfilesPanel({ app }) {
  const pk = app.picker;
  const ctx = app.profilesCtx ?? {};
  const d = pk.data;
  const rows = profileListRows(pk);
  const cur = rows[pk.at];
  const names = Object.keys(d.profiles);
  const W = app.width - 4;
  const nameW = Math.max(9, ...names.map((n) => n.length + 2));
  const modelW = Math.min(22, Math.max(16, ...names.map((n) => d.profiles[n].model.length + 2)));
  const g = pk.groups[pk.tab];
  const labelW = Math.max(18, ...g.rows.map((r) => r.label.length + 2));
  const pickW = Math.max(10, ...names.map((n) => n.length + 4));
  // The group's rows that fit, the cursor's among them.
  const useRows = rows.filter((r) => r.kind === 'use');
  const first = rows.findIndex((r) => r.kind === 'use');
  const roomy = roomyOf(app);
  const B = roomy ? 1 : 0;
  // border 2, title, sub + blank, table head, profiles + New, blank, tabs, ↑ ↓ more, blank, detail, blank, keys, the cursor's line
  const fixed = 2 + 1 + 2 * B + 1 + names.length + 1 + B + 1 + 2 + B + 1 + B + 1 + 1 + (ctx.busy ? 1 : 0);
  const room = Math.max(3, (app.rows ?? 40) - fixed);
  const i = Math.max(0, pk.at - first);
  const top = Math.max(0, Math.min(i - Math.floor(room / 2), useRows.length - room));
  const shownUse = useRows.slice(top, top + room);
  // Today's meters over every window (profile-meters.mjs): a column where the window is wide, else the line under the rows.
  const meters = readMetersSoon();
  const wide = W >= 120;
  const detail = !cur ? '' : cur.kind === 'profile'
    ? `${cur.name}: ${meterWords(meters[cur.name])}${meters[cur.name]?.waitLast != null ? ` · last wait ${Math.round(meters[cur.name].waitLast)} s` : ''}. ←→ its model (saved at once) · enter its settings.`
    : cur.kind === 'new' ? 'enter: pick its model in /model (step 1), then name it in step 2.'
      : (() => {
        const r = cur.row;
        const own = d.uses[r.key];
        const via = own ? null : inheritedOf(r, d);
        const name = own ?? via?.name;
        const bad = cannotDo(r, d.profiles[name], seen(ctx));
        return `${r.label} ${own ? `uses ${own}` : `has no pick of its own: it uses ${name}${via?.from && via.from !== 'main' ? `, from ${fromWord(via.from, pk.groups)}` : ', the default'}`} (${d.profiles[name]?.model ?? 'none'}).${bad ? ` ⚠ ${bad}: ←→ gives it another.` : ''}`;
      })();
  const tabs = pk.groups.map((x, k) => (k === pk.tab ? `[ ${x.label} ]` : `  ${x.label}  `)).join(' ');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1} width={app.width}>
      <PanelHead app={app} title="Profiles" sub="A profile is a server, a model and its settings by name. Change one and the next request that uses it goes the new way." />
      {roomy ? <Text> </Text> : null}
      <Text color={C.dim} wrap="truncate-end">{`  ${pad('Profile', nameW)}  ${pad('Model', modelW)}  ${pad('Server', 12)}${pad('Backup', 20)}${wide ? pad('Today', 34) : ''}Used by`}</Text>
      {rows.filter((r) => r.kind !== 'use').map((r, k) => {
        const on = k === pk.at;
        const mark = <Text color={C.accent}>{on ? '❯ ' : '  '}</Text>;
        if (r.kind === 'new') return <Text key="new" wrap="truncate-end">{mark}<Text bold={on} color={on ? C.accent : C.dim}>+ New profile</Text></Text>;
        const p = d.profiles[r.name];
        const u = usersOf(r.name, d);
        return (
          <Text key={r.name} wrap="truncate-end">
            {mark}
            <Text bold={on} color={on ? C.accent : undefined}>{pad(r.name, nameW)}</Text>
            <Text color={on ? C.accent : C.faint}>{on ? '◀ ' : '  '}</Text>
            <Text>{pad(p.model, modelW)}</Text>
            <Text color={on ? C.accent : C.faint}>{on ? '▶ ' : '  '}</Text>
            <Text color={C.dim}>{pad(serverWord(p.server), 12)}{pad(backupWord(p), 20)}</Text>
            {wide ? <Text color={meters[r.name]?.spills ? C.warn : C.dim}>{pad(meterWords(meters[r.name]), 34)}</Text> : null}
            <Text color={u.length ? undefined : C.dim}>{u.length ? u.join(', ') : 'nothing yet'}</Text>
          </Text>
        );
      })}
      {roomy ? <Text> </Text> : null}
      <Box justifyContent="space-between" width={W}>
        <Text wrap="truncate-end"><Text bold>{tabs}</Text></Text>
        {W >= 100 ? <Text color={C.dim} wrap="truncate-start">  most specific wins: skill › task type › category › AI › Main</Text> : null}
      </Box>
      {top ? <Text color={C.dim}>{`  ↑ ${top} more`}</Text> : null}
      {shownUse.map((r) => {
        const on = r === cur;
        const own = d.uses[r.row.key];
        const via = own ? null : inheritedOf(r.row, d);
        const bad = cannotDo(r.row, d.profiles[own ?? via?.name], seen(ctx));
        return (
          <Text key={r.row.key} wrap="truncate-end">
            <Text color={C.accent}>{on ? '❯ ' : '  '}</Text>
            <Text bold={on} color={on ? C.accent : undefined}>{pad(r.row.label, labelW)}</Text>
            <Text color={on ? C.accent : C.faint}>◀ </Text>
            <Text bold={Boolean(own)} color={own ? undefined : C.dim}>{pad(own ?? via?.name ?? '—', pickW - 4)}</Text>
            <Text color={on ? C.accent : C.faint}> ▶  </Text>
            {bad ? <Text color={C.warn}>⚠ {bad}</Text> : <Text color={C.dim}>{own ? r.row.note : `${via?.from && via.from !== 'main' ? `from ${fromWord(via.from, pk.groups)}` : 'the default'} · ${r.row.note}`}</Text>}
          </Text>
        );
      })}
      {top + room < useRows.length ? <Text color={C.dim}>{`  ↓ ${useRows.length - top - room} more`}</Text> : null}
      {roomy ? <Text> </Text> : null}
      <Text color={detail.includes('⚠') ? C.warn : C.dim} wrap="truncate-end">{`  ${detail}`}</Text>
      {roomy ? <Text> </Text> : null}
      <Text color={C.dim} wrap="truncate-end">↑↓ row · ←→ a profile’s model or a row’s profile (saved at once) · tab next group · enter a profile’s settings · esc closes</Text>
    </Box>
  );
}

const fromWord = (key, groups) => {
  if (key === 'request') return 'the request it comes with';
  const [g, id] = String(key).split(':');
  const r = groups.find((x) => x.id === g)?.rows.find((x) => x.id === id);
  return r ? `${g === 'cat' ? 'category ' : ''}${r.label}` : key;
};
