import { db } from '../lib/db.mjs';

export const list = () => ({ status: 200, body: db.all('bars') });
export const save = (req) => ({ status: 201, body: db.add('bars', req.body ?? {}) });
