import { slugify } from './strings.mjs';
import { clamp } from './numbers.mjs';

console.log(slugify('Hello World'), clamp(12, 0, 10));
