export function errorMiddleware(error, _req, res, _next) {
  const status = Number(error.status) || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : error.message,
  });
}
