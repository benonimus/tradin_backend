const express = require('express');
const axios = require('axios');
// Assuming the Manipulation model is located at the specified path
const Manipulation = require('../models/Manipulation'); 
const router = express.Router();

// Environment variables
const LCW_API_KEY = process.env.LCW_API_KEY;
const LCW_HISTORY_URL = 'https://api.livecoinwatch.com/coins/history';

// Helper to convert interval string (e.g., '1h', '1d') to total milliseconds
const intervalToMs = (interval) => {
  const unit = interval.slice(-1);
  const value = parseInt(interval.slice(0, -1));
  const multipliers = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] || 0);
};

// Fetch klines (candlestick) data from Binance or LiveCoinWatch
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

  // Calculate the time range for fetching both klines and historical manipulations
  const now = Date.now();
  const limitNum = limit ? parseInt(limit, 10) : 100;
  const intervalMs = intervalToMs(interval);
  // Calculate the start time of the first candle we expect to fetch
  const startTimeForKlines = now - limitNum * intervalMs;

  let manipulations = [];
  try {
    // Fetch historical manipulations that overlap with the chart's time range
    manipulations = await Manipulation.find({
      symbol: normalizedSymbol,
      startTime: { $lt: new Date(now) },
      endTime: { $gt: new Date(startTimeForKlines) },
    }).lean();
    // Sort manipulations by startTime for deterministic processing
    manipulations.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    console.log(`[CHARTS] Found ${manipulations.length} historical manipulations for ${normalizedSymbol}.`);
  } catch (err) {
    console.error('[CHARTS] Error fetching historical manipulations:', err?.message || err);
    // Continue without manipulations if the DB query fails
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
      // LCW history API does not reliably support '1w' or longer
    };

    if (LCW_API_KEY && Object.prototype.hasOwnProperty.call(intervalToSeconds, interval)) {
      try {
        const step = intervalToSeconds[interval];
        const end = Math.floor(now / 1000); // Use calculated 'now'
        const start = Math.floor(startTimeForKlines / 1000); // Use calculated chart start time
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
      console.log(`[CHARTS] Falling back to Binance API for ${normalizedSymbol}`);
      try {
        const response = await axios.get(`https://api.binance.com/api/v3/klines`, {
          params: {
            symbol: normalizedSymbol,
            interval: interval,
            limit: limitNum,
            startTime: startTimeForKlines, // Request data starting from calculated time
          },
          timeout: parseInt(process.env.PRICE_FETCH_TIMEOUT_MS || '5000', 10),
        });
        if (response.data && response.data.length > 0) {
          data = response.data;
          console.log(`[CHARTS] Fetched ${data.length} candles from Binance.`);
        } else {
          console.log(`[CHARTS] Binance API returned no data for ${normalizedSymbol}`);
        }
      } catch (err) {
        console.error('[CHARTS] Binance API request failed:', err?.message || err);
      }
    }

    if (!data || data.length === 0) {
      return res.status(503).json({ message: 'Could not fetch chart data from external providers.', data: [] });
    }

    let manipulatedData = data;

    // Apply per-candle historical manipulation if found
    if (manipulations.length > 0) {
      manipulatedData = data.map((kline) => {
        // kline format: [openTime, open, high, low, close, volume, ...]
        const candleTimestamp = Number(kline[0]);
        let candle = {
          time: candleTimestamp, // MS
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5]),
        };

        // Check if this candle is inside any manipulation period
        for (const manip of manipulations) {
          const manipStartTime = new Date(manip.startTime).getTime();
          const manipEndTime = new Date(manip.endTime).getTime();

          // A candle is 'inside' if its open time is within the manipulation duration
          if (
            candleTimestamp >= manipStartTime &&
            candleTimestamp < manipEndTime
          ) {
            const manipDuration = manipEndTime - manipStartTime;
            const timeIntoManip = candleTimestamp - manipStartTime;

            // Calculate progress (clamped between 0 and 1)
            const progress = Math.max(0, Math.min(1, timeIntoManip / (manipDuration || 1)));

            // Interpolate price based on the candle's open price as the starting point
            // This mirrors the logic in your first snippet.
            const startPrice = candle.open;
            const targetPrice = manip.endValue;

            const manipulatedPrice = startPrice + (targetPrice - startPrice) * progress;

            // Adjust OHLC values. Close is the interpolated price. High/Low must encompass it.
            candle.close = manipulatedPrice;
            candle.high = Math.max(candle.high, manipulatedPrice);
            candle.low = Math.min(candle.low, manipulatedPrice);

            // Since manipulations are sorted, we can stop at the last applicable one
            // if we assume non-overlapping or that the last one applied should win.
            // Keeping the loop ensures all overlapping are processed if needed, but often
            // one manip per time interval is expected.
          }
        }

        // Return the modified kline format: [timestamp, open, high, low, close, volume]
        return [
          candle.time.toString(),
          candle.open.toString(),
          candle.high.toString(),
          candle.low.toString(),
          candle.close.toString(),
          candle.volume.toString(),
        ];
      });
      console.log(`[CHARTS] Applied historical manipulation to ${manipulatedData.length} candles.`);
    }

    // Final formatting into the desired object structure
    const formattedData = manipulatedData.map((d) => {
      const timestamp = Number(d[0]); // Ensure it's a number
      const open = parseFloat(d[1]);
      const high = parseFloat(d[2]);
      const low = parseFloat(d[3]);
      const close = parseFloat(d[4]);
      const volume = parseFloat(d[5]) || 0;
      return {
        time: Math.floor(timestamp / 1000), // seconds
        timestamp: new Date(timestamp).toISOString(),
        open,
        high,
        low,
        close,
        volume,
      };
    });

    res.json({ symbol: normalizedSymbol, interval, data: formattedData });
  } catch (error) {
    console.error('Error fetching klines data:', error?.message || error);
    res.status(500).json({ message: 'Internal server error while processing chart data', error: error.message });
  }
});

module.exports = router;