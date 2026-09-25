#!/bin/zsh
node -e "import('./shapes.mjs').then(({perimeter:p, area:a})=>{ if (p(2,3)!==10 || p(0,4)!==8 || a(2,3)!==6) process.exit(1) })" || { echo "perimeter wrong or area broke"; exit 1; }
