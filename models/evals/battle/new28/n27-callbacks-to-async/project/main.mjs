import { loadUser } from './users.mjs';

loadUser(2, (err, user) => {
  if (err) throw err;
  console.log(user.name);
});
