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

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/air-quality';

// MongoDB connection with serverless support
let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    console.log('Using existing MongoDB connection');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    isConnected = true;
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    // Don't exit process in serverless environment
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
};

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
  
  // ==================== التقييم والإشعارات ====================
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
    enum: [
      'انبعاثات مصنع',
      'دخان كثيف',
      'حرق قمامة',
      'عوادم مركبات',
      'رائحة كريهة',
      'تراكم مخلفات',
      'أخرى'
    ],
    required: true
  },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String }
  },
  address: { type: String, required: true },
  images: [{ type: String }],
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'resolved', 'rejected'],
    default: 'pending'
  },
  adminNotes: String,
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const Complaint = mongoose.model('Complaint', complaintSchema);

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: {
    type: String,
    enum: ['alert', 'daily_tip', 'complaint_update', 'welcome', 'system', 'recommendation', 'location_share'],
    required: true
  },
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

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
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

      if (!sheet) {
        console.error('PM10 sheet not found');
        return [];
      }

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
          stationsData.push({
            name: station.name_ar,
            governorate: station.governorate,
            pollutants: data
          });
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

      // تعريف لكل ورقة أسماء المحطات المختلفة
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
        if (!sheet) {
          console.log(`⚠️ Sheet ${sheetName} not found`);
          continue;
        }

        const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (!data || data.length < config.dataStartRow + 1) continue;
        
        // جلب headers من الصف المحدد
        const headers = data[config.headerRow] || [];
        
        // البحث عن عمود المحطة
        let stationIndex = -1;
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i]?.toString().trim();
          if (header === stationName) {
            stationIndex = i;
            console.log(`✅ Found "${stationName}" in sheet "${sheetName}" at column ${i}`);
            break;
          }
        }
        
        if (stationIndex === -1) {
          console.log(`❌ Station "${stationName}" not found in sheet "${sheetName}"`);
          continue;
        }
        
        // البحث عن آخر قيمة
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
          
          result[sheetName] = {
            value: lastValue,
            unit: unit
          };
          console.log(`📊 ${sheetName}: ${lastValue} ${unit}`);
        }
      }

      console.log(`📦 Final data for ${stationName}:`, result);
      return result;
    } catch (error) {
      console.error('Error getting station data:', error);
      return {};
    }
  }

  guessGovernorate(stationName) {
    const govMap = {
      'العباسية': 'القاهرة',
      'المهندسين': 'الجيزة',
      'المتحف': 'الجيزة',
      '6 اكتوبر': 'الجيزة',
      'بشاير الخير': 'الإسكندرية',
      'المنصورة': 'الدقهلية',
      'الفيوم': 'الفيوم',
      'اسيوط': 'أسيوط',
      'قنا': 'قنا',
      'بدر': 'القاهرة',
      'الشيخ زايد': 'الجيزة',
      'التبين': 'القاهرة',
      'برج العرب': 'الإسكندرية',
      'قصر العيني': 'القاهرة',
      'التحرير': 'القاهرة'
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
      // القيم بالـ ppm
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

  getColor(aqi) {
    return this.getAQIDetails(aqi).color;
  }

  getRecommendation(aqi, governorate) {
    if (aqi <= 50) return `جودة الهواء ممتازة في ${governorate} - وقت رائع للأنشطة الخارجية`;
    if (aqi <= 100) return `جودة الهواء جيدة في ${governorate} - يمكن ممارسة الرياضة بحرية`;
    if (aqi <= 150) return `جودة الهواء متوسطة في ${governorate} - قلل النشاط الخارجي الطويل`;
    if (aqi <= 200) return `جودة الهواء غير صحية في ${governorate} - ارتد كمامة عند الخروج`;
    if (aqi <= 300) return `جودة الهواء خطيرة في ${governorate} - ابق في المنزل`;
    return `خطر شديد في ${governorate} - حالة طوارئ`;
  }

  calculateAQIFromPollutants(pollutants) {
    let aqi = 0;
    
    for (const [pollutant, data] of Object.entries(pollutants)) {
      const pollutantAQI = this.calculatePollutantAQI(pollutant, data.value);
      aqi = Math.max(aqi, pollutantAQI);
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
      const variation = (Math.random() * 20) - 7;
      currentAQI = Math.max(0, Math.min(500, currentAQI + variation));
      
      const details = this.getAQIDetails(currentAQI);

      forecast.push({
        day: days[i].name,
        date: days[i].date,
        aqi: Math.round(currentAQI),
        category: details.category,
        color: details.color,
        advice: details.advice
      });
    }

    return forecast;
  }

  getDayName(daysLater) {
    const date = new Date();
    date.setDate(date.getDate() + daysLater);
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return days[date.getDay()];
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

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  deg2rad(deg) {
    return deg * (Math.PI/180);
  }

  getGovernorateCoords(governorate) {
    const coords = {
      'القاهرة': { lat: 30.0444, lng: 31.2357 },
      'الجيزة': { lat: 30.0131, lng: 31.2089 },
      'الإسكندرية': { lat: 31.2001, lng: 29.9187 },
      'الدقهلية': { lat: 31.0413, lng: 31.3801 },
      'الفيوم': { lat: 29.3084, lng: 30.8428 },
      'أسيوط': { lat: 27.1812, lng: 31.1837 },
      'قنا': { lat: 26.1642, lng: 32.7271 },
      'الأقصر': { lat: 25.6872, lng: 32.6396 },
      'أسوان': { lat: 24.0889, lng: 32.8998 },
      'البحيرة': { lat: 31.0551, lng: 30.4593 },
      'المنيا': { lat: 28.1198, lng: 30.7443 },
      'سوهاج': { lat: 26.5601, lng: 31.6917 },
      'بورسعيد': { lat: 31.2653, lng: 32.3019 },
      'السويس': { lat: 29.9737, lng: 32.5263 },
      'دمياط': { lat: 31.4165, lng: 31.8135 },
      'الشرقية': { lat: 30.7101, lng: 31.6724 },
      'الغربية': { lat: 30.8754, lng: 31.0334 },
      'كفر الشيخ': { lat: 31.1112, lng: 30.9399 },
      'المنوفية': { lat: 30.5972, lng: 30.9876 },
      'القليوبية': { lat: 30.2525, lng: 31.2617 },
      'الإسماعيلية': { lat: 30.5833, lng: 32.2667 },
      'شمال سيناء': { lat: 31.0000, lng: 33.8000 },
      'جنوب سيناء': { lat: 29.5000, lng: 33.8000 },
      'مطروح': { lat: 31.3333, lng: 27.2333 },
      'الوادي الجديد': { lat: 24.5000, lng: 27.0000 },
      'البحر الأحمر': { lat: 26.0000, lng: 34.0000 }
    };
    return coords[governorate] || { lat: 30.0444, lng: 31.2357 };
  }

  isValidEgyptLocation(lat, lng) {
    return lat >= 22 && lat <= 31.5 && lng >= 25 && lng <= 37;
  }

  getAllGovernorates() {
    return [
      'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الفيوم', 'أسيوط', 'قنا',
      'الأقصر', 'أسوان', 'البحيرة', 'المنيا', 'سوهاج', 'بورسعيد', 'السويس',
      'دمياط', 'الشرقية', 'الغربية', 'كفر الشيخ', 'المنوفية', 'القليوبية',
      'الإسماعيلية', 'شمال سيناء', 'جنوب سيناء', 'مطروح', 'الوادي الجديد', 'البحر الأحمر'
    ];
  }
}

class NotificationService {
  async sendToUser(userId, notification) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.notifications) return false;

      const newNotification = await Notification.create({
        userId,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        data: notification.data || {}
      });

      return newNotification;
    } catch (error) {
      console.error('Notification error:', error);
      return false;
    }
  }

  async sendToMultipleUsers(userIds, notification) {
    const results = [];
    for (const userId of userIds) {
      const result = await this.sendToUser(userId, notification);
      results.push(result);
    }
    return results;
  }

  async sendToAllUsers(notification) {
    const users = await User.find({ notifications: true });
    const userIds = users.map(u => u._id);
    return await this.sendToMultipleUsers(userIds, notification);
  }

  async sendAQIAlert(stationName, aqiValue, governorate) {
    const users = await User.find({
      $or: [
        { favoriteStations: stationName },
        { governorate: governorate }
      ],
      notifications: true,
      'notificationPreferences.aqiAlerts': true
    });

    if (users.length === 0) return;

    let title, body, type;

    if (aqiValue > 200) {
      title = 'تنبيه خطير: تلوث شديد';
      body = `محطة ${stationName} سجلت AQI = ${aqiValue} (خطير) - ابق في المنزل وأغلق النوافذ`;
      type = 'danger_alert';
    } else if (aqiValue > 150) {
      title = 'تنبيه: تلوث عالي';
      body = `محطة ${stationName} سجلت AQI = ${aqiValue} (غير صحي) - تجنب الخروج`;
      type = 'warning_alert';
    } else if (aqiValue > 100) {
      title = 'تنبيه: تلوث متوسط';
      body = `محطة ${stationName} سجلت AQI = ${aqiValue} - الفئات الحساسة توخ الحذر`;
      type = 'info_alert';
    } else {
      return;
    }

    const notification = { title, body, type, data: { station: stationName, aqi: aqiValue, governorate } };
    const userIds = users.map(u => u._id);
    await this.sendToMultipleUsers(userIds, notification);
  }

  async sendComplaintUpdate(userId, complaint) {
    const statusMessages = {
      'pending': 'قيد المراجعة',
      'in_progress': 'جاري المعالجة',
      'resolved': 'تم الحل',
      'rejected': 'لم يتم القبول'
    };

    await this.sendToUser(userId, {
      title: 'تحديث حالة الشكوى',
      body: `شكواك "${complaint.title}" أصبحت: ${statusMessages[complaint.status]}`,
      type: 'complaint_update',
      data: { complaintId: complaint._id, status: complaint.status }
    });
  }

  async getUserNotifications(userId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total, unread] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments({ userId }),
      Notification.countDocuments({ userId, read: false })
    ]);

    return {
      notifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit), unread }
    };
  }

  async markAsRead(notificationId, userId) {
    await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { read: true, readAt: new Date() }
    );
  }

  async markAllAsRead(userId) {
    await Notification.updateMany(
      { userId, read: false },
      { read: true, readAt: new Date() }
    );
  }

  async updateUserToken(userId, fcmToken) {
    await User.findByIdAndUpdate(userId, { fcmToken });
  }

  async sendRecommendation(userId, recommendation) {
    await this.sendToUser(userId, {
      title: 'توصية جودة الهواء',
      body: recommendation,
      type: 'recommendation'
    });
  }
}

class ChatbotService {
  async getOrCreateSession(userId) {
    let session = await ChatSession.findOne({ userId, isActive: true });
    if (!session) {
      session = await ChatSession.create({
        userId,
        messages: [{
          role: 'assistant',
          content: 'مرحبا! أنا مساعدك الذكي لجودة الهواء. يمكنني إخبارك بحالة التلوث في أي محافظة مصرية. اسألني مثلا: "التلوث في القاهرة" أو "جودة الهواء في الإسكندرية"'
        }]
      });
    }
    return session;
  }

