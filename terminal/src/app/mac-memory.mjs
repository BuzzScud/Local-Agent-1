// The Mac's memory, live in the footer: "● Mac 14.6/16 GB", the dot in
// Activity Monitor's pressure colours. Units are Activity Monitor's (GB =
// 2^30 bytes), so a 16 GB Mac says 16. (A panel beside the welcome box,
// drawn once as the window opened, was taken out on 28 Sep: it went stale.)
import { gib } from '../../../models/index.mjs';

const PRESSURE = { 1: 'fine', 2: 'tight', 4: 'critical' };
export const pressureWord = (m) => PRESSURE[m.level] ?? 'tight';
const gb1 = (b) => gib(b).toFixed(1);
export const used = (m) => Math.max(0, m.total - m.avail);

// The footer's live line: "Mac 14.6/16 GB".
export const footerLabel = (m) => `Mac ${gb1(used(m))}/${Math.round(gib(m.total))} GB`;
