const Report = require('../models/Report');

exports.getReports = async (req, res) => {
  const reports = await Report.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json(reports);
};

exports.createReport = async (req, res) => {
  try {
    const report = new Report({ ...req.body, userId: req.user._id });
    await report.save();
    res.status(201).json(report);
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.deleteReport = async (req, res) => {
  await Report.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  res.json({ message: 'تم الحذف' });
};
