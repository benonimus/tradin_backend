const MarketPrice = require('../models/MarketPrice');
const axios = require('axios');
const WebSocket = require('ws');
const { calculateManipulatedPrice } = require('../utils/priceManipulation');

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
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // Get 'YYYY-MM-DD' for daily OHLC tracking
  const updatedPrices = [];

  // Concurrently fetch all market prices from the database
  const priceDocs = await MarketPrice.find({ symbol: { $in: symbols } });

  // Identify symbols that need a real price fetch (not in WS cache)
  const symbolsToFetch = symbols.filter((symbol) => !latestWsPrices.has(symbol));
  const fetchedPrices = new Map();

  if (symbolsToFetch.length > 0) {
    const pricePromises = symbolsToFetch.map((symbol) =>
      fetchRealPrice(symbol).then((price) => ({ symbol, price }))
    );
    const results = await Promise.all(pricePromises);
    results.forEach((result) => {
      if (result.price !== null) {
        fetchedPrices.set(result.symbol, result.price);
      }
    });
  }

  for (const symbol of symbols) {
    let doc = priceDocs.find((p) => p.symbol === symbol);
    if (!doc) {
      const defaultObj = DEFAULT_SYMBOLS.find((d) => d.symbol === symbol) || { price: 100 };
      doc = new MarketPrice({ symbol, price: defaultObj.price });
    }

    let newPrice;
    const currentMarketPrice =
      latestWsPrices.get(symbol) || fetchedPrices.get(symbol) || randomChange(doc.price, volatility);

    // --- Daily OHLC Reset ---
    if (doc.lastDay !== today) {
      doc.open = currentMarketPrice;
      doc.high = currentMarketPrice;
      doc.low = currentMarketPrice;
      doc.lastDay = today;
    }

    const manip = doc.manipulation;

    if (manip && manip.isActive) {
      const startTime = new Date(manip.startTime);
      const endTime = new Date(manip.endTime);

      if (now >= startTime && now < endTime) {
        // --- During manipulation period ---
        const elapsed = now - startTime;
        newPrice = calculateManipulatedPrice(
          {
            startPrice: manip.originalPrice,
            endValue: manip.endValue,
            durationMs: manip.durationMs,
          },
          elapsed
        );

        // Add realistic market volatility
        const volatilityPercent = 0.002;
        const wave1 = Math.sin(elapsed / 1000) * newPrice * volatilityPercent;
        const wave2 = Math.sin(elapsed / 500 + 1.5) * newPrice * volatilityPercent * 0.5;
        const randomNoise = (Math.random() - 0.5) * newPrice * volatilityPercent * 0.2;
        newPrice += wave1 + wave2 + randomNoise;
      } else if (now >= endTime) {
        // --- Manipulation period has just ended, start cool-down ---
        console.log(`Price manipulation for ${symbol} ended. Starting cool-down.`);
        manip.isActive = false;
        manip.isCoolingDown = true;
        const coolDownDurationMs = manip.durationMs / 2; // Cooldown is half the manip duration
        manip.coolDownEndTime = new Date(endTime.getTime() + coolDownDurationMs);
        newPrice = manip.endValue; // Start cooldown from the manipulation's end value
      } else {
        // Before manipulation starts
        newPrice = currentMarketPrice;
      }
    } else if (manip && manip.isCoolingDown) {
      const coolDownEndTime = new Date(manip.coolDownEndTime);
      const coolDownStartTime = new Date(coolDownEndTime.getTime() - manip.durationMs / 2);

      if (now < coolDownEndTime) {
        // --- During cool-down period ---
        const elapsed = now - coolDownStartTime;
        const duration = coolDownEndTime - coolDownStartTime;

        // Interpolate from manipulation end value to the real market price
        newPrice = calculateManipulatedPrice(
          {
            startPrice: manip.endValue,
            endValue: currentMarketPrice,
            durationMs: duration,
          },
          elapsed
        );
      } else {
        // --- Cool-down has ended ---
        console.log(`Cool-down for ${symbol} ended. Reverting to real price.`);
        manip.isCoolingDown = false;
        // Reset manipulation state
        doc.manipulation = { isActive: false, isCoolingDown: false };
        newPrice = currentMarketPrice;
      }
    } else {
      // --- No active manipulation ---
      newPrice = currentMarketPrice;
    }

    doc.price = Number(newPrice.toFixed(8));
    doc.updatedAt = now;

    // --- Update High and Low ---
    doc.high = Math.max(doc.high || doc.price, doc.price);
    doc.low = Math.min(doc.low || doc.price, doc.price);

    await doc.save();

    // Notify the order executor of the price change
    await orderExecutor.processPriceUpdate(symbol, doc.price);
    updatedPrices.push(doc);
  }

  // Broadcast the updated prices to all WebSocket clients
  if (wss && wss.clients.size > 0) {
    const message = JSON.stringify(updatedPrices);
    wss.clients.forEach((client) => {
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

module.exports = { start, stop, tick, calculateManipulatedPrice };
