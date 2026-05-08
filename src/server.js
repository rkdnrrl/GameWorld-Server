const app = require('./app');
const config = require('./config');
const { disconnect } = require('./db');

const server = app.listen(config.port, () => {
  console.log(`[gameworld] listening on :${config.port} (${config.env})`);
});

async function shutdown(signal) {
  console.log(`[gameworld] received ${signal}, shutting down`);
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
});
