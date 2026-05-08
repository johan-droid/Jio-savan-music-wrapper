// 📄 src/decryptor.js
/**
 * Multi-strategy Base64 decryption, quality mapping, and fallback chain.
 */

function decryptBase64(encryptedUrl) {
  try {
    return Buffer.from(encryptedUrl, 'base64').toString('utf-8');
  } catch (err) {
    return null;
  }
}

/**
 * Normalizes quality of the decoded URL (upscales to 320kbps).
 * @param {string} decodedUrl
 */
function normalizeQuality(decodedUrl) {
  if (!decodedUrl) return null;
  let normalized = decodedUrl.replace(/_96\.mp4/g, '_320.mp4');
  normalized = normalized.replace(/_160\.mp4/g, '_320.mp4');
  return normalized;
}

/**
 * Ensures the URL is using HTTPS.
 * @param {string} url
 */
function ensureHttps(url) {
  if (!url) return null;
  if (url.startsWith('http://')) {
    return url.replace('http://', 'https://');
  }
  return url;
}

/**
 * Attempts to decrypt an encrypted URL using multiple strategies.
 * @param {string} encryptedUrl
 * @returns {string|null} The decrypted URL or null if failed.
 */
function decryptUrl(encryptedUrl) {
  if (!encryptedUrl) return null;

  let decoded = decryptBase64(encryptedUrl);
  if (!decoded || !decoded.startsWith('http')) {
    return null;
  }

  decoded = normalizeQuality(decoded);
  decoded = ensureHttps(decoded);

  return decoded;
}

/**
 * Determines the best available stream URL from a song object.
 * Fallback chain: encrypted_media_url -> media_preview_url -> media_url -> vlink.
 * @param {object} song
 * @returns {string|null}
 */
function getBestStreamUrl(song) {
  let streamUrl = null;

  if (song.more_info?.encrypted_media_url) {
    streamUrl = decryptUrl(song.more_info.encrypted_media_url);
  }

  if (!streamUrl) {
    streamUrl = song.media_preview_url ||
                song.more_info?.media_preview_url ||
                song.media_url ||
                song.more_info?.vlink ||
                null;
  }

  return streamUrl ? ensureHttps(streamUrl) : null;
}

module.exports = {
  decryptUrl,
  getBestStreamUrl
};
