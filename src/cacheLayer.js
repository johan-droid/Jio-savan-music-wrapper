// 📄 src/cacheLayer.js
/**
 * L1 (lru-cache) and optional L2 (Redis) caching.
 */

const { LRUCache } = require('lru-cache');
const Redis = require('ioredis');

// L1 Cache
const l1Cache = new LRUCache({
  max: 1500,
  ttl: 1000 * 60 * 5, // Default TTL: 5 minutes
  updateAgeOnGet: false,
  updateAgeOnHas: false,
});

// L2 Cache (Redis)
let redisClient = null;
let redisAvailable = false;

if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) {
        return null; // Stop retrying after 3 attempts
      }
      return Math.min(times * 50, 2000);
    }
  });

  redisClient.on('connect', () => {
    redisAvailable = true;
    console.log('[CACHE] Connected to Redis (L2 enabled)');
  });

  redisClient.on('error', (err) => {
    redisAvailable = false;
    console.warn('[CACHE] Redis connection error, falling back to L1 only', err.message);
  });
}

/**
 * Gets a value from cache (L1 first, then L2).
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getCache(key) {
  // Check L1
  const l1Value = l1Cache.get(key);
  if (l1Value) {
    return l1Value;
  }

  // Check L2
  if (redisAvailable && redisClient) {
    try {
      const l2Value = await redisClient.get(key);
      if (l2Value) {
        const parsed = JSON.parse(l2Value);
        // Backfill L1, but we need the original TTL. For simplicity, use default L1 TTL.
        l1Cache.set(key, parsed);
        return parsed;
      }
    } catch (err) {
      console.warn(`[CACHE] Failed to get key ${key} from Redis:`, err.message);
    }
  }

  return null;
}

/**
 * Sets a value in cache (L1 and L2).
 * @param {string} key
 * @param {any} value
 * @param {number} ttlInSeconds
 * @returns {Promise<void>}
 */
async function setCache(key, value, ttlInSeconds = 300) {
  // Set L1
  l1Cache.set(key, value, { ttl: ttlInSeconds * 1000 });

  // Set L2
  if (redisAvailable && redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(value), 'EX', ttlInSeconds);
    } catch (err) {
      console.warn(`[CACHE] Failed to set key ${key} in Redis:`, err.message);
    }
  }
}

/**
 * Flushes all cache.
 */
async function flushCache() {
  l1Cache.clear();
  if (redisAvailable && redisClient) {
    try {
      await redisClient.flushall();
    } catch (err) {
      console.warn('[CACHE] Failed to flush Redis:', err.message);
    }
  }
}

/**
 * Graceful shutdown for cache layer.
 */
async function closeCache() {
  if (redisClient) {
    await redisClient.quit();
  }
}

/**
 * Returns cache statistics for health endpoints.
 */
function getCacheStats() {
  return {
    l1_size: l1Cache.size,
    l2_available: redisAvailable
  };
}

module.exports = {
  getCache,
  setCache,
  flushCache,
  closeCache,
  getCacheStats
};
