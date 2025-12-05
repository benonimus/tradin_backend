const mongoose = require('mongoose');

const ConditionalOrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    symbol: { type: String, required: true, index: true },
    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    type: {
      type: String,
      enum: ['STOP_LIMIT', 'TRAILING_STOP', 'OCO'],
      required: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'TRIGGERED', 'COMPLETED', 'CANCELED'],
      default: 'ACTIVE',
      index: true,
    },
    // For STOP_LIMIT and OCO (stop part)
    stopPrice: { type: Number },
    // For STOP_LIMIT and OCO (limit part)
    limitPrice: { type: Number },
    // For TRAILING_STOP
    trailingDelta: {
      type: { type: String, enum: ['PERCENTAGE', 'ABSOLUTE'] },
      value: { type: Number },
    },
    // Tracks the peak/trough price for trailing stops
    trailingReferencePrice: { type: Number },
    // For OCO orders
    ocoPair: {
      stopOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConditionalOrder' },
      limitOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConditionalOrder' },
    },
    // To link to the executed trade transaction
    executedTradeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    triggeredAt: { type: Date },
    completedAt: { type: Date },
    canceledAt: { type: Date },
  },
  { timestamps: true }
);

// Compound index for efficient querying by the execution service
ConditionalOrderSchema.index({ status: 1, type: 1 });

module.exports = mongoose.model('ConditionalOrder', ConditionalOrderSchema);