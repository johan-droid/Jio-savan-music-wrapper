// 📄 src/jiosaavnApi.js
const axios = require('axios');
const { CircuitBreaker, withRetry } = require('./circuitBreaker');
const { getBestStreamUrl } = require('./decryptor');

const JIOSAAVN_BASE = 'https://www.jiosaavn.com/api.php';

const http = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.jiosaavn.com/'
  }
});

const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000
});

async function executeApiCall(params) {
  return circuitBreaker.execute(() => {
    return withRetry(async () => {
      const response = await http.get(JIOSAAVN_BASE, { params });
      if (response.data && response.data.error) {
        throw new Error(`JioSaavn API Error: ${response.data.error}`);
      }
      return response.data;
    }, 2);
  });
}

/**
 * Validates Track/Album ID format.
 */
function isValidId(id) {
  return /^[a-zA-Z0-9_-]{1,20}$/.test(id);
}

/**
 * Parses duration to seconds.
 */
function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.toString().split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } else if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  }
  return parseInt(durationStr, 10) || 0;
}

/**
 * Formats a track object to match the schema.
 */
function formatTrack(item) {
  let songUrl = item.perma_url || `https://www.jiosaavn.com/song/${item.id}`;
  if (!songUrl.startsWith('http')) {
    songUrl = `https://www.jiosaavn.com${songUrl.startsWith('/') ? '' : '/'}${songUrl}`;
  }

  return {
    id: String(item.id),
    title: item.title || 'Unknown',
    artist: item.primary_artists || item.singers || 'Unknown Artist',
    album: item.album || '',
    duration: parseDuration(item.duration),
    thumbnail: item.image ? item.image.replace('150x150', '500x500') : '',
    url: songUrl,
    stream_url: getBestStreamUrl(item),
    source: 'jiosaavn'
  };
}

module.exports = {
  executeApiCall,
  isValidId,
  formatTrack
};