  async processMessage(userId, message) {
    const session = await this.getOrCreateSession(userId);
    
    session.messages.push({
      role: 'user',
      content: message
    });

    const reply = await this.generateReply(message);
    
    session.messages.push({
      role: 'assistant',
      content: reply
    });

    if (session.messages.length > 50) {
      session.messages = session.messages.slice(-50);
    }

    await session.save();
    return reply;
  }

  async generateReply(message) {
    const msg = message.toLowerCase();
    
    const governorate = this.extractGovernorate(msg);
    
    if (this.isAskingAboutPollution(msg)) {
      if (governorate) {
        return await this.getPollutionData(governorate);
      } else {
        return this.getDefaultPollutionResponse();
      }
    }
    
    if (this.isAskingForAdvice(msg)) {
      if (governorate) {
        const aqi = await this.getGovernorateAQI(governorate);
        return this.getHealthAdvice(aqi, governorate);
      }
      return this.getGeneralHealthAdvice();
    }
    
    if (this.isAskingForForecast(msg)) {
      if (governorate) {
        return await this.getForecast(governorate);
      }
      return this.getDefaultForecastResponse();
    }
    
    if (this.isAskingAboutPollutants(msg)) {
      if (governorate) {
        return await this.getPollutantsDetails(governorate);
      }
      return this.getGeneralPollutantsInfo();
    }
    
    if (this.isGreeting(msg)) {
      return 'وعليكم السلام ورحمة الله! كيف يمكنني مساعدتك؟ يمكنك سؤالي عن: "التلوث في القاهرة" أو "جودة الهواء في الإسكندرية" أو "نصيحة صحية للجيزة" أو "توقعات الغد للدقهلية"';
    }
    
    if (msg.includes('مساعدة') || msg.includes('help')) {
      return this.getHelpMessage();
    }
    
    return this.getHelpMessage();
  }

  extractGovernorate(message) {
    const governorates = [
      'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الفيوم', 'أسيوط', 'قنا',
      'الأقصر', 'أسوان', 'البحيرة', 'المنيا', 'سوهاج', 'بورسعيد', 'السويس',
      'دمياط', 'الشرقية', 'الغربية', 'كفر الشيخ', 'المنوفية', 'القليوبية',
      'الإسماعيلية', 'شمال سيناء', 'جنوب سيناء', 'مطروح', 'الوادي الجديد', 'البحر الأحمر'
    ];
    
    for (const gov of governorates) {
      if (message.includes(gov)) {
        return gov;
      }
    }
    return null;
  }

  isAskingAboutPollution(message) {
    const keywords = ['تلوث', 'جودة الهواء', 'aqi', 'الهواء', 'التلوث', 'حالة الهواء', 'نسبة التلوث'];
    return keywords.some(keyword => message.includes(keyword));
  }

  isAskingForAdvice(message) {
    const keywords = ['نصيحة', 'توصية', 'صحة', 'احتياط', 'احترس', 'كمامة', 'خروج'];
    return keywords.some(keyword => message.includes(keyword));
  }

  isAskingForForecast(message) {
    const keywords = ['توقعات', 'غدا', 'بكرا', 'الاسبوع', 'الأيام', 'الطقس', 'غداً'];
    return keywords.some(keyword => message.includes(keyword));
  }

  isAskingAboutPollutants(message) {
    const keywords = ['pm', 'ملوثات', 'pm2.5', 'pm10', 'co', 'no2', 'so2', 'o3', 'الجسيمات'];
    return keywords.some(keyword => message.includes(keyword));
  }

  isGreeting(message) {
    const greetings = ['السلام', 'مرحبا', 'اهلا', 'هلا', 'سلام', 'صباح', 'مساء', 'hi', 'hello'];
    return greetings.some(g => message.includes(g));
  }

  async getGovernorateAQI(governorate) {
    try {
      const stations = excelParser.getStations();
      const govStations = stations.filter(s => s.governorate === governorate);
      
      if (govStations.length === 0) {
        return null;
      }
      
      let totalAQI = 0;
      let stationCount = 0;
      
      for (const station of govStations.slice(0, 3)) {
        const data = excelParser.getStationData(station.name_ar);
        if (Object.keys(data).length > 0) {
          let stationAQI = 0;
          for (const [pollutant, values] of Object.entries(data)) {
            const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
            if (aqi > stationAQI) stationAQI = aqi;
          }
          totalAQI += stationAQI;
          stationCount++;
        }
      }
      
      if (stationCount === 0) {
        return Math.floor(Math.random() * 100) + 50;
      }
      
      return Math.round(totalAQI / stationCount);
      
    } catch (error) {
      console.error('Error getting AQI:', error);
      return Math.floor(Math.random() * 100) + 50;
    }
  }

  async getGovernoratePollutants(governorate) {
    try {
      const stations = excelParser.getStations();
      const govStations = stations.filter(s => s.governorate === governorate);
      
      if (govStations.length === 0) {
        return null;
      }
      
      const data = excelParser.getStationData(govStations[0].name_ar);
      return data;
      
    } catch (error) {
      console.error('Error getting pollutants:', error);
      return null;
    }
  }

  async getPollutionData(governorate) {
    const aqi = await this.getGovernorateAQI(governorate);
    
    if (aqi === null) {
      return `عذراً، لا توجد بيانات كافية عن جودة الهواء في ${governorate}. هل تريد الاستعلام عن محافظة أخرى؟`;
    }
    
    let statusText = '';
    let advice = '';
    
    if (aqi <= 50) {
      statusText = 'جيد';
      advice = 'الهواء نقي ومناسب لجميع الأنشطة الخارجية. استمتع بيومك!';
    } else if (aqi <= 100) {
      statusText = 'مقبول';
      advice = 'الهواء مقبول. الفئات الحساسة (أطفال، كبار السن، مرضى الربو) يفضلون تقليل النشاط الخارجي الطويل.';
    } else if (aqi <= 150) {
      statusText = 'غير صحي للمجموعات الحساسة';
      advice = 'غير صحي للمجموعات الحساسة. تجنب الأنشطة الخارجية الطويلة وارتد كمامة عند الخروج.';
    } else if (aqi <= 200) {
      statusText = 'غير صحي';
      advice = 'غير صحي للجميع. تجنب الخروج غير الضروري، أغلق النوافذ، واستخدم جهاز تنقية الهواء.';
    } else {
      statusText = 'خطير';
      advice = 'خطير جدا! ابق في المنزل، أغلق جميع النوافذ، ارتد كمامة إذا اضطررت للخروج.';
    }
    
    const pollutants = await this.getGovernoratePollutants(governorate);
    let pollutantsText = '';
    
    if (pollutants && Object.keys(pollutants).length > 0) {
      pollutantsText = '\n\nتفاصيل الملوثات:\n';
      for (const [key, value] of Object.entries(pollutants)) {
        let name = '';
        switch(key) {
          case 'PM2.5': name = 'PM2.5 (الجسيمات الدقيقة)'; break;
          case 'PM10': name = 'PM10 (الجسيمات الخشنة)'; break;
          case 'CO': name = 'CO (أول أكسيد الكربون)'; break;
          case 'NO2': name = 'NO2 (ثاني أكسيد النيتروجين)'; break;
          case 'SO2': name = 'SO2 (ثاني أكسيد الكبريت)'; break;
          case 'O3': name = 'O3 (الأوزون)'; break;
          default: name = key;
        }
        pollutantsText += `- ${name}: ${value.value} ${value.unit}\n`;
      }
    }
    
    return `حالة التلوث في ${governorate}\n\nمستوى التلوث: ${statusText}\nمؤشر جودة الهواء (AQI): ${aqi}\nالنصيحة: ${advice}${pollutantsText}\n\nآخر تحديث: ${new Date().toLocaleTimeString('ar-EG')}`;
  }

  getDefaultPollutionResponse() {
    return 'يمكنني مساعدتك في معرفة حالة التلوث في أي محافظة مصرية.\n\nمثال: اكتب "التلوث في القاهرة" أو "جودة الهواء في الإسكندرية"\n\nالمحافظات المتاحة: القاهرة، الجيزة، الإسكندرية، الدقهلية، الفيوم، أسيوط، قنا، الأقصر، أسوان، وغيرها.';
  }

  async getHealthAdvice(aqi, governorate) {
    if (aqi === null) {
      aqi = await this.getGovernorateAQI(governorate);
    }
    
    if (aqi === null) {
      return this.getGeneralHealthAdvice();
    }
    
    let advice = '';
    
    if (aqi <= 50) {
      advice = 'نصيحة صحية:\n\nجودة الهواء ممتازة! يمكنك:\n- ممارسة الرياضة في الهواء الطلق\n- فتح النوافذ لتهوية المنزل\n- أخذ الأطفال للتنزه في الحدائق';
    } else if (aqi <= 100) {
      advice = 'نصيحة صحية:\n\nجودة الهواء مقبولة. ينصح:\n- الفئات الحساسة تقلل الأنشطة الخارجية\n- تهوية المنزل في الصباح الباكر\n- ارتداء كمامة إذا كنت تعاني من حساسية صدر';
    } else if (aqi <= 150) {
      advice = 'نصيحة صحية:\n\nجودة الهواء غير صحية للمجموعات الحساسة. ينصح:\n- الأطفال وكبار السن ومرضى الربو البقاء في المنزل\n- ارتداء كمامة N95 عند الخروج\n- إغلاق النوافذ واستخدام جهاز تنقية الهواء\n- تناول مضادات الحساسية إذا لزم الأمر';
    } else if (aqi <= 200) {
      advice = 'نصيحة صحية - مهم جدا:\n\nجودة الهواء غير صحية للجميع. يجب:\n- تجنب الخروج نهائيا إلا للضرورة القصوى\n- إغلاق جميع النوافذ بإحكام\n- تشغيل أجهزة تنقية الهواء\n- ارتداء كمامة N95 في جميع الأوقات عند الخروج\n- مراقبة الأعراض التنفسية واستشارة الطبيب';
    } else {
      advice = 'حالة طوارئ صحية:\n\nجودة الهواء خطيرة جدا! إجراءات عاجلة:\n- البقاء في المنزل وعدم الخروج إطلاقا\n- إغلاق جميع النوافذ والأبواب\n- استخدام جهاز تنقية الهواء على أعلى درجة\n- شرب الكثير من الماء\n- الاتصال بالطبيب فور ظهور أي أعراض تنفسية';
    }
    
    return `${advice}\n\nلمحافظة ${governorate}\nمؤشر AQI: ${aqi}`;
  }

  getGeneralHealthAdvice() {
    return 'نصائح عامة لجودة هواء أفضل:\n\n1. نباتات منزلية: أضف نباتات مثل الصبار والسانسيفيريا لتنقية الهواء\n2. تهوية منتظمة: افتح النوافذ في الصباح الباكر عندما يكون الهواء أنقى\n3. كمامات: استخدم كمامات N95 في أيام التلوث العالي\n4. ترطيب: حافظ على رطوبة منزلك بين 40-60%\n5. لا للتدخين: تجنب التدخين داخل المنزل\n6. تغيير الفلاتر: غير فلاتر مكيف الهواء بانتظام\n\nاسألني عن حالة التلوث في محافظتك للحصول على نصائح مخصصة!';
  }

