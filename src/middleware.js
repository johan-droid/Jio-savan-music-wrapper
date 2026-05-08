// 📄 src/middleware.js
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const promClient = require('prom-client');
const helmet = require('helmet');
const cors = require('cors');

// Logging setup
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Metrics setup
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const metrics = {
  searchDuration: new promClient.Histogram({
    name: 'js_search_duration_seconds',
    help: 'Duration of search requests in seconds',
    buckets: [0.1, 0.5, 1, 2, 5],
    registers: [register],
  }),
  extractionSuccess: new promClient.Counter({
    name: 'js_extraction_success_total',
    help: 'Total successful track extractions',
    registers: [register],
  }),
  previewFallback: new promClient.Counter({
    name: 'js_preview_fallback_total',
    help: 'Total fallbacks to preview URLs',
    registers: [register],
  }),
  cacheHits: new promClient.Counter({
    name: 'js_cache_hits_total',
    help: 'Total cache hits',
    registers: [register],
  }),
  activeRequests: new promClient.Gauge({
    name: 'active_requests',
    help: 'Number of active requests',
    registers: [register],
  })
};

// Rate Limiters
const createLimiter = (max, windowMs = 60000) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(windowMs / 1000)
    });
  }
});

const limiters = {
  search: createLimiter(60),
  track: createLimiter(40),
  album: createLimiter(20),
};

// Request tracking middleware
const requestTracker = (req, res, next) => {
  metrics.activeRequests.inc();
  const start = Date.now();
  res.on('finish', () => {
    metrics.activeRequests.dec();
    const duration = Date.now() - start;
    logger.info({
      reqId: req.headers['x-request-id'] || Math.random().toString(36).substring(7),
      method: req.method,
      endpoint: req.originalUrl,
      status: res.statusCode,
      duration
    });
  });
  next();
};

// Error mapper
const errorHandler = (err, req, res, next) => {
  logger.error({ err, endpoint: req.originalUrl }, '[ERROR HANDLER]');

  if (err.code === 'CIRCUIT_OPEN') {
    res.setHeader('Retry-After', err.retryAfter || 30);
    return res.status(503).json({
      error: 'Service Unavailable',
      code: 'CIRCUIT_OPEN',
      message: 'Upstream API is temporarily unavailable.',
      retryable: true
    });
  }

  const status = err.response?.status || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  res.status(status).json({
    error: status === 404 ? 'Not Found' : 'Error',
    code: err.code || 'INTERNAL_ERROR',
    message,
    retryable: status >= 500 && status !== 501,
    details: err.details || null
  });
};

module.exports = {
  logger,
  register,
  metrics,
  limiters,
  helmetMiddleware: helmet(),
  corsMiddleware: cors({ origin: process.env.CORS_ORIGIN || '*' }), // Strict CORS would replace '*' with specific domains
  requestTracker,
  errorHandler
};
