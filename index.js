const express = require('express');
const db = require('./src/db');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const cron = require('node-cron');
const multer = require('multer');
const axios = require('axios');
const { execSync } = require('child_process');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;
const JWT_SECRET = process.env.JWT_SECRET || 'air_quality_secret_2026';

// Fix: Don't crash on Vercel if uploads dir can't be created
const uploadDir = path.join('/tmp', 'uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (e) {
  console.log('uploads dir not created (serverless env):', e.message);
}

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/air-quality';

let isConnected = false;

const connectDB = require('./src/db');

connectDB();

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, select: false },
  phone: { type: String, default: '' },
  governorate: { type: String, default: '' },
  city: { type: String, default: '' },
  address: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin', 'super_admin'], default: 'user' },
  managedGovernorates: [{ type: String }],
  favoriteStations: [{ type: String }],
  notifications: { type: Boolean, default: true },
  fcmToken: { type: String, default: null, select: false },
  currentLocation: {
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    address: { type: String, default: null },
    city: { type: String, default: null },
    country: { type: String, default: 'Egypt' },
    accuracy: { type: Number, default: null },
    updatedAt: { type: Date, default: null }
  },
  locationHistory: [{
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String },
    timestamp: { type: Date, default: Date.now },
    accuracy: { type: Number }
  }],
  locationSettings: {
    shareLocation: { type: Boolean, default: true },
    shareWithFriends: { type: Boolean, default: true },
    saveHistory: { type: Boolean, default: true },
    historyRetentionDays: { type: Number, default: 30 }
  },
  notificationPreferences: {
    aqiAlerts: { type: Boolean, default: true },
    dailyTips: { type: Boolean, default: true },
    complaintUpdates: { type: Boolean, default: true },
    alertThreshold: { type: Number, default: 150 }
  },
  lastLogin: { type: Date, default: null },
  lastActive: { type: Date, default: Date.now },
  loginCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  lastRatingRequest: { type: Date, default: null },
  ratingRequestsCount: { type: Number, default: 0 },
  hasRated: { type: Boolean, default: false },
  userRating: { type: Number, default: null },
  ratingFeedback: { type: String, default: null }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.methods.isAdmin = function() {
  return this.role === 'admin' || this.role === 'super_admin';
};

const User = mongoose.model('User', userSchema);

const alertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  station: { type: String, required: true },
  threshold: { type: Number, required: true, min: 0, max: 500 },
  condition: { type: String, enum: ['above', 'below'], default: 'above' },
  active: { type: Boolean, default: true },
  lastTriggered: { type: Date, default: null },
  triggerCount: { type: Number, default: 0 }
}, { timestamps: true });

const Alert = mongoose.model('Alert', alertSchema);

const reportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  station: String,
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  summary: Object,
  fileUrl: String,
  format: { type: String, enum: ['json', 'pdf', 'excel'], default: 'json' }
}, { timestamps: true });

const Report = mongoose.model('Report', reportSchema);

const complaintSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  type: {
    type: String,
    enum: ['انبعاثات مصنع', 'دخان كثيف', 'حرق قمامة', 'عوادم مركبات', 'رائحة كريهة', 'تراكم مخلفات', 'أخرى'],
    required: true
  },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String }
  },
  address: { type: String, required: true },
  images: [{ type: String }],
  status: { type: String, enum: ['pending', 'in_progress', 'resolved', 'rejected'], default: 'pending' },
  adminNotes: String,
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const Complaint = mongoose.model('Complaint', complaintSchema);

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, enum: ['alert', 'daily_tip', 'complaint_update', 'welcome', 'system', 'recommendation', 'location_share'], required: true },
  data: Object,
  read: { type: Boolean, default: false },
  readAt: Date
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);

const chatSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

const locationShareSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sharedWithUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'blocked'], default: 'pending' },
  shareUntil: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const LocationShare = mongoose.model('LocationShare', locationShareSchema);

// Fix: Use /tmp for uploads on Vercel
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'complaint-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('يجب رفع صورة فقط (JPG, PNG)'));
    }
  }
});

class ExcelParser {
  constructor(filePath) {
    this.filePath = filePath;
  }

  fileExists() {
    return fs.existsSync(this.filePath);
  }

  getStations() {
    try {
      if (!this.fileExists()) return [];
      const workbook = xlsx.readFile(this.filePath);
      const sheet = workbook.Sheets['PM10'];
      if (!sheet) return [];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      const stations = data[0].slice(1).map(name => ({
        name_ar: name?.toString().trim() || '',
        governorate: this.guessGovernorate(name)
      })).filter(s => s.name_ar);
      return stations;
    } catch (error) {
      console.error('Error reading stations:', error);
      return [];
    }
  }

  getAllStationsData() {
    try {
      if (!this.fileExists()) return [];
      const stations = this.getStations();
      const stationsData = [];
      for (const station of stations) {
        const data = this.getStationData(station.name_ar);
        if (Object.keys(data).length > 0) {
          stationsData.push({ name: station.name_ar, governorate: station.governorate, pollutants: data });
        }
      }
      return stationsData;
    } catch (error) {
      console.error('Error reading stations data:', error);
      return [];
    }
  }

