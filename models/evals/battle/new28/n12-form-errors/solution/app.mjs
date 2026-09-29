import { validate } from './form.mjs';

const form = { name: 'Ann', age: 34, email: 'ann@example.com' };
const bad = validate(form);
console.log(bad.length ? `please fix: ${bad.join(', ')}` : 'ok');
