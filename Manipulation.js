const mongoose = require('mongoose');

const ManipulationSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  endValue: { type: Number, required: true },
  adminUserId: { type: String, required: true },
  adminUsername: { type: String, required: true },
  originalPrice: { type: Number, required: true },
  durationMs: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Manipulation', ManipulationSchema);