  getStationData(stationName) {
    try {
      if (!this.fileExists()) return {};
      const workbook = xlsx.readFile(this.filePath);
      const result = {};
      const sheetsMapping = {
        'PM10': { headerRow: 1, dataStartRow: 2 },
        'PM2.5': { headerRow: 1, dataStartRow: 2 },
        'SO2': { headerRow: 0, dataStartRow: 1 },
        'NO2': { headerRow: 2, dataStartRow: 3 },
        'CO': { headerRow: 1, dataStartRow: 2 },
        'O3': { headerRow: 1, dataStartRow: 2 },
      };
      for (const [sheetName, config] of Object.entries(sheetsMapping)) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (!data || data.length < config.dataStartRow + 1) continue;
        const headers = data[config.headerRow] || [];
        let stationIndex = -1;
        for (let i = 0; i < headers.length; i++) {
          if (headers[i]?.toString().trim() === stationName) { stationIndex = i; break; }
        }
        if (stationIndex === -1) continue;
        let lastValue = null;
        for (let i = data.length - 1; i >= config.dataStartRow; i--) {
          const row = data[i];
          if (!row || row.length <= stationIndex) continue;
          const value = row[stationIndex];
          if (value !== "" && value !== null && value !== undefined && !isNaN(parseFloat(value))) {
            lastValue = parseFloat(value);
            break;
          }
        }
        if (lastValue !== null && !isNaN(lastValue)) {
          let unit = 'μg/m³';
          if (sheetName === 'CO') unit = 'ppm';
          else if (sheetName === 'O3') unit = 'ppm';
          else if (sheetName === 'SO2' || sheetName === 'NO2') unit = 'ppb';
          result[sheetName] = { value: lastValue, unit };
        }
      }
      return result;
    } catch (error) {
      console.error('Error getting station data:', error);
      return {};
    }
  }

  guessGovernorate(stationName) {
    const govMap = {
      'العباسية': 'القاهرة', 'المهندسين': 'الجيزة', 'المتحف': 'الجيزة',
      '6 اكتوبر': 'الجيزة', 'بشاير الخير': 'الإسكندرية', 'المنصورة': 'الدقهلية',
      'الفيوم': 'الفيوم', 'اسيوط': 'أسيوط', 'قنا': 'قنا', 'بدر': 'القاهرة',
      'الشيخ زايد': 'الجيزة', 'التبين': 'القاهرة', 'برج العرب': 'الإسكندرية',
      'قصر العيني': 'القاهرة', 'التحرير': 'القاهرة'
    };
    for (const [key, value] of Object.entries(govMap)) {
      if (stationName && stationName.includes(key)) return value;
    }
    return 'القاهرة';
  }
}

class AQICalculator {
  calculatePollutantAQI(pollutant, value) {
    if (pollutant === 'PM2.5') {
      if (value <= 12.0) return Math.round((value / 12) * 50);
      if (value <= 35.4) return Math.round(((value - 12.1) / 23.3) * 49 + 51);
      if (value <= 55.4) return Math.round(((value - 35.5) / 19.9) * 49 + 101);
      if (value <= 150.4) return Math.round(((value - 55.5) / 94.9) * 49 + 151);
      return 300;
    }
    if (pollutant === 'PM10') {
      if (value <= 54) return Math.round((value / 54) * 50);
      if (value <= 154) return Math.round(((value - 55) / 99) * 49 + 51);
      if (value <= 254) return Math.round(((value - 155) / 99) * 49 + 101);
      if (value <= 354) return Math.round(((value - 255) / 99) * 49 + 151);
      return 300;
    }
    if (pollutant === 'SO2' || pollutant === 'NO2') {
      if (value <= 50) return Math.round((value / 50) * 50);
      if (value <= 100) return Math.round(((value - 51) / 49) * 49 + 51);
      if (value <= 200) return Math.round(((value - 101) / 99) * 49 + 101);
      if (value <= 400) return Math.round(((value - 201) / 199) * 49 + 151);
      return 300;
    }
    if (pollutant === 'CO') {
      if (value <= 4.4) return Math.round((value / 4.4) * 50);
      if (value <= 9.4) return Math.round(((value - 4.5) / 4.9) * 49 + 51);
      if (value <= 12.4) return Math.round(((value - 9.5) / 2.9) * 49 + 101);
      if (value <= 15.4) return Math.round(((value - 12.5) / 2.9) * 49 + 151);
      return 300;
    }
    if (pollutant === 'O3') {
      if (value <= 0.054) return Math.round((value / 0.054) * 50);
      if (value <= 0.070) return Math.round(((value - 0.055) / 0.015) * 49 + 51);
      if (value <= 0.085) return Math.round(((value - 0.071) / 0.014) * 49 + 101);
      if (value <= 0.105) return Math.round(((value - 0.086) / 0.019) * 49 + 151);
      if (value <= 0.200) return Math.round(((value - 0.106) / 0.094) * 49 + 201);
      return 300;
    }
    return 50;
  }

  getAQIDetails(aqi) {
    if (aqi <= 50) return { category: 'جيد', color: '#00E400', advice: 'جودة الهواء ممتازة - مناسب لجميع الأنشطة' };
    if (aqi <= 100) return { category: 'متوسط', color: '#FFFF00', advice: 'جودة الهواء مقبولة - الفئات الحساسة توخ الحذر' };
    if (aqi <= 150) return { category: 'غير صحي للمجموعات الحساسة', color: '#FF7E00', advice: 'الأطفال وكبار السن ومرضى الجهاز التنفسي يحدون من النشاط الخارجي' };
    if (aqi <= 200) return { category: 'غير صحي', color: '#FF0000', advice: 'تجنب الأنشطة الخارجية الطويلة - أغلق النوافذ' };
    if (aqi <= 300) return { category: 'خطير جدا', color: '#8F3F97', advice: 'ابق في المنزل - ارتد كمامة عند الضرورة' };
    return { category: 'خطر', color: '#7E0023', advice: 'حالة طوارئ - تجنب الخروج تماما' };
  }

