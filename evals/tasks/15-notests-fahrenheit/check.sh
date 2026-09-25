#!/bin/zsh
node -e "import('./convert.mjs').then(({toFahrenheit:f, toCelsius:c})=>{ if (f(100)!==212 || f(0)!==32 || c(212)!==100) process.exit(1) })" || { echo "conversion still wrong (or toCelsius broke)"; exit 1; }
