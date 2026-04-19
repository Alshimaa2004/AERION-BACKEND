const User = require('../models/User');

exports.getProfile = (req, res) => res.json({ user: req.user });

exports.updateProfile = async (req, res) => {
  try {
    const { name, governorate, notifications } = req.body;
    const user = await User.findById(req.user._id);
    if (name) user.name = name;
    if (governorate !== undefined) user.governorate = governorate;
    if (notifications !== undefined) user.notifications = notifications;
    await user.save();
    res.json({ user });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.addFavorite = async (req, res) => {
  try {
    const { station } = req.body;
    const user = await User.findById(req.user._id);
    if (!user.favoriteStations.includes(station)) {
      user.favoriteStations.push(station);
      await user.save();
    }
    res.json({ favoriteStations: user.favoriteStations });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.removeFavorite = async (req, res) => {
  try {
    const { station } = req.params;
    const user = await User.findById(req.user._id);
    user.favoriteStations = user.favoriteStations.filter(s => s !== station);
    await user.save();
    res.json({ favoriteStations: user.favoriteStations });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};
