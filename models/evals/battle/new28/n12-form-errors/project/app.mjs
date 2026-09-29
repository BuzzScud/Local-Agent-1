import { validate } from './form.mjs';

const form = { name: 'Ann', age: 34, email: 'ann@example.com' };
console.log(validate(form) ? 'ok' : 'please fix the form');
