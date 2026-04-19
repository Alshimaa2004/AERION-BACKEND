const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // ==================== المعلومات الأساسية ====================
  name: { 
    type: String, 
    required: [true, 'الاسم مطلوب'],
    trim: true,
    minlength: [3, 'الاسم يجب أن يكون 3 أحرف على الأقل'],
    maxlength: [50, 'الاسم طويل جداً']
  },
  
  email: { 
    type: String, 
    required: [true, 'البريد الإلكتروني مطلوب'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'البريد الإلكتروني غير صالح']
  },
  
  password: { 
    type: String, 
    required: [true, 'كلمة المرور مطلوبة'],
    minlength: [6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'],
    select: false // عدم إرجاع كلمة المرور في الاستعلامات العادية
  },
  
  phone: {
    type: String,
    match: [/^01[0125][0-9]{8}$/, 'رقم الهاتف غير صالح'],
    default: ''
  },
  
  // ==================== الموقع ====================
  governorate: { 
    type: String, 
    default: '',
    enum: {
      values: ['', 'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الفيوم', 'أسيوط', 
               'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'سوهاج', 'بني سويف',
               'المنيا', 'الشرقية', 'الغربية', 'كفر الشيخ', 'دمياط', 'الإسماعيلية',
               'بورسعيد', 'السويس', 'شمال سيناء', 'جنوب سيناء', 'مطروح', 'الوادي الجديد'],
      message: 'المحافظة غير صالحة'
    }
  },
  
  city: {
    type: String,
    default: ''
  },
  
  address: {
    type: String,
    default: ''
  },
  
  // ==================== الصلاحيات ====================
  role: { 
    type: String, 
    enum: {
      values: ['user', 'admin', 'super_admin'],
      message: 'الدور غير صالح'
    },
    default: 'user' 
  },
  
  // المحافظات التي يديرها المشرف
  managedGovernorates: [{ 
    type: String,
    enum: ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الفيوم', 'أسيوط', 
           'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'سوهاج', 'بني سويف',
           'المنيا', 'الشرقية', 'الغربية', 'كفر الشيخ', 'دمياط', 'الإسماعيلية',
           'بورسعيد', 'السويس', 'شمال سيناء', 'جنوب سيناء', 'مطروح', 'الوادي الجديد']
  }],
  
  // صلاحيات إضافية للمشرفين
  permissions: {
    canManageUsers: { type: Boolean, default: false },
    canManageAdmins: { type: Boolean, default: false },
    canManageReports: { type: Boolean, default: false },
    canManageAlerts: { type: Boolean, default: false },
    canViewStats: { type: Boolean, default: true },
    canExportData: { type: Boolean, default: false }
  },
  
  // ==================== المحطات المفضلة ====================
  favoriteStations: [{ 
    type: String,
    trim: true
  }],
  
  // ==================== الإشعارات ====================
  notifications: { 
    type: Boolean, 
    default: true 
  },
  
  fcmToken: { 
    type: String, 
    default: null,
    select: false
  },
  
  notificationPreferences: {
    aqiAlerts: { type: Boolean, default: true },
    dailyTips: { type: Boolean, default: true },
    complaintUpdates: { type: Boolean, default: true },
    emailNotifications: { type: Boolean, default: false },
    alertThreshold: { type: Number, default: 150, min: 0, max: 500 }
  },
  
  // ==================== الإعدادات ====================
  language: {
    type: String,
    enum: ['ar', 'en'],
    default: 'ar'
  },
  
  theme: {
    type: String,
    enum: ['light', 'dark', 'system'],
    default: 'system'
  },
  
  // ==================== النشاط ====================
  lastLogin: {
    type: Date,
    default: null
  },
  
  lastActive: {
    type: Date,
    default: Date.now
  },
  
  lastAdminActivity: {
    type: Date,
    default: null
  },
  
  loginCount: {
    type: Number,
    default: 0
  },
  
  // ==================== حالة الحساب ====================
  isActive: {
    type: Boolean,
    default: true
  },
  
  isVerified: {
    type: Boolean,
    default: false
  },
  
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  
  passwordResetToken: String,
  passwordResetExpires: Date,
  
  // ==================== الأجهزة المسجلة ====================
  devices: [{
    deviceId: String,
    deviceType: { type: String, enum: ['mobile', 'tablet', 'web'] },
    platform: String,
    lastUsed: Date,
    isActive: { type: Boolean, default: true }
  }],
  
  // ==================== التوقيت ====================
  createdAt: { 
    type: Date, 
    default: Date.now,
    immutable: true
  },
  
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true, // بيضيف updatedAt و createdAt تلقائياً
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ==================== Virtual Fields ====================

