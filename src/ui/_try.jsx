import React from 'react';
import { renderToString } from 'ink';
import { readFileSync } from 'node:fs';
import { stateAt } from './state.mjs';
import { DESIGNS } from './designs.jsx';
const session = JSON.parse(readFileSync(new URL('../demo/session.json', import.meta.url)));
const [d, t, cols = 155] = process.argv.slice(2).map(Number);
const { View } = DESIGNS[d - 1];
process.stdout.write(renderToString(<View session={session} s={stateAt(session, t)} width={cols} />, { columns: cols }) + '\n');