  getColor(aqi) { return this.getAQIDetails(aqi).color; }

  getRecommendation(aqi, governorate) {
    if (aqi <= 50) return `جودة الهواء ممتازة في ${governorate}`;
    if (aqi <= 100) return `جودة الهواء جيدة في ${governorate}`;
    if (aqi <= 150) return `جودة الهواء متوسطة في ${governorate}`;
    if (aqi <= 200) return `جودة الهواء غير صحية في ${governorate}`;
    if (aqi <= 300) return `جودة الهواء خطيرة في ${governorate}`;
    return `خطر شديد في ${governorate}`;
  }

  calculateAQIFromPollutants(pollutants) {
    let aqi = 0;
    for (const [pollutant, data] of Object.entries(pollutants)) {
      aqi = Math.max(aqi, this.calculatePollutantAQI(pollutant, data.value));
    }
    return aqi;
  }

  generateWeeklyForecast(baseAQI, governorate) {
    const days = [
      { name: 'اليوم', date: this.getDateString(0) },
      { name: 'الغد', date: this.getDateString(1) },
      { name: 'بعد الغد', date: this.getDateString(2) },
      { name: this.getDayName(3), date: this.getDateString(3) },
      { name: this.getDayName(4), date: this.getDateString(4) },
      { name: this.getDayName(5), date: this.getDateString(5) },
      { name: this.getDayName(6), date: this.getDateString(6) }
    ];
    const forecast = [];
    let currentAQI = baseAQI;
    for (let i = 0; i < days.length; i++) {
      currentAQI = Math.max(0, Math.min(500, currentAQI + (Math.random() * 20) - 7));
      const details = this.getAQIDetails(currentAQI);
      forecast.push({ day: days[i].name, date: days[i].date, aqi: Math.round(currentAQI), category: details.category, color: details.color, advice: details.advice });
    }
    return forecast;
  }

  getDayName(daysLater) {
    const date = new Date();
    date.setDate(date.getDate() + daysLater);
    return ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][date.getDay()];
  }

  getDateString(daysLater) {
    const date = new Date();
    date.setDate(date.getDate() + daysLater);
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }
}

class LocationService {
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  deg2rad(deg) { return deg * (Math.PI/180); }
  getGovernorateCoords(governorate) {
    const coords = {
      'القاهرة': { lat: 30.0444, lng: 31.2357 }, 'الجيزة': { lat: 30.0131, lng: 31.2089 },
      'الإسكندرية': { lat: 31.2001, lng: 29.9187 }, 'الدقهلية': { lat: 31.0413, lng: 31.3801 },
      'الفيوم': { lat: 29.3084, lng: 30.8428 }, 'أسيوط': { lat: 27.1812, lng: 31.1837 },
      'قنا': { lat: 26.1642, lng: 32.7271 }, 'الأقصر': { lat: 25.6872, lng: 32.6396 },
      'أسوان': { lat: 24.0889, lng: 32.8998 }, 'البحيرة': { lat: 31.0551, lng: 30.4593 },
      'المنيا': { lat: 28.1198, lng: 30.7443 }, 'سوهاج': { lat: 26.5601, lng: 31.6917 },
      'بورسعيد': { lat: 31.2653, lng: 32.3019 }, 'السويس': { lat: 29.9737, lng: 32.5263 },
      'دمياط': { lat: 31.4165, lng: 31.8135 }, 'الشرقية': { lat: 30.7101, lng: 31.6724 },
      'الغربية': { lat: 30.8754, lng: 31.0334 }, 'كفر الشيخ': { lat: 31.1112, lng: 30.9399 },
      'المنوفية': { lat: 30.5972, lng: 30.9876 }, 'القليوبية': { lat: 30.2525, lng: 31.2617 },
      'الإسماعيلية': { lat: 30.5833, lng: 32.2667 }, 'شمال سيناء': { lat: 31.0000, lng: 33.8000 },
      'جنوب سيناء': { lat: 29.5000, lng: 33.8000 }, 'مطروح': { lat: 31.3333, lng: 27.2333 },
      'الوادي الجديد': { lat: 24.5000, lng: 27.0000 }, 'البحر الأحمر': { lat: 26.0000, lng: 34.0000 }
    };
    return coords[governorate] || { lat: 30.0444, lng: 31.2357 };
  }
  isValidEgyptLocation(lat, lng) { return lat >= 22 && lat <= 31.5 && lng >= 25 && lng <= 37; }
  getAllGovernorates() {
    return ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الفيوم', 'أسيوط', 'قنا',
      'الأقصر', 'أسوان', 'البحيرة', 'المنيا', 'سوهاج', 'بورسعيد', 'السويس',
      'دمياط', 'الشرقية', 'الغربية', 'كفر الشيخ', 'المنوفية', 'القليوبية',
      'الإسماعيلية', 'شمال سيناء', 'جنوب سيناء', 'مطروح', 'الوادي الجديد', 'البحر الأحمر'];
  }
}

