const admin = (req, res, next) => {
  if (!req.isAdmin) {
    return res.status(403).json({ message: 'Access denied. Not an admin.' });
  }
  next();
};

module.exports = admin;
