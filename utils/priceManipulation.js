/**
 * Calculates a manipulated price based on an easing curve and simulated volatility.
 * This function is shared between the real-time price updater and the historical chart generator
 * to ensure consistency between live prices and chart data.
 * @param {object} config - The manipulation configuration.
 * @param {number} elapsed - Milliseconds since manipulation started.
 * @returns {number} The calculated manipulated price.
 */
function calculateManipulatedPrice(config, elapsed) {
  const { startPrice, endValue, durationMs } = config;
  const progress = Math.min(elapsed / durationMs, 1);

  // Natural ease-in-out quadratic curve for smooth price movement
  const easeProgress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

  return startPrice + (endValue - startPrice) * easeProgress;
}

module.exports = { calculateManipulatedPrice };