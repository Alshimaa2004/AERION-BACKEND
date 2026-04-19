const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');

router.get('/users', protect, adminOnly, async (req, res) => {
  const users = await User.find().select('-password');
  res.json(users);
});

router.delete('/users/:id', protect, adminOnly, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'تم الحذف' });
});

module.exports = router;
