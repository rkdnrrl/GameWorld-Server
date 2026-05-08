function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const payload = {
    error: {
      message: err.message || 'Internal Server Error',
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    payload.error.stack = err.stack;
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  res.status(status).json(payload);
}

module.exports = errorHandler;
