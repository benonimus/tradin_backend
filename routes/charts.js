const express = require('express');
const axios = require('axios');
const MarketPrice = require('../MarketPrice');
const router = express.Router();

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
      console.log(`[CHARTS] Falling back to Binance via ccxt for ${normalizedSymbol}`);
      // Fetch OHLCV data from Binance using ccxt
      // ccxt returns data in the format: [timestamp, open, high, low, close, volume]
      // which is the same as the old Binance API response, so no further mapping is needed.
      const limitNum = limit ? parseInt(limit, 10) : undefined; // ccxt uses default if undefined
      const ohlcv = await binance.fetchOHLCV(normalizedSymbol, interval, undefined, limitNum);
      if (ohlcv && ohlcv.length > 0) {
        data = ohlcv;
        console.log(`[CHARTS] Fetched ${data.length} candles from Binance.`);
      }
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

          // Calculate scale ratio based on last close
          const ratio = originalLastClose > 0 ? currentManipulatedPrice / originalLastClose : 1;

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

          console.log(`[CHARTS] Scaled ${data.length} candles for ${normalizedSymbol} based on active manipulation.`);
        }
      }
    }

    if (!manipulatedData || manipulatedData.length === 0) {
      return res.json({ symbol, interval, data: [] });
    }

    // Format the data for the frontend
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
