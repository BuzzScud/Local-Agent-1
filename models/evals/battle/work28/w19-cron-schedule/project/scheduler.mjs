import { readFileSync } from 'node:fs';

// Reads schedule.json and starts each job at its cron time (minute hour day month weekday),
// in the schedule's time zone. Weekdays: 0 = Sunday ... 6 = Saturday.
export function loadSchedule(path = 'schedule.json') {
  const s = JSON.parse(readFileSync(path, 'utf8'));
  return s.jobs.map((j) => ({ ...j, zone: s.timezone, fields: j.cron.split(/\s+/) }));
}