  async getForecast(governorate) {
    const aqi = await this.getGovernorateAQI(governorate);
    const forecast = aqiCalculator.generateWeeklyForecast(aqi || 50, governorate);
    
    let forecastText = `توقعات جودة الهواء لـ ${governorate}\n\n`;
    
    for (let i = 0; i < 5; i++) {
      const day = forecast[i];
      forecastText += `${day.day} (${day.date}): AQI ${day.aqi} - ${day.category}\n`;
    }
    
    forecastText += '\nملاحظة: هذه توقعات تقريبية بناء على البيانات الحالية.';
    
    return forecastText;
  }

  getDefaultForecastResponse() {
    return 'للحصول على توقعات جودة الهواء، اكتب:\n\n- "توقعات القاهرة"\n- "طقس الغد في الإسكندرية"\n- "توقعات الأسبوع في الجيزة"';
  }

  async getPollutantsDetails(governorate) {
    const pollutants = await this.getGovernoratePollutants(governorate);
    const aqi = await this.getGovernorateAQI(governorate);
    
    if (!pollutants || Object.keys(pollutants).length === 0) {
      return this.getGeneralPollutantsInfo();
    }
    
    let response = `تفاصيل الملوثات في ${governorate}\n\n`;
    response += `إجمالي AQI: ${aqi}\n\n`;
    response += `الملوثات الرئيسية:\n`;
    
    for (const [key, value] of Object.entries(pollutants)) {
      let name = '';
      let safeLevel = '';
      let status = '';
      
      switch(key) {
        case 'PM2.5':
          name = 'الجسيمات الدقيقة PM2.5';
          safeLevel = 'المستوى الآمن: أقل من 12';
          status = value.value <= 12 ? 'جيد' : value.value <= 35 ? 'متوسط' : 'مرتفع';
          break;
        case 'PM10':
          name = 'الجسيمات الخشنة PM10';
          safeLevel = 'المستوى الآمن: أقل من 54';
          status = value.value <= 54 ? 'جيد' : value.value <= 154 ? 'متوسط' : 'مرتفع';
          break;
        case 'CO':
          name = 'أول أكسيد الكربون CO';
          safeLevel = 'المستوى الآمن: أقل من 4.4 ppm';
          status = value.value <= 4.4 ? 'جيد' : value.value <= 9.4 ? 'متوسط' : 'مرتفع';
          break;
        case 'NO2':
          name = 'ثاني أكسيد النيتروجين NO2';
          safeLevel = 'المستوى الآمن: أقل من 50 ppb';
          status = value.value <= 50 ? 'جيد' : value.value <= 100 ? 'متوسط' : 'مرتفع';
          break;
        case 'SO2':
          name = 'ثاني أكسيد الكبريت SO2';
          safeLevel = 'المستوى الآمن: أقل من 50 ppb';
          status = value.value <= 50 ? 'جيد' : value.value <= 100 ? 'متوسط' : 'مرتفع';
          break;
        case 'O3':
          name = 'الأوزون O3';
          safeLevel = 'المستوى الآمن: أقل من 0.054 ppm';
          status = value.value <= 0.054 ? 'جيد' : value.value <= 0.07 ? 'متوسط' : 'مرتفع';
          break;
        default:
          name = key;
          safeLevel = '';
          status = '';
      }
      
      response += `\n- ${name}: ${value.value} ${value.unit}\n`;
      response += `  ${safeLevel}\n`;
      response += `  الحالة: ${status}\n`;
    }
    
    return response;
  }

  getGeneralPollutantsInfo() {
    return 'الملوثات الهوائية الرئيسية وتأثيراتها:\n\nPM2.5 - جسيمات دقيقة (أقل من 2.5 ميكرون) تخترق الرئتين ومجرى الدم\nPM10 - جسيمات خشنة تسبب مشاكل تنفسية\nCO - أول أكسيد الكربون، غاز سام يقلل وصول الأكسجين للجسم\nNO2 - يهيج الجهاز التنفسي ويزيد من خطر الربو\nSO2 - يسبب مشاكل في الجهاز التنفسي ويساهم في الأمطار الحمضية\nO3 - الأوزون على مستوى الأرض يسبب تهيج الرئتين\n\nهل تريد معرفة القيم الحالية في منطقتك؟';
  }

  getHelpMessage() {
    return 'كيف يمكنني مساعدتك؟\n\nأنا مساعدك الذكي لجودة الهواء. يمكنك سؤالي عن:\n\n- جودة الهواء: اكتب "التلوث في القاهرة"\n- نصائح صحية: اكتب "نصيحة صحية للجيزة"\n- الملوثات: اكتب "ملوثات الإسكندرية"\n- التوقعات: اكتب "توقعات الغد للدقهلية"\n\nأو فقط اسألني أي سؤال يتعلق بالبيئة وجودة الهواء!';
  }
}

class RecommendationService {
  getRecommendations(aqi, governorate, hour = new Date().getHours()) {
    const recommendations = {
      outdoor: [],
      indoor: [],
      health: [],
      alerts: []
    };

    if (aqi <= 50) {
      recommendations.outdoor = [
        { activity: 'المشي', description: 'ممتاز للمشي في الهواء الطلق', duration: '30-60 دقيقة' },
        { activity: 'الجري', description: 'وقت رائع للجري', duration: '20-40 دقيقة' },
        { activity: 'ركوب الدراجة', description: 'استمتع بركوب الدراجة', duration: 'ساعة' },
        { activity: 'يوجا', description: 'ممارسة اليوجا في الحديقة', duration: '30 دقيقة' }
      ];
      recommendations.alerts.push('وقت ممتاز للأنشطة الخارجية');
    } else if (aqi <= 100) {
      recommendations.outdoor = [
        { activity: 'المشي الخفيف', description: 'المشي مسموح مع أخذ الحيطة', duration: '30 دقيقة' },
        { activity: 'يوجا', description: 'مناسبة لليوجا في الهواء الطلق', duration: '30 دقيقة' }
      ];
      recommendations.health = [
        'الفئات الحساسة (أطفال، كبار السن، مرضى الربو) تحد من النشاط الخارجي',
        'ارتد كمامة إذا كنت ستخرج لفترة طويلة'
      ];
    } else if (aqi <= 150) {
      recommendations.indoor = [
        { activity: 'تمارين منزلية', description: 'مارس الرياضة في المنزل', duration: '30 دقيقة' },
        { activity: 'قراءة', description: 'وقت مناسب للقراءة', duration: 'ساعة' },
        { activity: 'أنشطة فنية', description: 'الرسم أو الحرف اليدوية', duration: 'ساعة' }
      ];
      recommendations.health = [
        'ارتد كمامة N95 عند الخروج',
        'خذ أدوية الحساسية إذا كنت تعاني من الربو',
        'أغلق النوافذ واستخدم جهاز تنقية الهواء'
      ];
      recommendations.alerts.push('جودة الهواء غير صحية للمجموعات الحساسة');
    } else {
      recommendations.indoor = [
        { activity: 'البقاء في المنزل', description: 'تجنب الخروج قدر الإمكان', duration: 'طوال اليوم' },
        { activity: 'ألعاب داخلية', description: 'أنشطة ترفيهية داخل المنزل', duration: 'ساعتين' },
        { activity: 'الطبخ', description: 'جرب وصفات جديدة', duration: 'ساعة' }
      ];
      recommendations.health = [
        'خطر - ابق في المنزل وأغلق جميع النوافذ',
        'استخدم جهاز تنقية الهواء إذا كان متوفرا',
        'حافظ على رطوبة منزلك',
        'استشر طبيبك إذا شعرت بأعراض تنفسية'
      ];
      recommendations.alerts.push('تحذير: جودة الهواء خطيرة - تجنب الخروج تماما');
    }

    if (hour < 8) {
      recommendations.outdoor.unshift({ activity: 'وقت الصباح', description: 'جودة الهواء في أفضل حالاتها صباحا', duration: 'قبل شروق الشمس' });
    } else if (hour > 16) {
      recommendations.outdoor.push({ activity: 'وقت المساء', description: 'الهواء أنقى بعد غروب الشمس', duration: 'بعد المغرب' });
    } else {
      recommendations.health.push('تجنب الخروج في ساعات الظهيرة حيث يكون التلوث في أعلى مستوياته');
    }

    return recommendations;
  }

  getDailyTip() {
    const tips = [
      { title: 'نباتات منزلية', tip: 'أضف نباتات مثل الصبار والسانسيفيريا لتنقية هواء منزلك' },
      { title: 'تهوية المنزل', tip: 'قم بتهوية المنزل في الصباح الباكر عندما يكون الهواء أنقى' },
      { title: 'ارتداء الكمامة', tip: 'في أيام التلوث العالي، ارتد كمامة N95 عند الخروج' },
      { title: 'ترطيب الجو', tip: 'حافظ على رطوبة منزلك بين 40-60% لتقليل الجسيمات العالقة' },
      { title: 'تقليل القيادة', tip: 'استخدم وسائل النقل العامة أو الدراجة لتقليل انبعاثات السيارات' },
      { title: 'إعادة التدوير', tip: 'قلل من حرق المخلفات بإعادة التدوير والتحويل إلى سماد عضوي' }
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }
}

class DashboardService {
  async getDashboardSummary(userId) {
    try {
      const user = await User.findById(userId);
      const stations = excelParser.getStations();
      const allStationsData = excelParser.getAllStationsData();
      
      const governoratesAQI = [];
      const governorates = [...new Set(stations.map(s => s.governorate))];
      
      for (const gov of governorates) {
        const govStations = stations.filter(s => s.governorate === gov);
        let totalAQI = 0;
        let stationCount = 0;
        
        for (const station of govStations.slice(0, 3)) {
          const data = excelParser.getStationData(station.name_ar);
          if (Object.keys(data).length > 0) {
            let stationAQI = 0;
            for (const [pollutant, values] of Object.entries(data)) {
              const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
              if (aqi > stationAQI) stationAQI = aqi;
            }
            totalAQI += stationAQI;
            stationCount++;
          }
        }
        
        const avgAQI = stationCount > 0 ? Math.round(totalAQI / stationCount) : Math.floor(Math.random() * 100) + 50;
        const details = aqiCalculator.getAQIDetails(avgAQI);
        
        governoratesAQI.push({
          governorate: gov,
          aqi: avgAQI,
          category: details.category,
          color: details.color,
          stationCount: govStations.length
        });
      }
      
      governoratesAQI.sort((a, b) => b.aqi - a.aqi);
      
      const complaintsStats = await Complaint.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      const complaintsTotal = await Complaint.countDocuments();
      const complaintsByType = await Complaint.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]);
      
      let currentAQI = 50;
      let currentPollutants = {};
      
      if (user && user.governorate) {
        const govStations = stations.filter(s => s.governorate === user.governorate);
        if (govStations.length > 0) {
          const data = excelParser.getStationData(govStations[0].name_ar);
          if (Object.keys(data).length > 0) {
            let maxAQI = 0;
            for (const [pollutant, values] of Object.entries(data)) {
              const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
              if (aqi > maxAQI) maxAQI = aqi;
              currentPollutants[pollutant] = values;
            }
            currentAQI = maxAQI;
          }
        }
      }
      
      const weeklyForecast = aqiCalculator.generateWeeklyForecast(currentAQI, user?.governorate || 'القاهرة');
      
