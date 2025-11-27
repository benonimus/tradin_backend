const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../User');
const auth = require('../middleware/auth');

const router = express.Router();

// Rate limiter for auth endpoints to mitigate brute force
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { message: 'Too many requests, please try again later.' } });

// Register
router.post('/register', authLimiter, async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Please provide username, email and password' });
  }
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'Email already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    user = new User({ username, email, password: hashed });
    await user.save();

    const payload = { userId: user.id };
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'devsecret', { expiresIn });

    res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Please provide email and password' });
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    const payload = { userId: user.id, isAdmin: user.isAdmin };
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'devsecret', { expiresIn });

    res.json({ token, user: { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, createdAt: user._id.getTimestamp() } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
