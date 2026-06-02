require('./sentry');               // ⚠️ 반드시 다른 require 보다 먼저
const Sentry = require('@sentry/node');
const app = require('./app');
const config = require('./config');
const { disconnect } = require('./db');
const { ensureCoreSchema } = require('./db/ensureCoreSchema');

let server;

async function start() {
  try {
    await ensureCoreSchema();
    console.log('[gameworld] core database schema verified');
  } catch (err) {
    console.error('[gameworld] core database schema check failed', err);
  }

  server = app.listen(config.port, () => {
    console.log(`[gameworld] listening on :${config.port} (${config.env})`);
  });
}

async function shutdown(signal) {
  console.log(`[gameworld] received ${signal}, shutting down`);
  if (!server) {
    await disconnect();
    process.exit(0);
  }
  server.close(async () => {
    await disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
  Sentry.captureException(err);
});

start();
