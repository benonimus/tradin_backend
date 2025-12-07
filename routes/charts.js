const express = require('express');
const axios = require('axios');
// Assuming the Manipulation model is located at the specified path
const Manipulation = require('../models/Manipulation');
const router = express.Router();
const { calculateManipulatedPrice } = require('../utils/priceManipulation');

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

// --- Data Fetching Functions ---

/**
 * Fetches kline data from LiveCoinWatch.
 */
async function fetchFromLCW(symbol, interval, startTime, endTime) {
  const intervalToSeconds = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  if (!LCW_API_KEY || !intervalToSeconds[interval]) {
    return null;
  }

  try {
    const code = symbol.replace(/USDT$|USD$/i, '');
    const body = {
      currency: 'USD',
      code,
      start: Math.floor(startTime / 1000),
      end: Math.floor(endTime / 1000),
      meta: true,
    };

    console.log(`[CHARTS] Attempting to fetch from LiveCoinWatch for ${symbol}`);
    const response = await axios.post(LCW_HISTORY_URL, body, {
      headers: { 'x-api-key': LCW_API_KEY, 'Content-Type': 'application/json' },
      timeout: parseInt(process.env.PRICE_FETCH_TIMEOUT_MS || '5000', 10),
    });

    let payload = response.data?.history || response.data?.data || response.data;
    if (!payload || !Array.isArray(payload) || payload.length === 0) {
      console.log(`[CHARTS] LiveCoinWatch returned no data for ${symbol}.`);
      return [];
    }

    // Normalize LCW response to Binance kline format: [time, open, high, low, close, volume]
    const klines = payload.map((item) => {
      if (Array.isArray(item)) {
        // Array format: [timestamp, open, high, low, close, volume]
        const ts = Number(item[0]) < 1e12 ? Number(item[0]) * 1000 : Number(item[0]);
        return [ts, item[1].toString(), item[2].toString(), item[3].toString(), item[4].toString(), (item[5] || '0').toString()];
      } else if (typeof item === 'object') {
        // Object format
        const tsRaw = item.date || item.time || item.t || item.timestamp;
        let ts = Number(tsRaw || 0);
        if (ts && ts < 1e12) ts *= 1000;
        return [
          ts,
          (item.open || item.o || 0).toString(),
          (item.high || item.h || 0).toString(),
          (item.low || item.l || 0).toString(),
          (item.close || item.c || 0).toString(),
          (item.volume || item.v || 0).toString(),
        ];
      }
      return null;
    }).filter(Boolean);

    console.log(`[CHARTS] Fetched ${klines.length} candles from LiveCoinWatch.`);
    return klines;
  } catch (err) {
    console.error('[CHARTS] LiveCoinWatch request failed:', err?.message || err);
    return null; // Return null on failure to trigger fallback
  }
}

/**
 * Fetches kline data from Binance.
 */
async function fetchFromBinance(symbol, interval, limit, startTime) {
  try {
    console.log(`[CHARTS] Fetching from Binance API for ${symbol}`);
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit, startTime },
      timeout: parseInt(process.env.PRICE_FETCH_TIMEOUT_MS || '5000', 10),
    });

    if (response.data && response.data.length > 0) {
      console.log(`[CHARTS] Fetched ${response.data.length} candles from Binance.`);
      return response.data;
    } else {
      console.log(`[CHARTS] Binance API returned no data for ${symbol}`);
      return [];
    }
  } catch (err) {
    console.error('[CHARTS] Binance API request failed:', err?.message || err);
    return null; // Return null on failure
  }
}

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
    // Strategy: Try LCW first, if it fails (returns null) or is not configured, fall back to Binance.
    let data = await fetchFromLCW(normalizedSymbol, interval, startTimeForKlines, now);

    if (data === null) {
      // A null response indicates a failure, so we fall back. An empty array is a valid response.
      data = await fetchFromBinance(normalizedSymbol, interval, limitNum, startTimeForKlines);
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
            // Use the same logic as the real-time price updater for consistency.
            const manipulatedPrice = calculateManipulatedPrice(
              {
                startPrice: manip.originalPrice,
                endValue: manip.endValue,
                durationMs: manipDuration,
              },
              timeIntoManip
            );

            // Adjust OHLC values. Close is the interpolated price. High/Low must encompass it.
            // The open price of the candle remains the real market open.
            candle.close = manipulatedPrice;
            candle.high = Math.max(candle.high, candle.open, manipulatedPrice);
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