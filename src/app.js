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

app.use('/api', routes);

app.get('/', (req, res) => {
  res.json({ name: 'gameworld-platform', status: 'running' });
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use(notFound);

// Sentry Express 에러 핸들러 — 커스텀 errorHandler 직전에 등록 (v8+ 패턴)
Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

module.exports = app;
