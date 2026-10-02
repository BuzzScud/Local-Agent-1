// Which practice tasks a run of run.mjs plays, from the folder names in tasks/ ("10-fix-off-by-one").
//   --set 28    the 28 that grade a model (1–28). 29, the notes page, is an extra: it runs only when
//               named (--only 29) or with no --set and no --only (every folder, as before).
//   --set hard  the 10 hard ones (30–39, 2 Oct 2026) for the bigger models on a service: several
//               files, an exact edge case, a spec to follow, a vague request with two causes.
// A run with no --set and no --only plays only 1–29, so the hard ones never slow a local run.
//   --only 1,3  those numbers only (a part of the set: the record keeps it apart from full runs)
// The order is the folder names' own (1, 10, 11 … 19, 2, 20 …), the order the runs have always had.
export const SETS = { 28: (n) => n >= 1 && n <= 28, hard: (n) => n >= 30 && n <= 39 };

export function pickTasks(folders, { only = null, set = null } = {}) {
  const num = (t) => Number(/^(\d+)-/.exec(t)?.[1]);
  let out = [...folders].filter((t) => Number.isInteger(num(t))).sort();
  if (set != null) {
    const has = SETS[set];
    if (!has) throw new Error(`no set "${set}": the sets are ${Object.keys(SETS).join(', ')}`);
    out = out.filter((t) => has(num(t)));
  } else if (!only) out = out.filter((t) => num(t) < 30);
  if (only) out = out.filter((t) => only.some((o) => t.startsWith(`${o}-`)));
  return out;
}
