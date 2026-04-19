const Alert = require('../models/Alert');

exports.getAlerts = async (req, res) => {
  const alerts = await Alert.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json(alerts);
};

exports.createAlert = async (req, res) => {
  try {
    const alert = new Alert({ ...req.body, userId: req.user._id });
    await alert.save();
    res.status(201).json(alert);
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.deleteAlert = async (req, res) => {
  await Alert.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  res.json({ message: 'تم الحذف' });
};

exports.toggleAlert = async (req, res) => {
  try {
    const alert = await Alert.findOne({ _id: req.params.id, userId: req.user._id });
    if (!alert) return res.status(404).json({ message: 'غير موجود' });
    alert.active = !alert.active;
    await alert.save();
    res.json(alert);
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};
