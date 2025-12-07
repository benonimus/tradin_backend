const express = require('express');
const router = express.Router();
const multer = require('multer');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Configure multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// @route   POST /api/users/me/submit-verification
// @desc    Submit verification document
// @access  Private
router.post('/me/submit-verification', [auth, upload.single('idPhoto')], async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const user = await User.findById(req.user);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Do not allow re-submission if already verified
    if (user.verification.status === 'verified') {
        return res.status(400).json({ message: 'User is already verified.' });
    }

    // Do not allow re-submission while pending
    if (user.verification.status === 'pending') {
        return res.status(400).json({ message: 'Verification is already pending.' });
    }

    // Convert image buffer to data URI
    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    user.verification.idPhoto = dataUri;
    user.verification.status = 'pending';
    user.verification.rejectionReason = undefined;

    await user.save();
    res.json({ message: 'Verification document submitted successfully. Please wait for admin approval.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
