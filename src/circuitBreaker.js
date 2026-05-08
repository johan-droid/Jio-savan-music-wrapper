// 📄 src/circuitBreaker.js
/**
 * Async Circuit Breaker targeting JioSaavn API calls with configurable thresholds and jittered recovery.
 */

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.nextAttempt = Date.now();
  }

  async execute(action) {
    if (this.state === STATES.OPEN) {
      if (Date.now() > this.nextAttempt) {
        this.state = STATES.HALF_OPEN;
      } else {
        const error = new Error('Circuit Breaker is OPEN');
        error.code = 'CIRCUIT_OPEN';
        error.retryAfter = Math.ceil((this.nextAttempt - Date.now()) / 1000);
        throw error;
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = STATES.CLOSED;
  }

  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = STATES.OPEN;
      // Add jitter to reset timeout: 0 to 20% of reset timeout
      const jitter = Math.random() * 0.2 * this.resetTimeout;
      this.nextAttempt = Date.now() + this.resetTimeout + jitter;
    }
  }

  isOpen() {
    return this.state === STATES.OPEN && Date.now() <= this.nextAttempt;
  }
}

/**
 * Intelligent retry engine with exponential backoff and jitter.
 * @param {Function} action - Async function to execute.
 * @param {number} maxRetries - Maximum number of retries.
 * @returns {Promise<any>}
 */
async function withRetry(action, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await action();
    } catch (error) {
      // Auto-skip retry on 404 or specific 500s if desired
      if (error.response && (error.response.status === 404 || error.response.status === 400)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      const backoff = Math.pow(2, attempt) * 150 + Math.random() * 30; // 2^attempt * 150ms + 30ms jitter
      await new Promise(resolve => setTimeout(resolve, backoff));
      attempt++;
    }
  }
}

module.exports = {
  CircuitBreaker,
  withRetry,
  STATES
};
