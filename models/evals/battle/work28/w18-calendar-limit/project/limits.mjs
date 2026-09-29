// How often each outside service may be asked.
export const LIMITS = {
  quotes: { perMinute: 120 },
  calendar: { perMinute: 4 }, // the export answers 429 when asked more often than this
  news: { perMinute: 30 },
};
