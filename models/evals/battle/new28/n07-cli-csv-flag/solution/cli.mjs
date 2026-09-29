import { table, csv } from './report.mjs';

const rows = [{ name: 'ann', score: 3 }, { name: 'bo', score: 5 }];
console.log(process.argv.includes('--csv') ? csv(rows) : table(rows));
