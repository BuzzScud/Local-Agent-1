// Futures trade from 6 PM to 5 PM New York time, Sunday evening to Friday afternoon.
// The hour in between (5 PM to 6 PM New York) is the exchange's daily maintenance break.
export const SESSION = { opens: '18:00', closes: '17:00', zone: 'America/New_York' };

// The bank saves 1-minute bars for these contracts.
export const CONTRACTS = ['NQ', 'ES'];
