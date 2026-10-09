// The models the web uses, by job (Agentic Coder Web, 8 Oct 2026, the owner's pick "A · control
// room"): an admin picks a model for each job from what the services really have, and says who
// may pick each model. Kept in settings.json under models:
//   roles:  { tasks, chat, standIn, lastResort, helper } → { service, model } (or null)
//   access: { "<service>|<model>": "all" | "admin" | "off" }
// Older settings still read: models.default (tasks and chat), spill.to (the stand-in),
// models.lastResort (a list), models.blocked (off everywhere).
import { DEFAULT_MODEL, LAST_RESORT } from './config.mjs';

const k = (n) => `${Math.round(n / (n % 1024 ? 1000 : 1024))}k`;

export const ROLES = [
  { id: 'tasks', label: 'Tasks default', what: 'An Agentic Coder run when the person picked no model.' },
  { id: 'chat', label: 'Chat default', what: 'A plain chat (this copy\'s chat, the API\'s chat) when the person picked no model.' },
  { id: 'standIn', label: 'Stand-in', what: 'Where a request goes when its own service gives no first word in time. Never the last resort.' },
  { id: 'lastResort', label: 'Last resort', what: 'Huge work, only after the person says yes to switching (Laguna today).' },
  { id: 'helper', label: 'Helper', what: 'A run\'s side jobs (summaries, second looks) instead of its main model. None: the main model does them.' },
];
export const ACCESS = ['all', 'admin', 'off'];
const key = (service, model) => `${service}|${model}`;

// The model a job uses: { service, model } or null. service may be null for an old setting that
// named only a model (the first service that has it is used).
export function roleOf(s, role) {
  const r = s.models?.roles?.[role];
  if (r?.model) return { service: r.service ?? null, model: r.model };
  if (role === 'tasks') return { service: null, model: s.models?.default ?? DEFAULT_MODEL };
  if (role === 'chat') return roleOf({ ...s, models: { ...s.models, roles: { ...s.models?.roles, chat: null } } }, 'tasks');
  if (role === 'standIn') return s.spill?.to?.model ? { service: s.spill.to.service, model: s.spill.to.model } : null;
  if (role === 'lastResort') return { service: null, model: (s.models?.lastResort ?? LAST_RESORT)[0] };
  return null;
}
export const sameModel = (a, b) => Boolean(a && b && a.model === b.model && (a.service == null || b.service == null || a.service === b.service));

// The last resort: the role's model (and the old list's), wherever it is.
export function isLastResort(s, model, service = null) {
  const r = roleOf(s, 'lastResort');
  if (r && r.model === model && (r.service == null || service == null || r.service === service)) return true;
  return !s.models?.roles?.lastResort && (s.models?.lastResort ?? LAST_RESORT).includes(String(model));
}

// Who may pick a model: all · admin · off. The last resort is admins' unless set otherwise.
export function accessOf(s, service, model) {
  const a = s.models?.access?.[key(service, model)];
  if (ACCESS.includes(a)) return a;
  if ((s.models?.blocked ?? []).includes(model)) return 'off';
  return isLastResort(s, model, service) ? 'admin' : 'all';
}

// Is a model fit for a job? { level: 'ok' | 'warn' | 'no', why: [words] }.
//   m: a model entry (caps, maxCtx or ctx, gb…); tasksCtx: what the tasks default is loaded at (none: not checked)
export function fitFor(role, m, { service, tasksCtx = null, standInService = null } = {}) {
  const why = [];
  let level = 'ok';
  const warn = (w) => { why.push(w); if (level === 'ok') level = 'warn'; };
  const no = (w) => { why.push(w); level = 'no'; };
  if (!m) return { level: 'no', why: ['not on that service now'] };
  const max = m.maxCtx ?? m.ctx ?? null; // what it can hold at most (not what it is loaded at)
  if (m.caps && !m.caps.chat) no('it cannot chat (an embedding model)');
  if (role === 'tasks' && m.caps && !m.caps.tools) warn('no tools: a run will most likely fail');
  if (role === 'chat' && m.caps && !m.caps.tools) warn('no tools: it answers without the calculator');
  if (role === 'standIn') {
    if (m.caps && !m.caps.tools) warn('no tools: runs that move here will likely fail');
    if (standInService != null && service === standInService) warn('on the same service as the default: when that service is silent, so is this');
  }
  if (role === 'lastResort' && tasksCtx && max && max <= tasksCtx) warn(`it holds at most ${k(max)}, no more than the tasks default is loaded at (${k(tasksCtx)})`);
  if (role === 'helper' && m.gb > 12) warn(`${m.gb} GB: loading it may push a bigger model out of memory`);
  if ((role === 'tasks' || role === 'chat') && max && max < 16384) warn(`it reads only ${k(max)} at once`);
  return { level, why };
}

// A user's picker: the warnings a model carries (the owner's pick: shown, with a warning).
export function warningsOf(m, { mac = true } = {}) {
  const out = [];
  if (m.caps && !m.caps.chat) out.push('cannot chat: it will fail');
  else if (mac && m.caps && !m.caps.tools) out.push('no tools: tasks will likely fail');
  else if (!mac && m.caps && !m.caps.tools) out.push('no tools: no calculator');
  return out;
}