      const weeklyTrend = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        weeklyTrend.push({
          date: date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }),
          aqi: Math.max(20, Math.min(200, currentAQI + (Math.random() * 30) - 15)),
          dayName: this.getDayNameArabic(date.getDay())
        });
      }
      
      return {
        success: true,
        data: {
          currentAQI,
          currentCategory: aqiCalculator.getAQIDetails(currentAQI).category,
          currentColor: aqiCalculator.getAQIDetails(currentAQI).color,
          currentAdvice: aqiCalculator.getAQIDetails(currentAQI).advice,
          pollutants: currentPollutants,
          topPolluted: governoratesAQI.slice(0, 5),
          leastPolluted: governoratesAQI.slice(-5).reverse(),
          allGovernorates: governoratesAQI,
          weeklyTrend,
          weeklyForecast,
          complaints: {
            total: complaintsTotal,
            pending: complaintsStats.find(s => s._id === 'pending')?.count || 0,
            in_progress: complaintsStats.find(s => s._id === 'in_progress')?.count || 0,
            resolved: complaintsStats.find(s => s._id === 'resolved')?.count || 0,
            rejected: complaintsStats.find(s => s._id === 'rejected')?.count || 0,
            byType: complaintsByType
          },
          stationsCount: stations.length,
          governoratesCount: governorates.length,
          lastUpdated: new Date()
        }
      };
    } catch (error) {
      console.error('Dashboard error:', error);
      throw error;
    }
  }
  
  getDayNameArabic(dayIndex) {
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return days[dayIndex];
  }
}

const excelFilePath = path.join(__dirname, 'data', 'data.xlsx');
const excelParser = new ExcelParser(excelFilePath);
const aqiCalculator = new AQICalculator();
const locationService = new LocationService();
const notificationService = new NotificationService();
const chatbotService = new ChatbotService();
const recommendationService = new RecommendationService();
const dashboardService = new DashboardService();

// خريطة المحافظات لأسماء المحطات في Excel
const governorateStationMap = {
  'القاهرة': 'العباسية',
  'الجيزة': 'المهندسين',
  'الإسكندرية': 'بشاير الخير',
  'الدقهلية': 'المنصورة',
  'الفيوم': 'كلية علوم الفيوم',
  'أسيوط': 'مدينة اسيوط',
  'قنا': 'قنا',
};

const generateToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password -fcmToken');
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'المستخدم غير موجود' });
      }
      req.user.lastActive = new Date();
      await req.user.save();
      next();
    } catch (error) {
      res.status(401).json({ success: false, message: 'غير مصرح به' });
    }
  } else {
    res.status(401).json({ success: false, message: 'لا يوجد توكن' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.isAdmin()) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'ممنوع - مشرفين فقط' });
  }
};

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, governorate, phone } = req.body;

    if (await User.findOne({ email })) {
      return res.status(400).json({ success: false, message: 'البريد موجود بالفعل' });
    }

    const user = new User({ name, email, password, governorate: governorate || '', phone: phone || '' });
    await user.save();

    await notificationService.sendToUser(user._id, {
      title: '🎉 مرحباً بك في AERION',
      body: `أهلاً ${name}، نتمنى لك يوماً صحياً!`,
      type: 'welcome'
    });

    res.json({
      success: true,
      token: generateToken(user._id),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        governorate: user.governorate,
        role: user.role,
        favoriteStations: user.favoriteStations,
        notifications: user.notifications
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
    }

    user.lastLogin = new Date();
    user.loginCount += 1;
    if (fcmToken) user.fcmToken = fcmToken;
    await user.save();

    res.json({
      success: true,
      token: generateToken(user._id),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        governorate: user.governorate,
        role: user.role,
        favoriteStations: user.favoriteStations,
        notifications: user.notifications
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

// ==================== USER ROUTES ====================
app.get('/api/users/profile', protect, (req, res) => {
  res.json({ success: true, user: req.user });
});

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

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

// ==================== LOCATION ROUTES ====================

// تحديث موقع المستخدم الحالي
app.put('/api/users/location', protect, async (req, res) => {
  try {
    const { latitude, longitude, address, accuracy } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'خط الطول ودائرة العرض مطلوبين' });
    }
    
    const user = await User.findById(req.user._id);
    
    const oldLocation = user.currentLocation;
    
    user.currentLocation = {
      latitude,
      longitude,
      address: address || null,
      accuracy: accuracy || null,
      updatedAt: new Date()
    };
    
    if (user.locationSettings.saveHistory) {
      user.locationHistory.push({
        latitude,
        longitude,
        address: address || null,
        timestamp: new Date(),
        accuracy: accuracy || null
      });
      
      const retentionDays = user.locationSettings.historyRetentionDays || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      user.locationHistory = user.locationHistory.filter(h => new Date(h.timestamp) > cutoffDate);
    }
    
    if (user.governorate === '' && address) {
      const govMatch = locationService.getAllGovernorates().find(gov => address.includes(gov));
      if (govMatch) {
        user.governorate = govMatch;
      }
    }
    
    await user.save();
    
    res.json({ 
      success: true, 
      message: 'تم تحديث الموقع',
      data: { 
        currentLocation: user.currentLocation,
        governorate: user.governorate,
        historyCount: user.locationHistory.length
      }
    });
    
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ success: false, message: 'خطأ في تحديث الموقع' });
  }
});

// جلب موقع المستخدم الحالي
app.get('/api/users/location', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    res.json({ 
      success: true, 
      data: {
        currentLocation: user.currentLocation,
        lastUpdated: user.currentLocation?.updatedAt,
        locationSettings: user.locationSettings
      }
    });
    
  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب الموقع' });
  }
});

// جلب تاريخ مواقع المستخدم
app.get('/api/users/location/history', protect, async (req, res) => {
  try {
    const { limit = 50, days = 7 } = req.query;
    const user = await User.findById(req.user._id);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
    
    const history = user.locationHistory
      .filter(h => new Date(h.timestamp) > cutoffDate)
      .slice(-parseInt(limit))
      .reverse();
    
    res.json({ 
      success: true, 
      data: {
        history,
        total: user.locationHistory.length,
        limit: parseInt(limit),
        days: parseInt(days)
      }
    });
    
  } catch (error) {
    console.error('Get location history error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب تاريخ المواقع' });
  }
});

// حذف تاريخ المواقع
app.delete('/api/users/location/history', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.locationHistory = [];
    await user.save();
    
    res.json({ success: true, message: 'تم حذف تاريخ المواقع' });
    
  } catch (error) {
    console.error('Delete location history error:', error);
    res.status(500).json({ success: false, message: 'خطأ في حذف تاريخ المواقع' });
  }
});

// جلب المستخدمين القريبين
app.get('/api/users/nearby', protect, async (req, res) => {
  try {
    const { radius = 5 } = req.query;
    const currentUser = await User.findById(req.user._id);
    
    if (!currentUser.currentLocation || !currentUser.currentLocation.latitude) {
      return res.status(400).json({ success: false, message: 'لم يتم تحديث موقعك بعد' });
    }
    
    const allUsers = await User.find({
      _id: { $ne: req.user._id },
      isActive: true,
      'locationSettings.shareLocation': true,
      'currentLocation.latitude': { $ne: null }
    });
    
    const nearbyUsers = [];
    
    for (const user of allUsers) {
      if (!user.currentLocation || !user.currentLocation.latitude) continue;
      
      const distance = locationService.calculateDistance(
        currentUser.currentLocation.latitude,
        currentUser.currentLocation.longitude,
        user.currentLocation.latitude,
        user.currentLocation.longitude
      );
      
      if (distance <= parseFloat(radius)) {
        nearbyUsers.push({
          id: user._id,
          name: user.name,
          email: user.email,
          distance: Math.round(distance * 100) / 100,
          lastActive: user.lastActive,
          currentLocation: user.locationSettings.shareWithFriends ? user.currentLocation : null
        });
      }
    }
    
    nearbyUsers.sort((a, b) => a.distance - b.distance);
    
    res.json({
      success: true,
      data: {
        users: nearbyUsers,
        count: nearbyUsers.length,
        radius: parseFloat(radius)
      }
    });
    
  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخدمين القريبين' });
  }
});

// طلب مشاركة الموقع مع مستخدم آخر
app.post('/api/location/share/request', protect, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
    }
    
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    
    const existingShare = await LocationShare.findOne({
      userId: req.user._id,
      sharedWithUserId: userId,
      status: { $in: ['pending', 'accepted'] }
    });
    
    if (existingShare) {
      return res.status(400).json({ success: false, message: 'طلب مشاركة موجود بالفعل' });
    }
    
    const shareRequest = await LocationShare.create({
      userId: req.user._id,
      sharedWithUserId: userId,
      status: 'pending'
    });
    
    await notificationService.sendToUser(userId, {
      title: 'طلب مشاركة موقع',
      body: `${req.user.name} يريد مشاركة موقعك معك`,
      type: 'location_share',
      data: { requestId: shareRequest._id, userId: req.user._id, userName: req.user.name }
    });
    
    res.json({
      success: true,
      message: 'تم إرسال طلب المشاركة',
      data: shareRequest
    });
    
  } catch (error) {
    console.error('Share request error:', error);
    res.status(500).json({ success: false, message: 'خطأ في إرسال طلب المشاركة' });
  }
});

// الرد على طلب مشاركة الموقع (قبول أو رفض)
app.put('/api/location/share/respond/:requestId', protect, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body;
    
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'الحالة غير صحيحة' });
    }
    
    const shareRequest = await LocationShare.findById(requestId);
    
    if (!shareRequest) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }
    
    if (shareRequest.sharedWithUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح به' });
    }
    
    shareRequest.status = status;
    await shareRequest.save();
    
    if (status === 'accepted') {
      const requestingUser = await User.findById(shareRequest.userId);
      
      await notificationService.sendToUser(shareRequest.userId, {
        title: 'تم قبول طلب مشاركة الموقع',
        body: `${req.user.name} قبل طلب مشاركة الموقع`,
        type: 'location_share',
        data: { userId: req.user._id, userName: req.user.name }
      });
    }
    
    res.json({
      success: true,
      message: status === 'accepted' ? 'تم قبول الطلب' : 'تم رفض الطلب',
      data: shareRequest
    });
    
  } catch (error) {
    console.error('Share response error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الرد على الطلب' });
  }
});

// جلب موقع مستخدم آخر (بعد الموافقة)
app.get('/api/location/user/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (userId === req.user._id.toString()) {
      const user = await User.findById(userId);
      return res.json({
        success: true,
        data: {
          location: user.currentLocation,
          isOwnLocation: true
        }
      });
    }
    
    const shareRequest = await LocationShare.findOne({
      $or: [
        { userId: req.user._id, sharedWithUserId: userId, status: 'accepted' },
        { userId: userId, sharedWithUserId: req.user._id, status: 'accepted' }
      ]
    });
    
    if (!shareRequest) {
      return res.status(403).json({ success: false, message: 'لا يوجد إذن لمشاركة الموقع' });
    }
    
    const targetUser = await User.findById(userId);
    
    if (!targetUser.locationSettings.shareLocation || !targetUser.locationSettings.shareWithFriends) {
      return res.status(403).json({ success: false, message: 'المستخدم أوقف مشاركة الموقع' });
    }
    
    res.json({
      success: true,
      data: {
        userId: targetUser._id,
        name: targetUser.name,
        location: targetUser.currentLocation,
        lastActive: targetUser.lastActive
      }
    });
    
  } catch (error) {
    console.error('Get user location error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب موقع المستخدم' });
  }
});

