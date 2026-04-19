const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly, superAdminOnly, adminForGovernorate } = require('../middleware/admin');
const User = require('../models/User');
const Report = require('../models/Report');

// ==================== جميع المستخدمين ====================
router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ 
      success: true, 
      count: users.length,
      data: users 
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب المستخدمين' });
  }
});

// ==================== مستخدم محدد ====================
router.get('/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب المستخدم' });
  }
});

// ==================== حذف مستخدم ====================
router.delete('/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // منع حذف المشرفين الآخرين (للأمان)
    if (user.role === 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ 
        message: 'لا يمكنك حذف مشرف آخر' 
      });
    }

    await user.deleteOne();
    
    res.json({ 
      success: true, 
      message: 'تم حذف المستخدم بنجاح' 
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف المستخدم' });
  }
});

// ==================== تعديل دور المستخدم ====================
router.patch('/users/:id/role', protect, superAdminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['user', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({ message: 'دور غير صالح' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id, 
      { role }, 
      { new: true }
    ).select('-password');

    res.json({ 
      success: true, 
      message: 'تم تحديث دور المستخدم',
      data: user 
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحديث الدور' });
  }
});

// ==================== إحصائيات النظام ====================
router.get('/stats', protect, adminOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const totalReports = await Report.countDocuments();
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name email createdAt');

    res.json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalReports,
        recentUsers
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب الإحصائيات' });
  }
});

// ==================== تقارير جميع المستخدمين ====================
router.get('/reports', protect, adminOnly, async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });
    
    res.json({ 
      success: true, 
      count: reports.length,
      data: reports 
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب التقارير' });
  }
});

// ==================== تعيين مشرف لمحافظة (ميزة إضافية) ====================
router.patch('/users/:id/governorates', protect, superAdminOnly, async (req, res) => {
  try {
    const { governorates } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { managedGovernorates: governorates },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'تم تحديث المحافظات المسؤول عنها',
      data: user
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحديث المحافظات' });
  }
});

module.exports = router;
