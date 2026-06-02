/**
 * Sentry 초기화. @sentry/node v8+ 는 express require 보다 먼저 init 해야
 * auto-instrumentation 이 동작함. server.js 최상단에서 require('./sentry') 로 로드.
 *
 * DSN 미설정 시 no-op.
 */
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV || 'development',
});

module.exports = Sentry;
