// Rows as a text table: "name  score" per line.
export function table(rows) {
  return rows.map((r) => `${r.name}  ${r.score}`).join('\n');
}
