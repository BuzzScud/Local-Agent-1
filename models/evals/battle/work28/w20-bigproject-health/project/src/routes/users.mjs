import { db } from '../lib/db.mjs';

export const list = () => ({ status: 200, body: db.all('users').map(({ name, role }) => ({ name, role })) });