// إعدادات مشاركة الموقع
app.put('/api/location/settings', protect, async (req, res) => {
  try {
    const { shareLocation, shareWithFriends, saveHistory, historyRetentionDays } = req.body;
    const user = await User.findById(req.user._id);
    
    if (shareLocation !== undefined) user.locationSettings.shareLocation = shareLocation;
    if (shareWithFriends !== undefined) user.locationSettings.shareWithFriends = shareWithFriends;
    if (saveHistory !== undefined) user.locationSettings.saveHistory = saveHistory;
    if (historyRetentionDays !== undefined) user.locationSettings.historyRetentionDays = historyRetentionDays;
    
    await user.save();
    
    res.json({
      success: true,
      message: 'تم تحديث إعدادات الموقع',
      data: user.locationSettings
    });
    
  } catch (error) {
    console.error('Location settings error:', error);
    res.status(500).json({ success: false, message: 'خطأ في تحديث الإعدادات' });
  }
});

// ==================== NOTIFICATION ROUTES ====================
app.get('/api/notifications', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await notificationService.getUserNotifications(req.user._id, parseInt(page), parseInt(limit));
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الإشعارات' });
  }
});

app.put('/api/notifications/:id/read', protect, async (req, res) => {
  try {
    await notificationService.markAsRead(req.params.id, req.user._id);
    res.json({ success: true, message: 'تم التحديث' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الإشعار' });
  }
});

app.put('/api/notifications/read-all', protect, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user._id);
    res.json({ success: true, message: 'تم تحديث الكل' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الإشعارات' });
  }
});

app.post('/api/notifications/token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    await notificationService.updateUserToken(req.user._id, token);
    res.json({ success: true, message: 'تم تحديث token' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث token' });
  }
});

// ==================== MANUAL NOTIFICATION ROUTES (ADMIN ONLY) ====================

app.post('/api/notifications/send-to-user', protect, adminOnly, async (req, res) => {
  try {
    const { userId, title, body, type, data } = req.body;
    
    if (!userId || !title || !body) {
      return res.status(400).json({ 
        success: false, 
        message: 'userId, title, body مطلوبين' 
      });
    }
    
    const notification = await notificationService.sendToUser(userId, {
      title,
      body,
      type: type || 'system',
      data: data || {}
    });
    
    res.json({ 
      success: true, 
      message: 'تم إرسال الإشعار',
      data: notification 
    });
    
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({ success: false, message: 'خطأ في إرسال الإشعار' });
  }
});

app.post('/api/notifications/send-to-all', protect, adminOnly, async (req, res) => {
  try {
    const { title, body, type, data } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({ 
        success: false, 
        message: 'title, body مطلوبين' 
      });
    }
    
    const results = await notificationService.sendToAllUsers({
      title,
      body,
      type: type || 'system',
      data: data || {}
    });
    
    res.json({ 
      success: true, 
      message: `تم إرسال الإشعار لـ ${results.length} مستخدم`,
      count: results.length 
    });
    
  } catch (error) {
    console.error('Send to all error:', error);
    res.status(500).json({ success: false, message: 'خطأ في إرسال الإشعارات' });
  }
});

app.post('/api/notifications/send-to-governorate', protect, adminOnly, async (req, res) => {
  try {
    const { governorate, title, body, type, data } = req.body;
    
    if (!governorate || !title || !body) {
      return res.status(400).json({ 
        success: false, 
        message: 'governorate, title, body مطلوبين' 
      });
    }
    
    const users = await User.find({ 
      governorate: governorate, 
      notifications: true 
    });
    
    const userIds = users.map(u => u._id);
    const results = await notificationService.sendToMultipleUsers(userIds, {
      title,
      body,
      type: type || 'system',
      data: data || {}
    });
    
    res.json({ 
      success: true, 
      message: `تم إرسال الإشعار لـ ${results.length} مستخدم في ${governorate}`,
      count: results.length 
    });
    
  } catch (error) {
    console.error('Send to governorate error:', error);
    res.status(500).json({ success: false, message: 'خطأ في إرسال الإشعارات' });
  }
});

// ==================== COMPLAINT ROUTES ====================
app.post('/api/complaints', protect, upload.array('images', 5), async (req, res) => {
  try {
    let complaintData;
    let imageUrls = [];

    if (req.files && req.files.length > 0) {
      imageUrls = req.files.map(file => `/uploads/${file.filename}`);
      
      if (req.body.data) {
        complaintData = JSON.parse(req.body.data);
      } else {
        complaintData = req.body;
      }
    } else {
      complaintData = req.body;
    }

    if (!complaintData.title || !complaintData.description || !complaintData.type || !complaintData.address) {
      return res.status(400).json({
        success: false,
        message: 'جميع الحقول مطلوبة: العنوان، الوصف، النوع، الموقع'
      });
    }

    let location = complaintData.location;
    if (!location) {
      location = {
        latitude: parseFloat(complaintData.latitude),
        longitude: parseFloat(complaintData.longitude),
        address: complaintData.address
      };
    }

    const complaint = new Complaint({
      userId: req.user._id,
      title: complaintData.title,
      description: complaintData.description,
      type: complaintData.type,
      location: location,
      address: complaintData.address,
      images: imageUrls
    });

    await complaint.save();

    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } });
    await notificationService.sendToMultipleUsers(admins.map(a => a._id), {
      title: 'شكوى جديدة',
      body: `من ${req.user.name}: ${complaint.title}`,
      type: 'complaint_update',
      data: { complaintId: complaint._id }
    });

    res.status(201).json({
      success: true,
      message: 'تم إرسال الشكوى بنجاح',
      data: complaint
    });

  } catch (error) {
    console.error('Complaint creation error:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في إنشاء الشكوى'
    });
  }
});

app.get('/api/complaints', protect, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = req.user.isAdmin() ? {} : { userId: req.user._id };
    if (status) query.status = status;

    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .populate('userId', 'name email')
        .populate('resolvedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Complaint.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: complaints,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الشكاوى' });
  }
});

app.get('/api/complaints/:id', protect, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
      .populate('userId', 'name email phone')
      .populate('resolvedBy', 'name');

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    }

    if (!req.user.isAdmin() && complaint.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح بمشاهدة هذه الشكوى' });
    }

    res.json({ success: true, data: complaint });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الشكوى' });
  }
});

app.put('/api/complaints/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    }

    complaint.status = status;
    if (adminNotes) complaint.adminNotes = adminNotes;

    if (status === 'resolved') {
      complaint.resolvedAt = new Date();
      complaint.resolvedBy = req.user._id;
    }

    await complaint.save();

    await notificationService.sendComplaintUpdate(complaint.userId, complaint);

    res.json({
      success: true,
      message: 'تم تحديث حالة الشكوى',
      data: complaint
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الشكوى' });
  }
});

app.delete('/api/complaints/:id', protect, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'الشكوى غير موجودة' });
    }

    if (!req.user.isAdmin() && complaint.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح بحذف هذه الشكوى' });
    }

    if (complaint.images && complaint.images.length > 0) {
      complaint.images.forEach(imagePath => {
        const fullPath = path.join(__dirname, imagePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      });
    }

    await complaint.deleteOne();
    res.json({ success: true, message: 'تم حذف الشكوى' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في حذف الشكوى' });
  }
});

app.get('/api/complaints/stats/summary', protect, adminOnly, async (req, res) => {
  try {
    const stats = await Complaint.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Complaint.countDocuments();
    const result = {
      total,
      pending: 0,
      in_progress: 0,
      resolved: 0,
      rejected: 0
    };

    stats.forEach(stat => {
      result[stat._id] = stat.count;
    });

    res.json({ success: true, data: result });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الإحصائيات' });
  }
});

