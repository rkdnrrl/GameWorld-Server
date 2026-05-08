function notFound(req, res, next) {
  res.status(404).json({
    error: {
      message: `Not Found: ${req.method} ${req.originalUrl}`,
    },
  });
}

module.exports = notFound;
