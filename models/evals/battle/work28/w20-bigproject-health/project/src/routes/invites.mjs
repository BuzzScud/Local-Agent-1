import { db } from '../lib/db.mjs';

export const create = (req) => ({ status: 201, body: db.add('invites', { role: req.body?.role ?? 'member', sentAt: Date.now() }) });
