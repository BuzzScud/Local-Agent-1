// Temperature conversions.
export function toFahrenheit(c) {
  return c * 9 / 5 + 32;
}

export function toCelsius(f) {
  return (f - 32) * 5 / 9;
}