// عدد الإشعارات غير المقروءة (هتربط مع Notification Service)
userSchema.virtual('unreadNotificationsCount', {
  ref: 'Notification',
  localField: '_id',
  foreignField: 'userId',
  count: true,
  match: { read: false }
});

// ==================== Indexes ====================
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ governorate: 1 });
userSchema.index({ 'devices.deviceId': 1 });

// ==================== Middleware ====================

// تشفير كلمة المرور قبل الحفظ
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12); // زيادة مستوى التشفير
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// تحديث updatedAt قبل الحفظ
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// ==================== Methods ====================

// مقارنة كلمة المرور
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('خطأ في مقارنة كلمة المرور');
  }
};

// التحقق من صلاحية المشرف
userSchema.methods.isAdmin = function() {
  return this.role === 'admin' || this.role === 'super_admin';
};

// التحقق من صلاحية السوبر أدمن
userSchema.methods.isSuperAdmin = function() {
  return this.role === 'super_admin';
};

// إضافة محطة للمفضلة
userSchema.methods.addFavoriteStation = function(stationName) {
  if (!this.favoriteStations.includes(stationName)) {
    this.favoriteStations.push(stationName);
    return true;
  }
  return false;
};

// إزالة محطة من المفضلة
userSchema.methods.removeFavoriteStation = function(stationName) {
  const index = this.favoriteStations.indexOf(stationName);
  if (index > -1) {
    this.favoriteStations.splice(index, 1);
    return true;
  }
  return false;
};

// تسجيل دخول جديد
userSchema.methods.recordLogin = function() {
  this.lastLogin = Date.now();
  this.loginCount += 1;
  this.lastActive = Date.now();
};

// تحديث آخر نشاط
userSchema.methods.updateActivity = function() {
  this.lastActive = Date.now();
};

// إضافة جهاز جديد
userSchema.methods.addDevice = function(deviceInfo) {
  const existingDevice = this.devices.find(d => d.deviceId === deviceInfo.deviceId);
  
  if (existingDevice) {
    existingDevice.lastUsed = Date.now();
    existingDevice.isActive = true;
  } else {
    this.devices.push({
      ...deviceInfo,
      lastUsed: Date.now(),
      isActive: true
    });
  }
  
  // الاحتفاظ بآخر 5 أجهزة فقط
  if (this.devices.length > 5) {
    this.devices = this.devices.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 5);
  }
};

// ==================== Statics ====================

// البحث عن المستخدمين النشطين
userSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

// البحث عن المستخدمين حسب المحافظة
userSchema.statics.findByGovernorate = function(governorate) {
  return this.find({ governorate, isActive: true });
};

// البحث عن المشرفين
userSchema.statics.findAdmins = function() {
  return this.find({ role: { $in: ['admin', 'super_admin'] } });
};

// إحصائيات المستخدمين
userSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: ['$isActive', 1, 0] } },
        admins: { $sum: { $cond: [{ $in: ['$role', ['admin', 'super_admin']] }, 1, 0] } },
        verified: { $sum: { $cond: ['$isVerified', 1, 0] } }
      }
    },
    {
      $project: {
        _id: 0,
        total: 1,
        active: 1,
        admins: 1,
        verified: 1
      }
    }
  ]);
  
  return stats[0] || { total: 0, active: 0, admins: 0, verified: 0 };
};

// ==================== Hooks ====================

// بعد الحذف، حذف البيانات المرتبطة (اختياري)
userSchema.post('findOneAndDelete', async function(doc) {
  if (doc) {
    // حذف التنبيهات المرتبطة بالمستخدم
    await mongoose.model('Alert').deleteMany({ userId: doc._id });
    
    // حذف التقارير المرتبطة
    await mongoose.model('Report').deleteMany({ userId: doc._id });
    
    // حذف الشكاوى المرتبطة
    await mongoose.model('Complaint').deleteMany({ userId: doc._id });
    
    // حذف الإشعارات
    await mongoose.model('Notification').deleteMany({ userId: doc._id });
  }
});

// ==================== Export ====================
module.exports = mongoose.model('User', userSchema);
