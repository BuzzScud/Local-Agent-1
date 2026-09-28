// Builds an engine by hand (coding setup does the same when it is missing):
//   node models/runtime/engine/build-now.mjs [official|prism]
// With no name: the default model's engine.
import { ENGINE, ENGINES, HOME } from '../../registry.mjs';
import { buildEngine } from './build.mjs';

const engine = process.argv[2] ? ENGINES[process.argv[2]] : ENGINE;
if (!engine) throw new Error(`no engine "${process.argv[2]}": ${Object.keys(ENGINES).join(', ')}`);
console.log(`built ${await buildEngine({ ...engine, home: HOME, say: (s) => console.log(s) })}`);
