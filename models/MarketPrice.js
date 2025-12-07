const mongoose = require('mongoose');

const MarketPriceSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  price: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, default: Date.now },

  // Daily OHLC data
  open: { type: Number, default: 0 },
  high: { type: Number, default: 0 },
  low: { type: Number, default: 0 },
  lastDay: { type: String }, // To track the day for OHLC reset, e.g., '2023-10-27'

  // Price manipulation fields
  manipulation: {
    startTime: { type: Date },
    endTime: { type: Date },
    coolDownEndTime: { type: Date }, // End time for the cool-down period
    endValue: { type: Number },
    durationMs: { type: Number }, // Duration of manipulation in milliseconds
    originalPrice: { type: Number }, // Price before manipulation started
    isActive: { type: Boolean, default: false },
    isCoolingDown: { type: Boolean, default: false }, // Flag for post-manipulation cooldown
    adminUserId: { type: String },
    adminUsername: { type: String },
  },
});

module.exports = mongoose.model('MarketPrice', MarketPriceSchema);