const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// @route   GET /api/admin/users/pending-verification
// @desc    Get users pending verification
// @access  Private (Admin)
router.get('/users/pending-verification', [auth, admin], async (req, res) => {
  try {
    const users = await User.find({ 'verification.status': 'pending' }).select('-password');
    res.json(users);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT /api/admin/users/:userId/verify
// @desc    Verify or reject a user
// @access  Private (Admin)
router.put('/users/:userId/verify', [auth, admin], async (req, res) => {
  const { status, rejectionReason } = req.body;

  if (!['verified', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status.' });
  }

  if (status === 'rejected' && !rejectionReason) {
    return res.status(400).json({ message: 'Rejection reason is required.' });
  }

  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.verification.status = status;
    if (status === 'rejected') {
      user.verification.rejectionReason = rejectionReason;
    } else {
      user.verification.rejectionReason = undefined;
    }

    await user.save();
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