class NotificationService {
  async sendToUser(userId, notification) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.notifications) return false;
      return await Notification.create({ userId, title: notification.title, body: notification.body, type: notification.type, data: notification.data || {} });
    } catch (error) { console.error('Notification error:', error); return false; }
  }
  async sendToMultipleUsers(userIds, notification) {
    const results = [];
    for (const userId of userIds) results.push(await this.sendToUser(userId, notification));
    return results;
  }
  async sendToAllUsers(notification) {
    const users = await User.find({ notifications: true });
    return await this.sendToMultipleUsers(users.map(u => u._id), notification);
  }
  async sendAQIAlert(stationName, aqiValue, governorate) {
    const users = await User.find({ $or: [{ favoriteStations: stationName }, { governorate }], notifications: true, 'notificationPreferences.aqiAlerts': true });
    if (!users.length) return;
    let title, body, type;
    if (aqiValue > 200) { title = 'تنبيه خطير'; body = `محطة ${stationName} سجلت AQI = ${aqiValue}`; type = 'alert'; }
    else if (aqiValue > 150) { title = 'تنبيه تلوث عالي'; body = `محطة ${stationName} سجلت AQI = ${aqiValue}`; type = 'alert'; }
    else if (aqiValue > 100) { title = 'تنبيه تلوث متوسط'; body = `محطة ${stationName} سجلت AQI = ${aqiValue}`; type = 'alert'; }
    else return;
    await this.sendToMultipleUsers(users.map(u => u._id), { title, body, type, data: { station: stationName, aqi: aqiValue, governorate } });
  }
  async sendComplaintUpdate(userId, complaint) {
    const statusMessages = { 'pending': 'قيد المراجعة', 'in_progress': 'جاري المعالجة', 'resolved': 'تم الحل', 'rejected': 'لم يتم القبول' };
    await this.sendToUser(userId, { title: 'تحديث حالة الشكوى', body: `شكواك "${complaint.title}" أصبحت: ${statusMessages[complaint.status]}`, type: 'complaint_update', data: { complaintId: complaint._id, status: complaint.status } });
  }
  async getUserNotifications(userId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [notifications, total, unread] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments({ userId }),
      Notification.countDocuments({ userId, read: false })
    ]);
    return { notifications, pagination: { page, limit, total, pages: Math.ceil(total / limit), unread } };
  }
  async markAsRead(notificationId, userId) { await Notification.findOneAndUpdate({ _id: notificationId, userId }, { read: true, readAt: new Date() }); }
  async markAllAsRead(userId) { await Notification.updateMany({ userId, read: false }, { read: true, readAt: new Date() }); }
  async updateUserToken(userId, fcmToken) { await User.findByIdAndUpdate(userId, { fcmToken }); }
}

class RecommendationService {
  getRecommendations(aqi, governorate) {
    const recommendations = { outdoor: [], indoor: [], health: [], alerts: [] };
    if (aqi <= 50) { recommendations.outdoor = [{ activity: 'المشي', description: 'ممتاز للمشي في الهواء الطلق', duration: '30-60 دقيقة' }]; recommendations.alerts.push('وقت ممتاز للأنشطة الخارجية'); }
    else if (aqi <= 100) { recommendations.outdoor = [{ activity: 'المشي الخفيف', description: 'المشي مسموح مع أخذ الحيطة', duration: '30 دقيقة' }]; recommendations.health = ['الفئات الحساسة تحد من النشاط الخارجي']; }
    else if (aqi <= 150) { recommendations.indoor = [{ activity: 'تمارين منزلية', description: 'مارس الرياضة في المنزل', duration: '30 دقيقة' }]; recommendations.health = ['ارتد كمامة N95 عند الخروج']; recommendations.alerts.push('جودة الهواء غير صحية للمجموعات الحساسة'); }
    else { recommendations.indoor = [{ activity: 'البقاء في المنزل', description: 'تجنب الخروج قدر الإمكان', duration: 'طوال اليوم' }]; recommendations.health = ['خطر - ابق في المنزل']; recommendations.alerts.push('تحذير: جودة الهواء خطيرة'); }
    return recommendations;
  }
  getDailyTip() {
    const tips = [
      { title: 'نباتات منزلية', tip: 'أضف نباتات مثل الصبار لتنقية هواء منزلك' },
      { title: 'تهوية المنزل', tip: 'قم بتهوية المنزل في الصباح الباكر' },
      { title: 'ارتداء الكمامة', tip: 'في أيام التلوث العالي، ارتد كمامة N95' }
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }
}

const excelFilePath = path.join(__dirname, 'data', 'data.xlsx');
const excelParser = new ExcelParser(excelFilePath);
const aqiCalculator = new AQICalculator();
const locationService = new LocationService();
const notificationService = new NotificationService();
const recommendationService = new RecommendationService();

const generateToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password -fcmToken');
      if (!req.user) return res.status(401).json({ success: false, message: 'المستخدم غير موجود' });
      req.user.lastActive = new Date();
      await req.user.save();
      next();
    } catch (error) { res.status(401).json({ success: false, message: 'غير مصرح به' }); }
  } else { res.status(401).json({ success: false, message: 'لا يوجد توكن' }); }
};

