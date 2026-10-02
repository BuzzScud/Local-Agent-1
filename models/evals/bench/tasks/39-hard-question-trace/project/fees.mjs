import { config } from './config.mjs';

// The fee rate in basis points: the FEE_BPS setting, else the config, else 25.
export function feeRate() {
  const env = process.env.FEE_BPS;
  if (env !== undefined && env !== '') return Number(env);
  return config.feeBps ?? 25;
}

export function applyFee(amount) {
  return amount + Math.round(amount * feeRate()) / 10_000;
}
