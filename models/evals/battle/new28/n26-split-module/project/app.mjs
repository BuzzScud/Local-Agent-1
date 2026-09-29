import { slugify, clamp } from './utils.mjs';

console.log(slugify('Hello World'), clamp(12, 0, 10));
