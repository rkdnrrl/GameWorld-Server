import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ensureCoreSchema } = require('../src/db/ensureCoreSchema');
const { disconnect } = require('../src/db');

try {
  await ensureCoreSchema();
  console.log('Core database schema is ready.');
} catch (err) {
  console.error('Core database schema check failed.');
  console.error(err);
  process.exitCode = 1;
} finally {
  await disconnect();
}
