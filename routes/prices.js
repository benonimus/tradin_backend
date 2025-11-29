const express = require('express');
const router = express.Router();
const MarketPrice = require('../MarketPrice');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');

// GET /api/prices - list current market prices
router.get('/', async (req, res) => {
  try {
    const prices = await MarketPrice.find({}).sort({ symbol: 1 });

    // Sanitize prices to prevent UI errors with dates
    const sanitizedPrices = prices.map((p) => {
      const priceObject = p.toObject();
      if (!priceObject.manipulation) {
        priceObject.manipulation = {};
      }
      // Ensure date fields are null instead of undefined
      priceObject.manipulation.startTime = priceObject.manipulation.startTime || null;
      priceObject.manipulation.endTime = priceObject.manipulation.endTime || null;
      return priceObject;
    });

    // Determine whether caller (if authenticated) can manipulate prices
    let canManipulate = false;
    try {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
        canManipulate = !!decoded.isAdmin;
      }
    } catch (e) {
      // ignore invalid/missing tokens
    }

    res.json({ prices: sanitizedPrices, canManipulate });
  } catch (err) {
    console.error('GET /api/prices error', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

// POST /api/prices/manipulate - set price manipulation for a symbol
router.post('/manipulate', auth, async (req, res) => {
  // Only admin/authorized users may set manipulations
  if (!req.isAdmin) return res.status(403).json({ error: 'Forbidden: not authorized to manipulate prices' });

  try {
    const { symbol, startTime, endTime, endValue } = req.body;

    if (!symbol || !startTime || !endTime || endValue === undefined) {
      return res.status(400).json({ error: 'symbol, startTime, endTime, and endValue are required' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    if (end <= start) {
      return res.status(400).json({ error: 'endTime must be after startTime' });
    }

    const doc = await MarketPrice.findOne({ symbol });
    if (!doc) {
      return res.status(404).json({ error: 'Symbol not found' });
    }

    // Set manipulation
    doc.manipulation = {
      startTime: start,
      endTime: end,
      endValue: parseFloat(endValue),
      originalPrice: doc.price,
      isActive: true,
    };

    await doc.save();

    res.json({ message: 'Price manipulation set successfully', manipulation: doc.manipulation });
  } catch (err) {
    console.error('POST /api/prices/manipulate error', err);
    res.status(500).json({ error: 'Failed to set price manipulation' });
  }
});

module.exports = router;
