const Sentry = require('@sentry/node');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const { createRateLimit } = require('./middleware/rateLimit');
const { prisma } = require('./db');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
const corsOriginOption =
  config.corsOrigin.length === 1 && config.corsOrigin[0] === '*'
    ? (_origin, cb) => cb(null, true)
    : config.corsOrigin;
app.use(cors({ origin: corsOriginOption, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// 레이트리밋(IP별) — 오픈 알파 공개 트래픽 폭주/악용 방어. 단일 인스턴스 인메모리.
// 업로드는 R2+DB 비용이 커서 타이트하게. 일반 API 는 정상 유저 오탐 없게 넉넉히(폭주만 차단).
// 모니터링 핑은 /api 밖의 /health 로 쏘면 한도와 무관.
app.use('/api/assets/upload', createRateLimit({ windowMs: 60_000, max: 30, message: '업로드가 너무 잦습니다. 잠시 후 다시 시도하세요.' }));
app.use('/api', createRateLimit({ windowMs: 60_000, max: 1000 }));

app.use('/api', routes);

app.get('/', (req, res) => {
  res.json({ name: 'gameworld-platform', status: 'running' });
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
// 준비 상태(readiness) — DB 까지 닿는지 확인. 외부 업타임 모니터가 이걸 핑하면
// "프로세스만 살아있고 DB는 죽은" 상태(오늘 같은 장애)도 감지된다. 레이트리밋 밖(/api 아님)이라 자유 핑 가능.
app.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'db_unreachable', error: err.message });
  }
});

app.use(notFound);

// Sentry Express 에러 핸들러 — 커스텀 errorHandler 직전에 등록 (v8+ 패턴)
Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

module.exports = app;
