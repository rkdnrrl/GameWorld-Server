const { WebSocketServer } = require('ws');
const app = require('./app');
const config = require('./config');
const { disconnect } = require('./db');
const { createGameServer } = require('./ws/gameServer');

const server = app.listen(config.port, () => {
  console.log(`[gameworld] listening on :${config.port} (${config.env})`);
});

// WebSocket 게임 서버 연결
const wss = new WebSocketServer({ server, path: '/ws/game' });
createGameServer(wss);
console.log('[gameworld] WebSocket game server attached at /ws/game');

async function shutdown(signal) {
  console.log(`[gameworld] received ${signal}, shutting down`);
  wss.close();
  server.close(async () => {
    await disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
