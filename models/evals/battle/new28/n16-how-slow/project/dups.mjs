// The values that appear more than once, each named once.
export function findDuplicates(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i] === list[j] && !out.includes(list[i])) out.push(list[i]);
    }
  }
  return out;
}
