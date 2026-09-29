import { loadUser } from './users.mjs';

const user = await loadUser(2);
console.log(user.name);
