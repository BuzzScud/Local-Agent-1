import { startServer } from './server.mjs';
import { record } from './audit.mjs';

startServer();
record('started');