// ==================== AIR QUALITY ROUTES ====================
app.get('/api/air-quality/nearby', async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'الرجاء إرسال الموقع' });
    }

    if (!locationService.isValidEgyptLocation(parseFloat(lat), parseFloat(lng))) {
      return res.status(400).json({ success: false, message: 'الموقع خارج مصر' });
    }

    const stations = excelParser.getStations();

    let nearestStation = null;
    let minDistance = Infinity;

    for (const station of stations) {
      const govCoords = locationService.getGovernorateCoords(station.governorate);
      const distance = locationService.calculateDistance(
        parseFloat(lat), parseFloat(lng),
        govCoords.lat, govCoords.lng
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestStation = station;
      }
    }

    if (!nearestStation) {
      return res.status(404).json({ success: false, message: 'لا توجد محطات قريبة' });
    }

    const stationData = excelParser.getStationData(nearestStation.name_ar);

    const pollutants = [];
    let maxAQI = 0;

    for (const [pollutant, data] of Object.entries(stationData)) {
      const aqi = aqiCalculator.calculatePollutantAQI(pollutant, data.value);
      pollutants.push({
        code: pollutant,
        value: data.value,
        unit: data.unit,
        aqi
      });

      if (aqi > maxAQI) maxAQI = aqi;
    }

    const aqiDetails = aqiCalculator.getAQIDetails(maxAQI);

    res.json({
      success: true,
      data: {
        station: {
          name: nearestStation.name_ar,
          governorate: nearestStation.governorate
        },
        distance: Math.round(minDistance * 10) / 10,
        aqi: maxAQI,
        category: aqiDetails.category,
        color: aqiDetails.color,
        advice: aqiDetails.advice,
        recommendation: aqiCalculator.getRecommendation(maxAQI, nearestStation.governorate),
        pollutants,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('Error in nearby:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

app.get('/api/air-quality/governorates', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const governorates = locationService.getAllGovernorates();
    
    const result = [];
    
    for (const gov of governorates) {
      const govStations = stations.filter(s => s.governorate === gov);
      
      let totalAQI = 0;
      let stationCount = 0;
      
      for (const station of govStations.slice(0, 2)) {
        const data = excelParser.getStationData(station.name_ar);
        if (Object.keys(data).length > 0) {
          let stationAQI = 0;
          for (const [pollutant, values] of Object.entries(data)) {
            const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
            if (aqi > stationAQI) stationAQI = aqi;
          }
          totalAQI += stationAQI;
          stationCount++;
        }
      }
      
      const avgAQI = stationCount > 0 ? Math.round(totalAQI / stationCount) : Math.floor(Math.random() * 100) + 50;
      const details = aqiCalculator.getAQIDetails(avgAQI);
      
      result.push({
        name: gov,
        aqi: avgAQI,
        category: details.category,
        color: details.color,
        stations: govStations.length
      });
    }
    
    result.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json({ success: true, data: result });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

app.get('/api/air-quality/governorate/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const stations = excelParser.getStations();

    const govStations = stations.filter(s => s.governorate === name);

    if (govStations.length === 0) {
      return res.status(404).json({ success: false, message: 'المحافظة غير موجودة' });
    }

    const stationsData = [];
    let totalAQI = 0;

    for (const station of govStations) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      const pollutants = [];

      for (const [pollutant, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
        pollutants.push({
          code: pollutant,
          value: values.value,
          unit: values.unit,
          aqi
        });
        if (aqi > stationAQI) stationAQI = aqi;
      }

      totalAQI += stationAQI;

      stationsData.push({
        id: station.name_ar,
        name: station.name_ar,
        aqi: stationAQI,
        pollutants
      });
    }

    const avgAQI = Math.round(totalAQI / govStations.length);
    const details = aqiCalculator.getAQIDetails(avgAQI);

    res.json({
      success: true,
      data: {
        name,
        avgAQI,
        category: details.category,
        color: details.color,
        advice: details.advice,
        stations: stationsData,
        coordinates: locationService.getGovernorateCoords(name)
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

// ==================== WEEKLY FORECAST ROUTES ====================
app.get('/api/air-quality/weekly-forecast', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const governorates = [...new Set(stations.map(s => s.governorate))];

    const forecastData = [];

    for (const gov of governorates) {
      const govStations = stations.filter(s => s.governorate === gov);

      let totalAQI = 0;
      let stationCount = 0;

      for (const station of govStations.slice(0, 2)) {
        const data = excelParser.getStationData(station.name_ar);
        if (Object.keys(data).length > 0) {
          let stationAQI = 0;
          for (const [pollutant, values] of Object.entries(data)) {
            const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
            if (aqi > stationAQI) stationAQI = aqi;
          }
          totalAQI += stationAQI;
          stationCount++;
        }
      }

      const baseAQI = stationCount > 0
        ? Math.round(totalAQI / stationCount)
        : Math.floor(Math.random() * 100) + 50;

      const forecast = aqiCalculator.generateWeeklyForecast(baseAQI, gov);

      forecastData.push({
        governorate: gov,
        currentAQI: baseAQI,
        forecast: forecast
      });
    }

    forecastData.sort((a, b) => a.governorate.localeCompare(b.governorate));

    res.json({
      success: true,
      data: forecastData
    });

  } catch (error) {
    console.error('Weekly forecast error:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب تنبؤات الأسبوع'
    });
  }
});

app.get('/api/air-quality/weekly-forecast/:governorate', async (req, res) => {
  try {
    const { governorate } = req.params;

    const stations = excelParser.getStations();
    const govStations = stations.filter(s => s.governorate === governorate);

    if (govStations.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'المحافظة غير موجودة'
      });
    }

    let totalAQI = 0;
    let stationCount = 0;

    for (const station of govStations.slice(0, 3)) {
      const data = excelParser.getStationData(station.name_ar);
      if (Object.keys(data).length > 0) {
        let stationAQI = 0;
        for (const [pollutant, values] of Object.entries(data)) {
          const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
          if (aqi > stationAQI) stationAQI = aqi;
        }
        totalAQI += stationAQI;
        stationCount++;
      }
    }

    const baseAQI = stationCount > 0
      ? Math.round(totalAQI / stationCount)
      : Math.floor(Math.random() * 100) + 50;

    const forecast = aqiCalculator.generateWeeklyForecast(baseAQI, governorate);

    res.json({
      success: true,
      data: {
        governorate,
        currentAQI: baseAQI,
        forecast: forecast
      }
    });

  } catch (error) {
    console.error('Governorate forecast error:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب التنبؤات'
    });
  }
});

// ==================== PUBLIC AIR QUALITY API (بدون توكن) ====================

// جودة الهواء لمحافظة معينة - بدون مصادقة
app.get('/api/public/air-quality/:stationName', async (req, res) => {
  try {
    const { stationName } = req.params;
    
    // بيانات حقيقية من Excel (آخر يوم)
    const realData = {
      'العباسية': {
        pm25: 15.79, pm10: 44.35, co: 1.8, no2: 69.38, so2: 19.90, o3: 23.66,
        aqi: 69, category: 'متوسط', advice: 'جودة الهواء مقبولة - الفئات الحساسة توخ الحذر'
      },
      'المهندسين': {
        pm25: 20.25, pm10: 92.20, co: 1.8, no2: 76.80, so2: 7.61, o3: 23.66,
        aqi: 77, category: 'متوسط', advice: 'جودة الهواء مقبولة - الفئات الحساسة توخ الحذر'
      },
      'المتحف المصري الكبير': {
        pm25: 27.34, pm10: 158.88, co: 1.8, no2: 27.34, so2: 4.14, o3: 23.66,
        aqi: 150, category: 'غير صحي للمجموعات الحساسة', advice: 'تجنب الأنشطة الخارجية الطويلة - ارتد كمامة'
      },
      '6 اكتوبر': {
        pm25: 18.18, pm10: 99.08, co: 1.8, no2: 69.38, so2: 4.03, o3: 23.66,
        aqi: 71, category: 'متوسط', advice: 'جودة الهواء مقبولة - الفئات الحساسة توخ الحذر'
      },
      'بشاير الخير': {
        pm25: 21.61, pm10: 36.00, co: 6.35, no2: 76.80, so2: 7.61, o3: 36.00,
        aqi: 71, category: 'متوسط', advice: 'جودة الهواء مقبولة - الفئات الحساسة توخ الحذر'
      },
      'المنصورة': {
        pm25: 15.79, pm10: 60.46, co: 1.8, no2: 69.38, so2: 19.90, o3: 23.66,
        aqi: 60, category: 'متوسط', advice: 'جودة الهواء مقبولة - الفئات الحساسة توخ الحذر'
      },
      'كلية علوم الفيوم': {
        pm25: 15.79, pm10: 72.96, co: 1.8, no2: 69.38, so2: 19.90, o3: 23.66,
        aqi: 73, category: 'متوسط', advice: 'جودة الهواء مقبولة - الفئات الحساسة توخ الحذر'
      },
      'مدينة اسيوط': {
        pm25: 15.79, pm10: 178.17, co: 1.8, no2: 69.38, so2: 19.90, o3: 23.66,
        aqi: 124, category: 'غير صحي للمجموعات الحساسة', advice: 'تجنب الأنشطة الخارجية الطويلة - ارتد كمامة'
      },
      'قنا': {
        pm25: 15.79, pm10: 148.46, co: 1.8, no2: 69.38, so2: 19.90, o3: 23.66,
        aqi: 148, category: 'غير صحي للمجموعات الحساسة', advice: 'تجنب الأنشطة الخارجية الطويلة - ارتد كمامة'
      },
    };
    
    const data = realData[stationName] || realData['العباسية'];
    
    const pollutants = [
      { code: 'PM2.5', value: data.pm25, unit: 'μg/m³' },
      { code: 'PM10', value: data.pm10, unit: 'μg/m³' },
      { code: 'CO', value: data.co, unit: 'ppm' },
      { code: 'NO₂', value: data.no2, unit: 'ppb' },
      { code: 'SO₂', value: data.so2, unit: 'ppb' },
      { code: 'O₃', value: data.o3, unit: 'ppm' },
    ];
    
    let color = '';
    if (data.aqi <= 50) color = '#00E400';
    else if (data.aqi <= 100) color = '#FFFF00';
    else if (data.aqi <= 150) color = '#FF7E00';
    else if (data.aqi <= 200) color = '#FF0000';
    else color = '#8F3F97';

    res.json({
      success: true,
      data: {
        governorate: stationName,
        aqi: data.aqi,
        category: data.category,
        color: color,
        advice: data.advice,
        pollutants: pollutants,
        station: stationName,
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// جلب جميع المحطات من Excel
app.get('/api/public/all-stations', async (req, res) => {
  try {
    const workbook = xlsx.readFile(excelFilePath);
    const sheet = workbook.Sheets['PM10'];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    
    // الصف الثاني (index 1) فيه أسماء المحطات
    const headers = data[1] || [];
    const stations = [];
    
    for (let i = 1; i < headers.length; i++) {
      const stationName = headers[i]?.toString().trim();
      if (stationName && stationName !== '') {
        stations.push(stationName);
      }
    }
    
    res.json({
      success: true,
      stations: stations,
      count: stations.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TEST ENDPOINTS ====================
// TEST endpoint لفحص قراءة Excel
app.get('/api/test/excel', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const testStation = 'العباسية';
    const data = excelParser.getStationData(testStation);
    
    res.json({
      stations: stations,
      testStation: testStation,
      stationData: data
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// TEST endpoint لفحص أسماء الأوراق
app.get('/api/test/sheets', async (req, res) => {
  try {
    const workbook = xlsx.readFile(excelFilePath);
    const sheetNames = workbook.SheetNames;
    
    res.json({
      filePath: excelFilePath,
      fileExists: fs.existsSync(excelFilePath),
      sheetNames: sheetNames,
      firstSheetData: sheetNames.length > 0 ? xlsx.utils.sheet_to_json(workbook.Sheets[sheetNames[0]], { header: 1 }) : []
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// TEST endpoint لفحص جميع الأوراق
app.get('/api/test/all-sheets', async (req, res) => {
  try {
    const workbook = xlsx.readFile(excelFilePath);
    const result = {};
    
    const sheets = ['PM10', 'PM2.5', 'SO2', 'NO2', 'CO', 'O3'];
    
    for (const sheetName of sheets) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        result[sheetName] = 'Sheet not found';
        continue;
      }
      
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const headers = data[1] || [];
      result[sheetName] = {
        headers: headers.slice(0, 5),
        rowCount: data.length
      };
    }
    
    res.json(result);
  } catch (error) {
    res.json({ error: error.message });
  }
});

// TEST endpoint لفحص SO2 و NO2
app.get('/api/test/so2-no2', async (req, res) => {
  try {
    const workbook = xlsx.readFile(excelFilePath);
    const result = {};
    
    const sheets = ['SO2', 'NO2'];
    
    for (const sheetName of sheets) {
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      
      result[sheetName] = {
        firstRow: data[0],
        secondRow: data[1],
        thirdRow: data[2],
        lastRow: data[data.length - 1],
        rowCount: data.length
      };
    }
    
    res.json(result);
  } catch (error) {
    res.json({ error: error.message });
  }
});

// TEST endpoint لفحص O3
app.get('/api/test/o3', async (req, res) => {
  try {
    const workbook = xlsx.readFile(excelFilePath);
    const sheet = workbook.Sheets['O3'];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    
    // آخر 5 قيم لـ "العباسية"
    const headers = data[1];
    let colIndex = -1;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === 'العباسية') {
        colIndex = i;
        break;
      }
    }
    
    const lastValues = [];
    for (let i = data.length - 1; i >= data.length - 10; i--) {
      if (data[i] && data[i][colIndex]) {
        lastValues.push(data[i][colIndex]);
      }
    }
    
    res.json({
      columnIndex: colIndex,
      last10Values: lastValues,
      rawData: data.slice(data.length - 5, data.length)
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// TEST endpoint لفحص بيانات المحطة مباشرة
app.get('/api/test/station/:name', async (req, res) => {
  try {
    const stationName = req.params.name;
    const data = excelParser.getStationData(stationName);
    
    // جلب أول 5 صفوف من Excel للفحص
    const workbook = xlsx.readFile(excelFilePath);
    const sheet = workbook.Sheets['PM10'];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    res.json({
      stationName: stationName,
      stationData: data,
      firstFewRows: rows.slice(0, 5),
      headers: rows[0]
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ==================== MAP ROUTES ====================
app.get('/api/map/stations', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const stationsWithData = [];

    for (const station of stations) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      let pollutants = [];
      
      for (const [pollutant, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
        pollutants.push({
          code: pollutant,
          value: values.value,
          unit: values.unit,
          aqi
        });
        if (aqi > stationAQI) stationAQI = aqi;
      }
      
      const coordinates = locationService.getGovernorateCoords(station.governorate);
      
      stationsWithData.push({
        id: station.name_ar,
        name: station.name_ar,
        governorate: station.governorate,
        aqi: stationAQI || Math.floor(Math.random() * 100) + 50,
        coordinates: {
          lat: coordinates.lat,
          lng: coordinates.lng
        },
        pollutants: pollutants,
        status: stationAQI <= 50 ? 'good' : stationAQI <= 100 ? 'moderate' : stationAQI <= 150 ? 'unhealthy' : 'danger',
        lastUpdated: new Date()
      });
    }

    res.json({
      success: true,
      data: stationsWithData,
      total: stationsWithData.length
    });

  } catch (error) {
    console.error('Map stations error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب محطات الخريطة' });
  }
});

app.get('/api/map/complaints', protect, async (req, res) => {
  try {
    const complaints = await Complaint.find({ status: { $ne: 'resolved' } })
      .select('title type location address status createdAt')
      .limit(100);

    const complaintsWithCoords = complaints.map(complaint => ({
      id: complaint._id,
      title: complaint.title,
      type: complaint.type,
      status: complaint.status,
      address: complaint.address,
      coordinates: {
        lat: complaint.location.latitude,
        lng: complaint.location.longitude
      },
      createdAt: complaint.createdAt
    }));

    res.json({
      success: true,
      data: complaintsWithCoords,
      total: complaintsWithCoords.length
    });

  } catch (error) {
    console.error('Map complaints error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب شكاوى الخريطة' });
  }
});

app.get('/api/map/heatmap', async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const heatmapData = [];

    for (const station of stations) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      
      for (const [pollutant, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
        if (aqi > stationAQI) stationAQI = aqi;
      }
      
      const coordinates = locationService.getGovernorateCoords(station.governorate);
      
      heatmapData.push({
        lat: coordinates.lat,
        lng: coordinates.lng,
        intensity: stationAQI / 300,
        aqi: stationAQI,
        name: station.name_ar,
        governorate: station.governorate
      });
    }

    res.json({
      success: true,
      data: heatmapData
    });

  } catch (error) {
    console.error('Heatmap error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات الحرارة' });
  }
});

// ==================== DASHBOARD ROUTES ====================
app.get('/api/dashboard/summary', protect, async (req, res) => {
  try {
    const dashboardData = await dashboardService.getDashboardSummary(req.user._id);
    res.json(dashboardData);
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات لوحة التحكم' });
  }
});

app.get('/api/dashboard/trends', protect, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const stations = excelParser.getStations();
    
    const trends = [];
    const days = period === 'week' ? 7 : period === 'month' ? 30 : 365;
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      trends.push({
        date: date.toISOString().split('T')[0],
        aqi: Math.floor(Math.random() * 150) + 20,
        pm25: Math.floor(Math.random() * 50) + 5,
        pm10: Math.floor(Math.random() * 80) + 10
      });
    }
    
    res.json({
      success: true,
      data: {
        period,
        trends,
        average: trends.reduce((sum, t) => sum + t.aqi, 0) / trends.length,
        max: Math.max(...trends.map(t => t.aqi)),
        min: Math.min(...trends.map(t => t.aqi))
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الاتجاهات' });
  }
});

// ==================== RECOMMENDATIONS ROUTES ====================
app.get('/api/recommendations', protect, async (req, res) => {
  try {
    let currentAQI = 50;
    let governorate = req.user.governorate || 'القاهرة';
    
    if (governorate) {
      const stations = excelParser.getStations();
      const govStations = stations.filter(s => s.governorate === governorate);
      
      if (govStations.length > 0) {
        const data = excelParser.getStationData(govStations[0].name_ar);
        let maxAQI = 0;
        for (const [pollutant, values] of Object.entries(data)) {
          const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
          if (aqi > maxAQI) maxAQI = aqi;
        }
        currentAQI = maxAQI || 50;
      }
    }
    
    const recommendations = recommendationService.getRecommendations(currentAQI, governorate);
    const dailyTip = recommendationService.getDailyTip();
    
    res.json({
      success: true,
      data: {
        aqi: currentAQI,
        governorate,
        category: aqiCalculator.getAQIDetails(currentAQI).category,
        recommendations,
        dailyTip,
        lastUpdated: new Date()
      }
    });
    
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب التوصيات' });
  }
});

app.get('/api/recommendations/daily-tip', protect, async (req, res) => {
  try {
    const tip = recommendationService.getDailyTip();
    res.json({ success: true, data: tip });
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في جلب النصيحة' });
  }
});

// ==================== CHATBOT ROUTES ====================
app.post('/api/chatbot/message', protect, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
    }
    
    const reply = await chatbotService.processMessage(req.user._id, message);
    
    res.json({
      success: true,
      data: {
        reply,
        timestamp: new Date()
      }
    });
    
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ success: false, message: 'خطأ في معالجة الرسالة' });
  }
});

app.get('/api/chatbot/history', protect, async (req, res) => {
  try {
    const session = await ChatSession.findOne({ userId: req.user._id, isActive: true });
    
    if (!session) {
      return res.json({ success: true, data: { messages: [] } });
    }
    
    const messages = session.messages.slice(-20);
    
    res.json({
      success: true,
      data: { messages }
    });
    
  } catch (error) {
    console.error('Chat history error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب تاريخ المحادثة' });
  }
});

app.delete('/api/chatbot/history', protect, async (req, res) => {
  try {
    await ChatSession.findOneAndDelete({ userId: req.user._id });
    
    await chatbotService.getOrCreateSession(req.user._id);
    
    res.json({ success: true, message: 'تم مسح تاريخ المحادثة' });
    
  } catch (error) {
    console.error('Clear chat error:', error);
    res.status(500).json({ success: false, message: 'خطأ في مسح المحادثة' });
  }
});

// ==================== AI PREDICTION ROUTE ====================
app.post("/api/predict", async (req, res) => {
  try {
    console.log('Prediction request received:', req.body);

    const response = await axios.post(
      "http://127.0.0.1:5001/predict",
      req.body,
      {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('AI response received:', response.data);
    res.json(response.data);

  } catch (error) {
    console.error('AI prediction error:', error.message);

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        success: false, 
        error: "AI server is not running",
        message: "خادم الذكاء الاصطناعي غير متاح. تأكد من تشغيله على port 5001"
      });
    }

    if (error.code === 'ETIMEDOUT') {
      return res.status(504).json({ 
        success: false, 
        error: "AI server timeout",
        message: "الخادم لم يستجب في الوقت المحدد"
      });
    }

    res.status(500).json({ 
      success: false, 
      error: "AI prediction failed",
      message: error.message 
    });
  }
});

// ==================== ALERTS ROUTES ====================
app.get('/api/alerts', protect, async (req, res) => {
  const alerts = await Alert.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: alerts });
});

app.post('/api/alerts', protect, async (req, res) => {
  try {
    const alert = new Alert({ ...req.body, userId: req.user._id });
    await alert.save();
    res.status(201).json({ success: true, data: alert });
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء التنبيه' });
  }
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
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في التحديث' });
  }
});

// ==================== REPORTS ROUTES ====================
app.get('/api/reports', protect, async (req, res) => {
  const reports = await Report.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: reports });
});

app.post('/api/reports', protect, async (req, res) => {
  try {
    const report = new Report({ ...req.body, userId: req.user._id });
    await report.save();
    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء التقرير' });
  }
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
      User.countDocuments(),
      User.countDocuments({ role: { $in: ['admin', 'super_admin'] } }),
      Complaint.countDocuments(),
      Alert.countDocuments(),
      Report.countDocuments()
    ]);

    res.json({
      success: true,
      data: { totalUsers, totalAdmins, totalComplaints, totalAlerts, totalReports }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الإحصائيات' });
  }
});

app.put('/api/admin/users/:id/role', protect, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    
    user.role = role;
    await user.save();
    
    res.json({ success: true, message: 'تم تحديث الدور', data: { id: user._id, role: user.role } });
    
  } catch (error) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الدور' });
  }
});

// ==================== RECOMMENDATIONS API (ديناميكية) ====================

// جلب توصيات ديناميكية بناءً على AQI والموقع
app.get('/api/recommendations/dynamic', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const { governorate, aqi } = req.query;
    
    const currentAQI = aqi ? parseInt(aqi) : 50;
    const locationName = governorate || req.user.governorate || 'القاهرة';
    
    const recommendations = [];
    
    // توصيات حسب AQI
    if (currentAQI <= 50) {
      recommendations.push({
        type: 'outdoor',
        title: '🌿 وقت ممتاز للأنشطة الخارجية',
        subtitle: `جودة الهواء ممتازة في ${locationName} اليوم - يمكنك ممارسة الرياضة بحرية`,
        priority: 'high',
        action: 'outdoor_activities'
      });
    } else if (currentAQI <= 100) {
      recommendations.push({
        type: 'caution',
        title: '⚠️ جودة الهواء مقبولة',
        subtitle: `يمكنك الخروج ولكن تجنب المجهود الشديد في ${locationName}`,
        priority: 'medium',
        action: 'wear_mask'
      });
    } else if (currentAQI <= 150) {
      recommendations.push({
        type: 'warning',
        title: '😷 غير صحي للمجموعات الحساسة',
        subtitle: `ارتد كمامة عند الخروج وقلل الأنشطة الخارجية في ${locationName}`,
        priority: 'high',
        action: 'stay_indoor'
      });
    } else {
      recommendations.push({
        type: 'danger',
        title: '🚫 جودة الهواء خطيرة',
        subtitle: `تجنب الخروج غير الضروري وأغلق النوافذ في ${locationName}`,
        priority: 'critical',
        action: 'emergency'
      });
    }
    
    // توصيات إضافية حسب الوقت
    const hour = new Date().getHours();
    if (hour >= 5 && hour <= 8) {
      recommendations.push({
        type: 'tip',
        title: '🌅 أفضل وقت للتنزه',
        subtitle: 'جودة الهواء في أفضل حالاتها صباحاً - استمتع بالهواء النقي',
        priority: 'medium',
        action: 'morning_walk'
      });
    } else if (hour >= 12 && hour <= 16) {
      recommendations.push({
        type: 'warning',
        title: '☀️ تجنب الظهيرة',
        subtitle: 'ذروة التلوث في هذه الأوقات - أفضل البقاء في المنزل',
        priority: 'high',
        action: 'avoid_noon'
      });
    } else if (hour >= 18 && hour <= 21) {
      recommendations.push({
        type: 'tip',
        title: '🌙 وقت المساء',
        subtitle: 'الهواء أنقى بعد غروب الشمس - وقت مناسب للمشي الخفيف',
        priority: 'low',
        action: 'evening_walk'
      });
    }
    
    // توصية عن الملوث الرئيسي
    if (req.query.pollutants) {
      try {
        const pollutants = JSON.parse(req.query.pollutants);
        let maxPollutant = null;
        let maxValue = 0;
        
        for (const [key, value] of Object.entries(pollutants)) {
          if (value > maxValue) {
            maxValue = value;
            maxPollutant = key;
          }
        }
        
        if (maxPollutant) {
          const pollutantNames = {
            'PM2.5': 'الجسيمات الدقيقة',
            'PM10': 'الجسيمات الخشنة',
            'CO': 'أول أكسيد الكربون',
            'NO2': 'ثاني أكسيد النيتروجين',
            'SO2': 'ثاني أكسيد الكبريت',
            'O3': 'الأوزون'
          };
          
          recommendations.push({
            type: 'info',
            title: '📊 الملوث الرئيسي',
            subtitle: `الملوث ${pollutantNames[maxPollutant] || maxPollutant} هو الأعلى تركيزاً اليوم`,
            priority: 'low',
            action: 'check_pollutants'
          });
        }
      } catch (e) {}
    }
    
    res.json({
      success: true,
      data: recommendations
    });
    
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== LOCATION API ====================

// تحديث موقع المستخدم (للأقرب محطة)
app.put('/api/user/location', protect, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'الموقع مطلوب' });
    }
    
    const user = await User.findById(req.user._id);
    user.currentLocation = { latitude, longitude, updatedAt: new Date() };
    await user.save();
    
    // جلب أقرب محطة
    const stations = excelParser.getStations();
    let nearestStation = null;
    let minDistance = Infinity;
    
    for (const station of stations) {
      const coords = locationService.getGovernorateCoords(station.governorate);
      const distance = locationService.calculateDistance(
        latitude, longitude,
        coords.lat, coords.lng
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestStation = station;
      }
    }
    
    res.json({
      success: true,
      data: {
        location: user.currentLocation,
        nearestStation: nearestStation ? {
          name: nearestStation.name_ar,
          governorate: nearestStation.governorate,
          distance: Math.round(minDistance * 10) / 10
        } : null
      }
    });
    
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// جلب أقرب محطة
app.get('/api/user/nearest-station', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user.currentLocation || !user.currentLocation.latitude) {
      return res.status(404).json({ success: false, message: 'الموقع غير متوفر' });
    }
    
    const stations = excelParser.getStations();
    let nearestStation = null;
    let minDistance = Infinity;
    
    for (const station of stations) {
      const coords = locationService.getGovernorateCoords(station.governorate);
      const distance = locationService.calculateDistance(
        user.currentLocation.latitude, user.currentLocation.longitude,
        coords.lat, coords.lng
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestStation = station;
      }
    }
    
    // جلب AQI للمحطة الأقرب
    const stationData = excelParser.getStationData(nearestStation.name_ar);
    let aqi = 0;
    for (const [pollutant, values] of Object.entries(stationData)) {
      const pollutantAQI = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
      if (pollutantAQI > aqi) aqi = pollutantAQI;
    }
    
    res.json({
      success: true,
      data: {
        station: {
          name: nearestStation.name_ar,
          governorate: nearestStation.governorate,
          distance: Math.round(minDistance * 10) / 10,
          aqi: aqi
        }
      }
    });
    
  } catch (error) {
    console.error('Error getting nearest station:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== SHARE AQI ====================

// مشاركة AQI (توليد نص للمشاركة)
app.get('/api/share/aqi', protect, async (req, res) => {
  try {
    const { aqi, category, governorate } = req.query;
    
    let emoji = '🌿';
    let status = '';
    
    if (aqi <= 50) {
      emoji = '🟢';
      status = 'ممتازة';
    } else if (aqi <= 100) {
      emoji = '🟡';
      status = 'مقبولة';
    } else if (aqi <= 150) {
      emoji = '🟠';
      status = 'غير صحية للمجموعات الحساسة';
    } else if (aqi <= 200) {
      emoji = '🔴';
      status = 'غير صحية';
    } else {
      emoji = '⚫';
      status = 'خطيرة';
    }
    
    const shareText = `${emoji} AERION - جودة الهواء في ${governorate || 'مدينتي'}\n\n` +
      `📊 مؤشر جودة الهواء: ${aqi}\n` +
      `🏷️ التصنيف: ${category}\n` +
      `💡 الحالة: ${status}\n\n` +
      `حمّل تطبيق AERION لمتابعة جودة الهواء في منطقتك 🌿`;
    
    res.json({
      success: true,
      data: {
        text: shareText,
        aqi: aqi,
        category: category
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== APP RATING ====================

// تسجيل أن المستخدم طلب تقييم
app.post('/api/rating/request', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.lastRatingRequest = new Date();
    user.ratingRequestsCount = (user.ratingRequestsCount || 0) + 1;
    await user.save();
    
    res.json({ success: true, message: 'Rating request logged' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// تسجيل أن المستخدم قيم التطبيق
app.post('/api/rating/submit', protect, async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    const user = await User.findById(req.user._id);
    user.hasRated = true;
    user.userRating = rating;
    user.ratingFeedback = feedback;
    await user.save();
    
    res.json({ success: true, message: 'Thank you for your rating!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== CRON JOBS ====================

// إرسال إشعارات تلوث عالي للمستخدمين القريبين
const checkAndSendAlerts = async () => {
  try {
    const stations = excelParser.getStations();
    const highPollutionStations = [];
    
    for (const station of stations) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      for (const [pollutant, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
        if (aqi > stationAQI) stationAQI = aqi;
      }
      
      if (stationAQI > 150) {
        highPollutionStations.push({
          station: station.name_ar,
          governorate: station.governorate,
          aqi: stationAQI
        });
      }
    }
    
    for (const alert of highPollutionStations) {
      await notificationService.sendAQIAlert(alert.station, alert.aqi, alert.governorate);
    }
    
    console.log(`✅ Checked alerts - ${highPollutionStations.length} high pollution stations`);
  } catch (error) {
    console.error('Error checking alerts:', error);
  }
};

// جدولة فحص التلوث كل ساعة
cron.schedule('0 * * * *', async () => {
  console.log('🔍 Running scheduled pollution check...');
  await checkAndSendAlerts();
});

// إرسال توصيات يومية للمستخدمين
cron.schedule('0 9 * * *', async () => {
  console.log('📧 Sending daily recommendations...');
  
  try {
    const users = await User.find({ notifications: true });
    
    for (const user of users) {
      let aqi = 50;
      if (user.governorate) {
        const stations = excelParser.getStations();
        const govStations = stations.filter(s => s.governorate === user.governorate);
        if (govStations.length > 0) {
          const data = excelParser.getStationData(govStations[0].name_ar);
          let maxAQI = 0;
          for (const [pollutant, values] of Object.entries(data)) {
            const pollutantAQI = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
            if (pollutantAQI > maxAQI) maxAQI = pollutantAQI;
          }
          aqi = maxAQI;
        }
      }
      
      let message = '';
      if (aqi <= 50) message = '🌿 جودة الهواء ممتازة اليوم، استمتع بنشاطاتك الخارجية!';
      else if (aqi <= 100) message = '⚠️ جودة الهواء مقبولة، الفئات الحساسة توخ الحذر.';
      else if (aqi <= 150) message = '😷 جودة الهواء غير صحية، ارتد كمامة عند الخروج.';
      else message = '🚫 جودة الهواء خطيرة، ابق في المنزل إن أمكن.';
      
      await notificationService.sendToUser(user._id, {
        title: '📊 توصية جودة الهواء اليوم',
        body: message,
        type: 'daily_tip'
      });
    }
    
    console.log(`✅ Daily recommendations sent to ${users.length} users`);
  } catch (error) {
    console.error('Error sending daily recommendations:', error);
  }
});

cron.schedule('0 */6 * * *', async () => {
  console.log('Checking air quality alerts...');
  
  try {
    const stations = excelParser.getStations();
    const alerts = await Alert.find({ active: true });
    
    for (const station of stations.slice(0, 5)) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      
      for (const [pollutant, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(pollutant, values.value);
        if (aqi > stationAQI) stationAQI = aqi;
      }
      
      if (stationAQI > 0) {
        await notificationService.sendAQIAlert(station.name_ar, stationAQI, station.governorate);
      }
    }
    
    console.log('Alerts check completed');
  } catch (error) {
    console.error('Error checking alerts:', error);
  }
});

// ==================== HEALTH CHECK ====================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Air Quality API - Full Version with Location Tracking',
    version: '5.0.0',
    status: 'Running',
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
      excelFile: fs.existsSync(excelFilePath) ? 'Available' : 'Not Available'
    },
    endpoints: {
      auth: ['POST /api/auth/register', 'POST /api/auth/login'],
      public: ['GET /api/public/air-quality/:governorate - Public air quality (no auth required)'],
      location: [
        'PUT /api/users/location - Update current location',
        'GET /api/users/location - Get current location',
        'GET /api/users/location/history - Get location history',
        'DELETE /api/users/location/history - Delete location history',
        'GET /api/users/nearby - Get nearby users',
        'POST /api/location/share/request - Request location share',
        'PUT /api/location/share/respond/:requestId - Respond to share request',
        'GET /api/location/user/:userId - Get user location (with permission)',
        'PUT /api/location/settings - Update location settings'
      ],
      airQuality: ['GET /api/air-quality/nearby', 'GET /api/air-quality/governorates', 'GET /api/air-quality/governorate/:name'],
      weeklyForecast: ['GET /api/air-quality/weekly-forecast', 'GET /api/air-quality/weekly-forecast/:governorate'],
      map: ['GET /api/map/stations', 'GET /api/map/complaints', 'GET /api/map/heatmap'],
      dashboard: ['GET /api/dashboard/summary', 'GET /api/dashboard/trends'],
      recommendations: ['GET /api/recommendations', 'GET /api/recommendations/daily-tip'],
      chatbot: ['POST /api/chatbot/message', 'GET /api/chatbot/history', 'DELETE /api/chatbot/history'],
      complaints: ['GET /api/complaints', 'POST /api/complaints', 'PUT /api/complaints/:id/status'],
      notifications: ['GET /api/notifications', 'PUT /api/notifications/:id/read', 'POST /api/notifications/send-to-user', 'POST /api/notifications/send-to-all', 'POST /api/notifications/send-to-governorate'],
      ai: ['POST /api/predict']
    }
  });
});

// Function to free up the port before starting the server
function freePort(port) {
  console.log(`🔍 Checking if port ${port} is in use...`);
  
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    
    if (output.trim()) {
      const lines = output.split('\n').filter(line => line.includes('LISTENING'));
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        
        console.log(`⚠️  Found process with PID ${pid} using port ${port}`);
        console.log(`🛑 Stopping process ${pid}...`);
        
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
          console.log(`✅ Process ${pid} stopped successfully`);
        } catch (error) {
          console.error(`❌ Failed to stop process ${pid}:`, error.message);
        }
      }
      
      console.log(`✅ Port ${port} is now free`);
    } else {
      console.log(`✅ Port ${port} is already free`);
    }
  } catch (error) {
    if (error.status === 1) {
      console.log(`✅ Port ${port} is not in use`);
    } else {
      console.error('❌ Error checking port:', error.message);
    }
  }
}

// Free the port before starting the server (only in local development)
if (process.env.NODE_ENV !== 'production') {
  freePort(PORT);
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(70));
    console.log(`Air Quality API Server v5.0.0 (Full Version with Location Tracking)`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    console.log(`Excel file: ${fs.existsSync(excelFilePath) ? 'Available' : 'Not Available'}`);
    console.log(`Uploads folder: ${fs.existsSync(uploadDir) ? 'Ready' : 'Issue'}`);
    console.log(`Map API: Available`);
    console.log(`Dashboard API: Available`);
    console.log(`Chatbot API: Available`);
    console.log(`Recommendations API: Available`);
    console.log(`Location Tracking API: Available`);
    console.log(`Manual Notifications API: Available`);
    console.log(`AI Prediction endpoint: POST /api/predict`);
    console.log('='.repeat(70));
  });
}

// Export app for Vercel serverless
module.exports = app;

