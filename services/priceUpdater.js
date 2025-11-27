const MarketPrice = require('../MarketPrice');
const axios = require('axios');

let intervalHandle = null;

// Default configuration
const DEFAULT_SYMBOLS = [
  { symbol: 'BTCUSDT', price: 40000 },
  { symbol: 'ETHUSDT', price: 2500 },
  { symbol: 'LTCUSDT', price: 100 },
];

// Fetch real price from Binance API
async function fetchRealPrice(symbol) {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol },
    });
    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error.message);
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

      if (now >= endTime) {
        // Manipulation period ended - revert to real price
        const realPrice = await fetchRealPrice(symbol);
        if (realPrice) {
          // Gradually move towards real price
          const diff = realPrice - doc.price;
          newPrice = doc.price + (diff * 0.1); // 10% towards real price
        } else {
          newPrice = randomChange(doc.price, volatility);
        }

        // Check if we're close enough to real price to end manipulation
        if (realPrice && Math.abs(newPrice - realPrice) < 0.01) {
          doc.manipulation.isActive = false;
          console.log(`Price manipulation ended for ${symbol}`);
        }
      } else if (now >= startTime) {
        // During manipulation period - interpolate price
        const totalDuration = endTime - startTime;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / totalDuration, 1);

        const startPrice = manip.originalPrice;
        const targetPrice = manip.endValue;

        newPrice = startPrice + (targetPrice - startPrice) * progress;
      } else {
        // Before manipulation starts - normal behavior
        newPrice = randomChange(doc.price, volatility);
      }
    } else {
      // No active manipulation - normal random walk
      newPrice = randomChange(doc.price, volatility);
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

function start(options = {}) {
  const { wss } = options;
  const intervalMs = parseInt(process.env.PRICE_UPDATE_INTERVAL_MS || options.intervalMs || '10000', 10);
  const symbols = options.symbols || DEFAULT_SYMBOLS.map((s) => s.symbol);
  const volatility = options.volatility || parseFloat(process.env.PRICE_VOLATILITY || '0.02');

  // seed default symbols if missing
  seedIfEmpty(DEFAULT_SYMBOLS).catch((err) => console.error('Price seeding error', err));

  if (intervalHandle) return; // already running

  intervalHandle = setInterval(() => {
    tick({ symbols, volatility, wss }).catch((err) => console.error('Price tick error', err));
  }, intervalMs);

  console.log(`Price updater started: interval=${intervalMs}ms volatility=${volatility}`);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('Price updater stopped');
  }
}

module.exports = { start, stop, tick };
