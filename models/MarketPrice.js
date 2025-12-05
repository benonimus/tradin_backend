const mongoose = require('mongoose');

const MarketPriceSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  price: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, default: Date.now },
  // Price manipulation fields
  manipulation: {
    startTime: { type: Date },
    endTime: { type: Date },
    endValue: { type: Number },
    durationMs: { type: Number }, // Duration of manipulation in milliseconds
    originalPrice: { type: Number }, // Price before manipulation started
    isActive: { type: Boolean, default: false },
    adminUserId: { type: String },
    adminUsername: { type: String },
  },
});

module.exports = mongoose.model('MarketPrice', MarketPriceSchema);