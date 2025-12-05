const MarketPrice = require('../models/MarketPrice');
const axios = require('axios');
const WebSocket = require('ws');

const orderExecutor = require('./orderExecutor');
let intervalHandle = null;
const wsConnections = new Map();
const latestWsPrices = new Map(); // In-memory cache for the latest prices from WebSocket

// Default configuration
const DEFAULT_SYMBOLS = [
  { symbol: 'BTCUSDT', price: 40000 },
  { symbol: 'ETHUSDT', price: 2500 },
  { symbol: 'LTCUSDT', price: 150 },
];

// Fetch real price from Binance
async function fetchRealPrice(symbol) {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
      timeout: parseInt(process.env.PRICE_FETCH_TIMEOUT_MS || '5000', 10),
    });
    if (response.data && response.data.price) {
      return parseFloat(response.data.price);
    }
    return null;
  } catch (error) {
    console.error(`Error fetching price for ${symbol} from Binance:`, error.message);
    return null;
  }
}

function randomChange(price, volatility) {
  const pct = (Math.random() * 2 - 1) * volatility; // between -volatility..+volatility
  return Math.max(0.00000001, price * (1 + pct));
}

/**
 * Calculates a manipulated price based on an easing curve and simulated volatility.
 * @param {object} config - The manipulation configuration.
 * @param {number} elapsed - Milliseconds since manipulation started.
 * @returns {number} The calculated manipulated price.
 */
function calculateManipulatedPrice(config, elapsed) {
  const { startPrice, endValue, durationMs } = config;
  const progress = Math.min(elapsed / durationMs, 1);

  // Natural ease-in-out quadratic curve for smooth price movement
  const easeProgress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

  const basePrice = startPrice + (endValue - startPrice) * easeProgress;

  // Add realistic market volatility using layered sine waves and random noise
  const volatilityPercent = 0.002; // 0.2% fluctuation
  const wave1 = Math.sin(elapsed / 1000) * basePrice * volatilityPercent;
  const wave2 = Math.sin(elapsed / 500 + 1.5) * basePrice * volatilityPercent * 0.5;
  const randomNoise = (Math.random() - 0.5) * basePrice * volatilityPercent * 0.2;

  return basePrice + wave1 + wave2 + randomNoise;
}

async function seedIfEmpty(symbols) {
  for (const s of symbols) {
    const existing = await MarketPrice.findOne({ symbol: s.symbol });
    if (!existing) {
      await new MarketPrice({ symbol: s.symbol, price: s.price }).save();
    }
  }
}

async function tick(options = {}) {
  const { wss } = options;
  const volatility = parseFloat(process.env.PRICE_VOLATILITY || options.volatility || 0.02);
  const symbols = options.symbols || DEFAULT_SYMBOLS.map((s) => s.symbol);

  const prices = await MarketPrice.find({ symbol: { $in: symbols } });
  const now = new Date();
  const updatedPrices = [];

  // update each symbol
  for (const symbol of symbols) {
    let doc = prices.find((p) => p.symbol === symbol);
    if (!doc) {
      // If missing, create with a reasonable default
      const defaultObj = DEFAULT_SYMBOLS.find((d) => d.symbol === symbol) || { price: 100 };
      doc = new MarketPrice({ symbol, price: defaultObj.price });
    }

    let newPrice;

    // Check if there's an active price manipulation
    if (doc.manipulation && doc.manipulation.isActive) {
      const manip = doc.manipulation;
      const startTime = new Date(manip.startTime);
      const endTime = new Date(manip.endTime);

      if (now >= startTime && now < endTime) {
        // During manipulation period - calculate interpolated and volatile price
        const totalDuration = endTime - startTime;
        const elapsed = now - startTime;

        newPrice = calculateManipulatedPrice(
          {
            startPrice: manip.originalPrice,
            endValue: manip.endValue,
            durationMs: totalDuration,
          },
          elapsed
        );
      } else if (now >= endTime) {
        // Manipulation period has just ended. Revert to a real price.
        console.log(`Price manipulation ended for ${symbol}. Reverting to real price.`);
        doc.manipulation.isActive = false;
        // Fetch the actual market price to restore it
        newPrice = (await fetchRealPrice(symbol)) || doc.price;
      } else {
        // Before manipulation starts - normal behavior
        newPrice = latestWsPrices.get(symbol) || (await fetchRealPrice(symbol)) || randomChange(doc.price, volatility);
      }
    } else {
      // No active manipulation - use the latest real-time price from WebSocket
      newPrice = latestWsPrices.get(symbol) || (await fetchRealPrice(symbol)) || randomChange(doc.price, volatility);
      // Fallback to random change if WebSocket price is not available yet
    }

    doc.price = Number(newPrice.toFixed(8));
    doc.updatedAt = now;
    await doc.save();

    // Notify the order executor of the price change
    await orderExecutor.processPriceUpdate(symbol, doc.price);
    updatedPrices.push(doc);
  }

  // Broadcast the updated prices to all WebSocket clients
  if (wss && wss.clients.size > 0) {
    const message = JSON.stringify(updatedPrices);
    wss.clients.forEach((client) => {
      // readyState 1 means the connection is open
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }
}

async function connectToBinance(symbol) {
  if (wsConnections.has(symbol)) {
    return;
  }
  console.log(`Connecting to Binance WebSocket for ${symbol}`);

  const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`;
  const ws = new WebSocket(wsUrl);
  wsConnections.set(symbol, ws);

  ws.on('message', async (data) => {
    try {
      const trade = JSON.parse(data);
      if (trade && trade.p) {
        const price = parseFloat(trade.p);
        latestWsPrices.set(symbol, price);
      }
    } catch (error) {
      console.error(`Error processing WebSocket message for ${symbol}:`, error);
    }
  });

  ws.on('error', (error) => {
    console.error(`Binance WebSocket error for ${symbol}:`, error.message);
  });

  ws.on('close', () => {
    console.log(`WebSocket for ${symbol} disconnected.`);
    wsConnections.delete(symbol);
    // Optional: implement a reconnect logic if desired
    // setTimeout(() => connectToBinance(symbol), 5000);
  });

  ws.on('open', () => {
    console.log(`WebSocket connection opened for ${symbol}`);
  });
}

function start(options = {}) {
  const { wss } = options;
  const intervalMs = parseInt(process.env.PRICE_UPDATE_INTERVAL_MS || options.intervalMs || '1000', 10);
  const symbols = options.symbols || DEFAULT_SYMBOLS.map((s) => s.symbol);
  const volatility = options.volatility || parseFloat(process.env.PRICE_VOLATILITY || '0.02');

  // seed default symbols if missing
  seedIfEmpty(DEFAULT_SYMBOLS).catch((err) => console.error('Price seeding error', err));

  // Connect to Binance for each symbol
  symbols.forEach((symbol) => {
    if (!wsConnections.has(symbol)) {
      connectToBinance(symbol).catch(err => console.error(`Failed to connect to ${symbol} WS:`, err));
    }
  });

  if (intervalHandle) clearInterval(intervalHandle); // Clear existing interval if any

  intervalHandle = setInterval(() => {
    tick({ symbols, volatility, wss }).catch((err) => console.error('Price tick error', err));
  }, intervalMs);

  console.log(`Price updater started: interval=${intervalMs}ms`);
}

function stop() {
  console.log('Stopping price updater...');
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  // This clears our loop condition in connectToBinance
  wsConnections.clear();
  console.log('Price updater stopped');
}

module.exports = { start, stop, tick };
