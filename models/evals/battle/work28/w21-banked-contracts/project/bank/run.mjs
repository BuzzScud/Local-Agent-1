import { CONTRACTS, KEEP_DAYS } from './config.mjs';
import { saveDay, dropOlderThan } from './store.mjs';

// Runs every night: saves today's bars of each contract, then drops what is too old.
const today = new Date().toISOString().slice(0, 10);
for (const c of CONTRACTS) await saveDay(c, today);
await dropOlderThan(KEEP_DAYS);
