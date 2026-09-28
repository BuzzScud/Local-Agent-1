// Builds the engine by hand (coding setup does the same when it is missing):
//   node models/runtime/engine/build-now.mjs
import { ENGINE, HOME } from '../../registry.mjs';
import { buildEngine } from './build.mjs';

console.log(`built ${await buildEngine({ ...ENGINE, home: HOME, say: (s) => console.log(s) })}`);
