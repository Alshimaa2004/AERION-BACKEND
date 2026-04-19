const User = require('../models/User');
const jwt = require('jsonwebtoken');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_EXPIRE
});

exports.register = async (req, res) => {
  try {
    const { email, password, name, governorate } = req.body;
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: 'البريد موجود بالفعل' });
    }
    const user = await User.create({ name, email, password, governorate: governorate || '' });
    res.json({
      token: generateToken(user._id),
      user: { id: user._id, name, email, governorate: user.governorate, role: user.role }
    });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'بيانات غير صحيحة' });
    }
    res.json({
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email, governorate: user.governorate, role: user.role }
    });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

