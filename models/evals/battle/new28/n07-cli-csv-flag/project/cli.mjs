import { table } from './report.mjs';

const rows = [{ name: 'ann', score: 3 }, { name: 'bo', score: 5 }];
console.log(table(rows));
