// 📄 index.js
const express = require('express');
const { query, param, validationResult } = require('express-validator');

const {
  logger,
  register,
  metrics,
  limiters,
  helmetMiddleware,
  corsMiddleware,
  requestTracker,
  errorHandler
} = require('./src/middleware');

const { getCache, setCache, flushCache, closeCache, getCacheStats } = require('./src/cacheLayer');
const { executeApiCall, isValidId, formatTrack } = require('./src/jiosaavnApi');


const app = express();
const PORT = process.env.PORT || 3000;

// Security and utility middleware
app.set('trust proxy', 1);
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use(requestTracker);

// Compression could be added here if not handled by edge (Render handles gzip)


// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
};

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
  const cacheStats = getCacheStats();
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    api_connected: true, // simplified for now
    decryption_success_rate: null, // metrics could track this more granularly
    cache_size: cacheStats.l1_size,
    l2_cache_available: cacheStats.l2_available,
    memory_percent: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
  });
});

/**
 * Prometheus metrics endpoint
 */
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

/**
 * Flush cache endpoint
 */
app.post('/flush-cache', async (req, res, next) => {
  try {
    await flushCache();
    res.json({ status: 'success', message: 'Cache flushed' });
  } catch (err) {
    next(err);
  }
});

/**
 * Search JioSaavn
 * GET /search?q=<query>&limit=<n>
 */
app.get(
  '/search',
  limiters.search,
  [
    query('q').isString().notEmpty().trim(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt()
  ],
  validate,
  async (req, res, next) => {
    const endTimer = metrics.searchDuration.startTimer();
    try {
      const { q, limit = 10 } = req.query;
      const cacheKey = `search:${q}:${limit}`;

      const cached = await getCache(cacheKey);
      if (cached) {
        metrics.cacheHits.inc();
        endTimer();
        return res.json(cached);
      }

      const params = {
        __call: 'search.getResults',
        q,
        n: limit,
        p: 1,
        _format: 'json',
        _marker: 0,
        api_version: 4,
        ctx: 'web6dot0',
        cat: 'songs'
      };

      const result = await executeApiCall(params);

      let responseData = { data: [], total: 0, query: q };

      if (result && result.results) {
        const tracks = result.results.map(formatTrack);
        responseData = {
          data: tracks,
          total: tracks.length,
          query: q
        };

        // Track success/fallback
        tracks.forEach(t => {
            if (t.stream_url && !t.stream_url.includes('preview')) metrics.extractionSuccess.inc();
            else metrics.previewFallback.inc();
        });
      }

      await setCache(cacheKey, responseData, 300); // 5 minutes TTL
      res.set('Cache-Control', 'public, max-age=300');
      endTimer();
      res.json(responseData);
    } catch (error) {
      endTimer();
      next(error);
    }
  }
);

/**
 * Get track details by ID
 * GET /track/:id
 */
app.get(
  '/track/:id',
  limiters.track,
  [
    param('id').custom(isValidId)
  ],
  validate,
  async (req, res, next) => {
    try {
      const songId = req.params.id;
      const cacheKey = `track:${songId}`;

      const cached = await getCache(cacheKey);
      if (cached) {
        metrics.cacheHits.inc();
        return res.json(cached);
      }

      const params = {
        __call: 'song.getDetails',
        pids: songId,
        _format: 'json',
        _marker: 0,
        api_version: 4,
        ctx: 'web6dot0'
      };

      const result = await executeApiCall(params);

      if (!result || !result.songs || !result.songs[0]) {
        return res.status(404).json({ error: 'Track not found' });
      }

      const track = formatTrack(result.songs[0]);

      if (!track.stream_url) {
        return res.status(404).json({ error: 'No stream URL available', id: songId });
      }

      if (track.stream_url && !track.stream_url.includes('preview')) metrics.extractionSuccess.inc();
      else metrics.previewFallback.inc();

      await setCache(cacheKey, track, 2700); // 45 minutes TTL
      res.set('Cache-Control', 'public, max-age=2700');
      res.json(track);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get album details
 * GET /album/:id
 */
app.get(
  '/album/:id',
  limiters.album,
  [
    param('id').custom(isValidId)
  ],
  validate,
  async (req, res, next) => {
    try {
      const albumId = req.params.id;
      const cacheKey = `album:${albumId}`;

      const cached = await getCache(cacheKey);
      if (cached) {
        metrics.cacheHits.inc();
        return res.json(cached);
      }

      const params = {
        __call: 'content.getAlbumDetails',
        albumid: albumId,
        _format: 'json',
        _marker: 0,
        api_version: 4,
        ctx: 'web6dot0'
      };

      const result = await executeApiCall(params);

      if (!result || !result.songs) {
        return res.status(404).json({ error: 'Album not found' });
      }

      const responseData = {
        id: albumId,
        title: result.title || 'Unknown Album',
        artist: result.primary_artists || 'Unknown Artist',
        tracks: result.songs.map(formatTrack),
        total: result.songs.length
      };

      await setCache(cacheKey, responseData, 2700); // 45 minutes TTL
      res.set('Cache-Control', 'public, max-age=2700');
      res.json(responseData);
    } catch (error) {
      next(error);
    }
  }
);

// Global Error Handler
app.use(errorHandler);


const server = app.listen(PORT, () => {
  logger.info(`🎵 JioSaavn Music Wrapper running on port ${PORT}`);
});

// Graceful Shutdown Hook
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Force shutdown after 15s
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 15000);

  server.close(async () => {
    logger.info('Closed out remaining connections.');
    try {
      await closeCache();
      logger.info('Cache connections closed.');
    } catch (err) {
      logger.error({ err }, 'Error during cache shutdown');
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

