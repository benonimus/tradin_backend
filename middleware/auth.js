const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Support multiple token payload shapes
    req.user = decoded.userId || decoded.id || (decoded.user && (decoded.user.id || decoded.user._id)) || decoded.user;
    // expose admin flag to routes
    req.isAdmin = !!decoded.isAdmin;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = auth;
