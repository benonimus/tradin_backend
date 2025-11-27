const express = require('express');
const User = require('../User');
const auth = require('../middleware/auth');
const Transaction = require('../Transaction');

const router = express.Router();

// Get balance
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ balance: user.balance, currency: 'USD', availableBalance: user.balance, lockedBalance: 0 });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Deposit
router.post('/deposit', auth, async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount (must be > 0)' });
  }
  try {
    const user = await User.findById(req.user);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.balance += amount;
    await user.save();

    const transaction = new Transaction({ user: req.user, type: 'deposit', amount });
    await transaction.save();

    res.status(201).json({ success: true, newBalance: user.balance, transactionId: transaction._id, timestamp: transaction.date });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Withdraw
router.post('/withdraw', auth, async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount (must be > 0)' });
  }
  try {
    const user = await User.findById(req.user);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.balance < amount) {
      return res.status(422).json({ message: 'Insufficient balance' });
    }
    user.balance -= amount;
    await user.save();

    const transaction = new Transaction({ user: req.user, type: 'withdrawal', amount: -amount });
    await transaction.save();

    res.status(201).json({ success: true, newBalance: user.balance, transactionId: transaction._id, timestamp: transaction.date });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