const adminOnly = (req, res, next) => {
  if (req.user?.isAdmin()) next();
  else res.status(403).json({ success: false, message: 'ممنوع - مشرفين فقط' });
};

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, governorate, phone } = req.body;
    if (await User.findOne({ email })) return res.status(400).json({ success: false, message: 'البريد موجود بالفعل' });
    const user = new User({ name, email, password, governorate: governorate || '', phone: phone || '' });
    await user.save();
    await notificationService.sendToUser(user._id, { title: '🎉 مرحباً بك في AERION', body: `أهلاً ${name}!`, type: 'welcome' });
    res.json({ success: true, token: generateToken(user._id), user: { id: user._id, name: user.name, email: user.email, governorate: user.governorate, role: user.role, favoriteStations: user.favoriteStations, notifications: user.notifications } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في الخادم' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
    user.lastLogin = new Date();
    user.loginCount += 1;
    if (fcmToken) user.fcmToken = fcmToken;
    await user.save();
    res.json({ success: true, token: generateToken(user._id), user: { id: user._id, name: user.name, email: user.email, governorate: user.governorate, role: user.role, favoriteStations: user.favoriteStations, notifications: user.notifications } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في الخادم' }); }
});

// ==================== USER ROUTES ====================
app.get('/api/users/profile', protect, (req, res) => res.json({ success: true, user: req.user }));

app.put('/api/users/profile', protect, async (req, res) => {
  try {
    const { name, governorate, city, address, phone, notifications, notificationPreferences, locationSettings } = req.body;
    const user = await User.findById(req.user._id);
    if (name) user.name = name;
    if (governorate !== undefined) user.governorate = governorate;
    if (city !== undefined) user.city = city;
    if (address !== undefined) user.address = address;
    if (phone !== undefined) user.phone = phone;
    if (notifications !== undefined) user.notifications = notifications;
    if (notificationPreferences) user.notificationPreferences = notificationPreferences;
    if (locationSettings) user.locationSettings = locationSettings;
    await user.save();
    res.json({ success: true, user });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في الخادم' }); }
});

// ==================== LOCATION ROUTES ====================
app.put('/api/users/location', protect, async (req, res) => {
  try {
    const { latitude, longitude, address, accuracy } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ success: false, message: 'الموقع مطلوب' });
    const user = await User.findById(req.user._id);
    user.currentLocation = { latitude, longitude, address: address || null, accuracy: accuracy || null, updatedAt: new Date() };
    if (user.locationSettings.saveHistory) {
      user.locationHistory.push({ latitude, longitude, address: address || null, timestamp: new Date(), accuracy: accuracy || null });
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - (user.locationSettings.historyRetentionDays || 30));
      user.locationHistory = user.locationHistory.filter(h => new Date(h.timestamp) > cutoffDate);
    }
    await user.save();
    res.json({ success: true, message: 'تم تحديث الموقع', data: { currentLocation: user.currentLocation } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في تحديث الموقع' }); }
});

app.get('/api/users/location', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, data: { currentLocation: user.currentLocation, locationSettings: user.locationSettings } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب الموقع' }); }
});

app.get('/api/users/location/history', protect, async (req, res) => {
  try {
    const { limit = 50, days = 7 } = req.query;
    const user = await User.findById(req.user._id);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
    const history = user.locationHistory.filter(h => new Date(h.timestamp) > cutoffDate).slice(-parseInt(limit)).reverse();
    res.json({ success: true, data: { history, total: user.locationHistory.length } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب تاريخ المواقع' }); }
});

app.delete('/api/users/location/history', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.locationHistory = [];
    await user.save();
    res.json({ success: true, message: 'تم حذف تاريخ المواقع' });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في حذف تاريخ المواقع' }); }
});

// ==================== NOTIFICATION ROUTES ====================
app.get('/api/notifications', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await notificationService.getUserNotifications(req.user._id, parseInt(page), parseInt(limit));
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب الإشعارات' }); }
});

app.put('/api/notifications/:id/read', protect, async (req, res) => {
  try { await notificationService.markAsRead(req.params.id, req.user._id); res.json({ success: true, message: 'تم التحديث' }); }
  catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

app.put('/api/notifications/read-all', protect, async (req, res) => {
  try { await notificationService.markAllAsRead(req.user._id); res.json({ success: true, message: 'تم تحديث الكل' }); }
  catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

app.post('/api/notifications/token', protect, async (req, res) => {
  try { await notificationService.updateUserToken(req.user._id, req.body.token); res.json({ success: true }); }
  catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

app.post('/api/notifications/send-to-user', protect, adminOnly, async (req, res) => {
  try {
    const { userId, title, body, type, data } = req.body;
    if (!userId || !title || !body) return res.status(400).json({ success: false, message: 'userId, title, body مطلوبين' });
    const notification = await notificationService.sendToUser(userId, { title, body, type: type || 'system', data: data || {} });
    res.json({ success: true, message: 'تم إرسال الإشعار', data: notification });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في إرسال الإشعار' }); }
});

app.post('/api/notifications/send-to-all', protect, adminOnly, async (req, res) => {
  try {
    const { title, body, type, data } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, message: 'title, body مطلوبين' });
    const results = await notificationService.sendToAllUsers({ title, body, type: type || 'system', data: data || {} });
    res.json({ success: true, message: `تم إرسال الإشعار لـ ${results.length} مستخدم`, count: results.length });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

// ==================== COMPLAINT ROUTES ====================
app.post('/api/complaints', protect, upload.array('images', 5), async (req, res) => {
  try {
    let complaintData = req.body.data ? JSON.parse(req.body.data) : req.body;
    const imageUrls = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
    if (!complaintData.title || !complaintData.description || !complaintData.type || !complaintData.address) {
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }
    const location = complaintData.location || { latitude: parseFloat(complaintData.latitude), longitude: parseFloat(complaintData.longitude), address: complaintData.address };
    const complaint = new Complaint({ userId: req.user._id, title: complaintData.title, description: complaintData.description, type: complaintData.type, location, address: complaintData.address, images: imageUrls });
    await complaint.save();
    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } });
    await notificationService.sendToMultipleUsers(admins.map(a => a._id), { title: 'شكوى جديدة', body: `من ${req.user.name}: ${complaint.title}`, type: 'complaint_update', data: { complaintId: complaint._id } });
    res.status(201).json({ success: true, message: 'تم إرسال الشكوى', data: complaint });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في إنشاء الشكوى' }); }
});

app.get('/api/complaints', protect, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = req.user.isAdmin() ? {} : { userId: req.user._id };
    if (status) query.status = status;
    const [complaints, total] = await Promise.all([
      Complaint.find(query).populate('userId', 'name email').populate('resolvedBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Complaint.countDocuments(query)
    ]);
    res.json({ success: true, data: complaints, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب الشكاوى' }); }
});

app.get('/api/complaints/:id', protect, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id).populate('userId', 'name email phone').populate('resolvedBy', 'name');
    if (!complaint) return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    if (!req.user.isAdmin() && complaint.userId._id.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: 'غير مصرح' });
    res.json({ success: true, data: complaint });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

app.put('/api/complaints/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    complaint.status = status;
    if (adminNotes) complaint.adminNotes = adminNotes;
    if (status === 'resolved') { complaint.resolvedAt = new Date(); complaint.resolvedBy = req.user._id; }
    await complaint.save();
    await notificationService.sendComplaintUpdate(complaint.userId, complaint);
    res.json({ success: true, message: 'تم تحديث حالة الشكوى', data: complaint });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

app.delete('/api/complaints/:id', protect, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    if (!req.user.isAdmin() && complaint.userId.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await complaint.deleteOne();
    res.json({ success: true, message: 'تم الحذف' });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

// ==================== AIR QUALITY ROUTES ====================
app.get('/api/air-quality/nearby', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'الرجاء إرسال الموقع' });
    if (!locationService.isValidEgyptLocation(parseFloat(lat), parseFloat(lng))) return res.status(400).json({ success: false, message: 'الموقع خارج مصر' });
    const stations = excelParser.getStations();
    let nearestStation = null, minDistance = Infinity;
    for (const station of stations) {
      const govCoords = locationService.getGovernorateCoords(station.governorate);
      const distance = locationService.calculateDistance(parseFloat(lat), parseFloat(lng), govCoords.lat, govCoords.lng);
      if (distance < minDistance) { minDistance = distance; nearestStation = station; }
    }
    if (!nearestStation) return res.status(404).json({ success: false, message: 'لا توجد محطات قريبة' });
    const stationData = excelParser.getStationData(nearestStation.name_ar);
    const pollutants = [];
    let maxAQI = 0;
    for (const [pollutant, data] of Object.entries(stationData)) {
      const aqi = aqiCalculator.calculatePollutantAQI(pollutant, data.value);
      pollutants.push({ code: pollutant, value: data.value, unit: data.unit, aqi });
      if (aqi > maxAQI) maxAQI = aqi;
    }
    const aqiDetails = aqiCalculator.getAQIDetails(maxAQI);
    res.json({ success: true, data: { station: { name: nearestStation.name_ar, governorate: nearestStation.governorate }, distance: Math.round(minDistance * 10) / 10, aqi: maxAQI, category: aqiDetails.category, color: aqiDetails.color, advice: aqiDetails.advice, pollutants, timestamp: new Date() } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في الخادم' }); }
});

app.get('/api/air-quality/governorates', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const governorates = locationService.getAllGovernorates();
    const result = [];
    for (const gov of governorates) {
      const govStations = stations.filter(s => s.governorate === gov);
      let totalAQI = 0, stationCount = 0;
      for (const station of govStations.slice(0, 2)) {
        const data = excelParser.getStationData(station.name_ar);
        if (Object.keys(data).length > 0) {
          let stationAQI = 0;
          for (const [pollutant, values] of Object.entries(data)) { const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value); if (aqi > stationAQI) stationAQI = aqi; }
          totalAQI += stationAQI; stationCount++;
        }
      }
      const avgAQI = stationCount > 0 ? Math.round(totalAQI / stationCount) : Math.floor(Math.random() * 100) + 50;
      const details = aqiCalculator.getAQIDetails(avgAQI);
      result.push({ name: gov, aqi: avgAQI, category: details.category, color: details.color, stations: govStations.length });
    }
    res.json({ success: true, data: result });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في الخادم' }); }
});

app.get('/api/air-quality/governorate/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const stations = excelParser.getStations();
    const govStations = stations.filter(s => s.governorate === name);
    if (govStations.length === 0) return res.status(404).json({ success: false, message: 'المحافظة غير موجودة' });
    const stationsData = [];
    let totalAQI = 0;
    for (const station of govStations) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      const pollutants = [];
      for (const [pollutant, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
        pollutants.push({ code: pollutant, value: values.value, unit: values.unit, aqi });
        if (aqi > stationAQI) stationAQI = aqi;
      }
      totalAQI += stationAQI;
      stationsData.push({ id: station.name_ar, name: station.name_ar, aqi: stationAQI, pollutants });
    }
    const avgAQI = Math.round(totalAQI / govStations.length);
    const details = aqiCalculator.getAQIDetails(avgAQI);
    res.json({ success: true, data: { name, avgAQI, category: details.category, color: details.color, advice: details.advice, stations: stationsData, coordinates: locationService.getGovernorateCoords(name) } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في الخادم' }); }
});

app.get('/api/air-quality/weekly-forecast', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const governorates = [...new Set(stations.map(s => s.governorate))];
    const forecastData = [];
    for (const gov of governorates) {
      const govStations = stations.filter(s => s.governorate === gov);
      let totalAQI = 0, stationCount = 0;
      for (const station of govStations.slice(0, 2)) {
        const data = excelParser.getStationData(station.name_ar);
        if (Object.keys(data).length > 0) {
          let stationAQI = 0;
          for (const [pollutant, values] of Object.entries(data)) { const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value); if (aqi > stationAQI) stationAQI = aqi; }
          totalAQI += stationAQI; stationCount++;
        }
      }
      const baseAQI = stationCount > 0 ? Math.round(totalAQI / stationCount) : Math.floor(Math.random() * 100) + 50;
      forecastData.push({ governorate: gov, currentAQI: baseAQI, forecast: aqiCalculator.generateWeeklyForecast(baseAQI, gov) });
    }
    res.json({ success: true, data: forecastData });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب تنبؤات الأسبوع' }); }
});

app.get('/api/air-quality/weekly-forecast/:governorate', async (req, res) => {
  try {
    const { governorate } = req.params;
    const stations = excelParser.getStations();
    const govStations = stations.filter(s => s.governorate === governorate);
    if (govStations.length === 0) return res.status(404).json({ success: false, message: 'المحافظة غير موجودة' });
    let totalAQI = 0, stationCount = 0;
    for (const station of govStations.slice(0, 3)) {
      const data = excelParser.getStationData(station.name_ar);
      if (Object.keys(data).length > 0) {
        let stationAQI = 0;
        for (const [pollutant, values] of Object.entries(data)) { const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value); if (aqi > stationAQI) stationAQI = aqi; }
        totalAQI += stationAQI; stationCount++;
      }
    }
    const baseAQI = stationCount > 0 ? Math.round(totalAQI / stationCount) : 50;
    res.json({ success: true, data: { governorate, currentAQI: baseAQI, forecast: aqiCalculator.generateWeeklyForecast(baseAQI, governorate) } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب التنبؤات' }); }
});

// ==================== PUBLIC ROUTES ====================
app.get('/api/public/air-quality/:stationName', async (req, res) => {
  try {
    const { stationName } = req.params;
    const data = excelParser.getStationData(stationName);
    let maxAQI = 0;
    const pollutants = [];
    for (const [pollutant, values] of Object.entries(data)) {
      const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
      pollutants.push({ code: pollutant, value: values.value, unit: values.unit });
      if (aqi > maxAQI) maxAQI = aqi;
    }
    const details = aqiCalculator.getAQIDetails(maxAQI);
    res.json({ success: true, data: { governorate: stationName, aqi: maxAQI, category: details.category, color: details.color, advice: details.advice, pollutants, lastUpdated: new Date() } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==================== MAP ROUTES ====================
app.get('/api/map/stations', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const stationsWithData = [];
    for (const station of stations) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      const pollutants = [];
      for (const [pollutant, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
        pollutants.push({ code: pollutant, value: values.value, unit: values.unit, aqi });
        if (aqi > stationAQI) stationAQI = aqi;
      }
      const coordinates = locationService.getGovernorateCoords(station.governorate);
      stationsWithData.push({ id: station.name_ar, name: station.name_ar, governorate: station.governorate, aqi: stationAQI || Math.floor(Math.random() * 100) + 50, coordinates: { lat: coordinates.lat, lng: coordinates.lng }, pollutants, status: stationAQI <= 50 ? 'good' : stationAQI <= 100 ? 'moderate' : stationAQI <= 150 ? 'unhealthy' : 'danger', lastUpdated: new Date() });
    }
    res.json({ success: true, data: stationsWithData, total: stationsWithData.length });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب محطات الخريطة' }); }
});

app.get('/api/map/complaints', protect, async (req, res) => {
  try {
    const complaints = await Complaint.find({ status: { $ne: 'resolved' } }).select('title type location address status createdAt').limit(100);
    res.json({ success: true, data: complaints.map(c => ({ id: c._id, title: c.title, type: c.type, status: c.status, address: c.address, coordinates: { lat: c.location.latitude, lng: c.location.longitude }, createdAt: c.createdAt })) });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

// ==================== DASHBOARD ROUTES ====================
app.get('/api/dashboard/summary', protect, async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const governorates = [...new Set(stations.map(s => s.governorate))];
    const governoratesAQI = [];
    for (const gov of governorates) {
      const govStations = stations.filter(s => s.governorate === gov);
      let totalAQI = 0, stationCount = 0;
      for (const station of govStations.slice(0, 3)) {
        const data = excelParser.getStationData(station.name_ar);
        if (Object.keys(data).length > 0) {
          let stationAQI = 0;
          for (const [pollutant, values] of Object.entries(data)) { const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value); if (aqi > stationAQI) stationAQI = aqi; }
          totalAQI += stationAQI; stationCount++;
        }
      }
      const avgAQI = stationCount > 0 ? Math.round(totalAQI / stationCount) : Math.floor(Math.random() * 100) + 50;
      const details = aqiCalculator.getAQIDetails(avgAQI);
      governoratesAQI.push({ governorate: gov, aqi: avgAQI, category: details.category, color: details.color, stationCount: govStations.length });
    }
    governoratesAQI.sort((a, b) => b.aqi - a.aqi);
    const complaintsTotal = await Complaint.countDocuments();
    res.json({ success: true, data: { topPolluted: governoratesAQI.slice(0, 5), allGovernorates: governoratesAQI, complaints: { total: complaintsTotal }, stationsCount: stations.length, lastUpdated: new Date() } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في لوحة التحكم' }); }
});

// ==================== RECOMMENDATIONS ROUTES ====================
app.get('/api/recommendations', protect, async (req, res) => {
  try {
    let currentAQI = 50;
    const governorate = req.user.governorate || 'القاهرة';
    const stations = excelParser.getStations();
    const govStations = stations.filter(s => s.governorate === governorate);
    if (govStations.length > 0) {
      const data = excelParser.getStationData(govStations[0].name_ar);
      let maxAQI = 0;
      for (const [pollutant, values] of Object.entries(data)) { const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value); if (aqi > maxAQI) maxAQI = aqi; }
      currentAQI = maxAQI || 50;
    }
    const recommendations = recommendationService.getRecommendations(currentAQI, governorate);
    const dailyTip = recommendationService.getDailyTip();
    res.json({ success: true, data: { aqi: currentAQI, governorate, category: aqiCalculator.getAQIDetails(currentAQI).category, recommendations, dailyTip, lastUpdated: new Date() } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب التوصيات' }); }
});

app.get('/api/recommendations/daily-tip', protect, async (req, res) => {
  try { res.json({ success: true, data: recommendationService.getDailyTip() }); }
  catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

// ==================== ALERTS ROUTES ====================
app.get('/api/alerts', protect, async (req, res) => {
  const alerts = await Alert.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: alerts });
});

app.post('/api/alerts', protect, async (req, res) => {
  try { const alert = new Alert({ ...req.body, userId: req.user._id }); await alert.save(); res.status(201).json({ success: true, data: alert }); }
  catch (error) { res.status(500).json({ success: false, message: 'خطأ في إنشاء التنبيه' }); }
});

app.delete('/api/alerts/:id', protect, async (req, res) => {
  await Alert.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  res.json({ success: true, message: 'تم الحذف' });
});

app.patch('/api/alerts/:id/toggle', protect, async (req, res) => {
  try {
    const alert = await Alert.findOne({ _id: req.params.id, userId: req.user._id });
    if (!alert) return res.status(404).json({ success: false, message: 'غير موجود' });
    alert.active = !alert.active;
    await alert.save();
    res.json({ success: true, data: alert });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

// ==================== REPORTS ROUTES ====================
app.get('/api/reports', protect, async (req, res) => {
  const reports = await Report.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: reports });
});

app.post('/api/reports', protect, async (req, res) => {
  try { const report = new Report({ ...req.body, userId: req.user._id }); await report.save(); res.status(201).json({ success: true, data: report }); }
  catch (error) { res.status(500).json({ success: false, message: 'خطأ في إنشاء التقرير' }); }
});

app.delete('/api/reports/:id', protect, async (req, res) => {
  await Report.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  res.json({ success: true, message: 'تم الحذف' });
});

// ==================== ADMIN ROUTES ====================
app.get('/api/admin/users', protect, adminOnly, async (req, res) => {
  const users = await User.find().select('-password -fcmToken');
  res.json({ success: true, data: users });
});

app.get('/api/admin/stats', protect, adminOnly, async (req, res) => {
  try {
    const [totalUsers, totalAdmins, totalComplaints, totalAlerts, totalReports] = await Promise.all([
      User.countDocuments(), User.countDocuments({ role: { $in: ['admin', 'super_admin'] } }),
      Complaint.countDocuments(), Alert.countDocuments(), Report.countDocuments()
    ]);
    res.json({ success: true, data: { totalUsers, totalAdmins, totalComplaints, totalAlerts, totalReports } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ في جلب الإحصائيات' }); }
});

app.put('/api/admin/users/:id/role', protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    user.role = req.body.role;
    await user.save();
    res.json({ success: true, message: 'تم تحديث الدور', data: { id: user._id, role: user.role } });
  } catch (error) { res.status(500).json({ success: false, message: 'خطأ' }); }
});

// ==================== AI PREDICTION ====================
app.post("/api/predict", async (req, res) => {
  try {
    const response = await axios.post("http://127.0.0.1:5001/predict", req.body, { timeout: 10000 });
    res.json(response.data);
  } catch (error) {
    res.status(503).json({ success: false, error: "AI server is not running", message: "خادم الذكاء الاصطناعي غير متاح" });
  }
});

// ==================== RATING ====================
app.post('/api/rating/request', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.lastRatingRequest = new Date();
    user.ratingRequestsCount = (user.ratingRequestsCount || 0) + 1;
    await user.save();
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/rating/submit', protect, async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    const user = await User.findById(req.user._id);
    user.hasRated = true; user.userRating = rating; user.ratingFeedback = feedback;
    await user.save();
    res.json({ success: true, message: 'شكراً على تقييمك!' });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ==================== HEALTH CHECK ====================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'AERION Air Quality API',
    version: '5.0.0',
    status: 'Running',
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
      excelFile: fs.existsSync(excelFilePath) ? 'Available' : 'Not Available'
    }
  });
});

// Only listen in local dev
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;