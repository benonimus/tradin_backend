const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
  },
  isAdmin: {
    type: Boolean,
    required: true,
    default: false,
  },
  verification: {
    status: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
      default: 'unverified',
    },
    idPhoto: {
      type: String,
    },
    rejectionReason: {
      type: String,
    },
  },
  twoFactor: {
    enabled: {
      type: Boolean,
      default: false,
    },
    secret: {
      type: String,
    },
  },
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);