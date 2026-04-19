const User = require('../models/User');
const Alert = require('../models/Alert');

class NotificationService {
  constructor() {
    this.notifications = []; // للتخزين المؤقت (في حالة عدم استخدام Firebase)
  }

  /**
   * إرسال إشعار لمستخدم محدد
   */
  async sendToUser(userId, notification) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        console.log(`❌ المستخدم غير موجود: ${userId}`);
        return false;
      }

      if (!user.notifications) {
        console.log(`🔕 المستخدم عطل الإشعارات: ${user.email}`);
        return false;
      }

      // هنا هنضيف الإشعار في قاعدة البيانات
      const userNotification = {
        id: Date.now(),
        userId: user._id,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        data: notification.data || {},
        read: false,
        createdAt: new Date()
      };

      // تخزين مؤقت (لو معندكش Firebase)
      this.notifications.push(userNotification);

      // لو عايز ترسل عن طريق Firebase (FCM)
      if (user.fcmToken) {
        await this.sendFirebaseNotification(user.fcmToken, notification);
      }

      console.log(`✅ إشعار مرسل إلى ${user.email}: ${notification.title}`);
      return userNotification;
    } catch (error) {
      console.error('❌ خطأ في إرسال الإشعار:', error);
      return false;
    }
  }

  /**
   * إرسال إشعار لعدة مستخدمين
   */
  async sendToMultipleUsers(userIds, notification) {
    const results = [];
    for (const userId of userIds) {
      const result = await this.sendToUser(userId, notification);
      results.push(result);
    }
    return results;
  }

  /**
   * إرسال إشعار لجميع المستخدمين
   */
  async sendToAllUsers(notification) {
    try {
      const users = await User.find({ notifications: true });
      const userIds = users.map(u => u._id);
      return await this.sendToMultipleUsers(userIds, notification);
    } catch (error) {
      console.error('❌ خطأ في إرسال الإشعار للكل:', error);
      return [];
    }
  }

  /**
   * إرسال تنبيه عند ارتفاع AQI
   */
  async sendAQIAlert(stationName, aqiValue, governorate) {
    try {
      // البحث عن المستخدمين المهتمين بهذه المحطة
      const users = await User.find({
        $or: [
          { favoriteStations: stationName },
          { governorate: governorate }
        ],
        notifications: true
      });

      if (users.length === 0) {
        console.log('ℹ️ لا يوجد مستخدمين مهتمين بهذه المحطة');
        return;
      }

      let title, body, type;

      if (aqiValue > 200) {
        title = '🚨 تنبيه خطير: تلوث شديد';
        body = `محطة ${stationName} سجلت AQI = ${aqiValue} (خطير) - ابق في المنزل وأغلق النوافذ`;
        type = 'danger_alert';
      } else if (aqiValue > 150) {
        title = '⚠️ تنبيه: تلوث عالي';
        body = `محطة ${stationName} سجلت AQI = ${aqiValue} (غير صحي) - تجنب الخروج`;
        type = 'warning_alert';
      } else if (aqiValue > 100) {
        title = '🌫️ تنبيه: تلوث متوسط';
        body = `محطة ${stationName} سجلت AQI = ${aqiValue} - الفئات الحساسة توخ الحذر`;
        type = 'info_alert';
      } else {
        return; // مش محتاج تنبيه
      }

      const notification = {
        title,
        body,
        type,
        data: {
          station: stationName,
          aqi: aqiValue,
          governorate
        }
      };

      const userIds = users.map(u => u._id);
      await this.sendToMultipleUsers(userIds, notification);

      console.log(`📢 تم إرسال تنبيه AQI لـ ${users.length} مستخدم`);
    } catch (error) {
      console.error('❌ خطأ في إرسال تنبيه AQI:', error);
    }
  }

  /**
   * التحقق من التنبيهات المخصصة للمستخدمين
   */
  async checkUserAlerts() {
    try {
      const activeAlerts = await Alert.find({ active: true }).populate('userId');
      
      for (const alert of activeAlerts) {
        // هنا هتجيب AQI الحالي للمحطة
        const currentAQI = await this.getCurrentAQI(alert.station);
        
        if (!currentAQI) continue;

        let shouldNotify = false;

        if (alert.condition === 'above' && currentAQI > alert.threshold) {
          shouldNotify = true;
        } else if (alert.condition === 'below' && currentAQI < alert.threshold) {
          shouldNotify = true;
        }

        if (shouldNotify) {
          const notification = {
            title: '🔔 تنبيه مخصص',
            body: `محطة ${alert.station} وصلت AQI = ${currentAQI} ${alert.condition === 'above' ? 'أعلى من' : 'أقل من'} الحد الذي حددته (${alert.threshold})`,
            type: 'user_alert',
            data: {
              alertId: alert._id,
              station: alert.station,
              aqi: currentAQI,
              threshold: alert.threshold
            }
          };

          await this.sendToUser(alert.userId._id, notification);
        }
      }
    } catch (error) {
      console.error('❌ خطأ في التحقق من تنبيهات المستخدمين:', error);
    }
  }

  /**
   * إرسال توصية يومية
   */
  async sendDailyTips() {
    try {
      const tips = [
        {
          title: '🌿 نصيحة بيئية',
          body: 'زراعة النباتات المنزلية تساعد في تنقية الهواء'
        },
        {
          title: '🚗 نصيحة بيئية',
          body: 'استخدم وسائل النقل العام لتقليل التلوث'
        },
        {
          title: '😷 نصيحة صحية',
          body: 'ارتدِ الكمامة في الأيام ذات التلوث العالي'
        },
        {
          title: '🏠 نصيحة منزلية',
          body: 'أغلق النوافذ في أيام العواصف الترابية'
        },
        {
          title: '💧 نصيحة صحية',
          body: 'اشرب ماء كافي في أيام التلوث العالي'
        },
        {
          title: '📱 نصيحة تطبيق',
          body: 'شارك التطبيق مع أصدقائك لنشر الوعي البيئي'
        },
        {
          title: '🗑️ نصيحة بيئية',
          body: 'أبلغ عن أي حرق عشوائي للمخلفات من خلال التطبيق'
        }
      ];

      const randomTip = tips[Math.floor(Math.random() * tips.length)];

      const notification = {
        title: randomTip.title,
        body: randomTip.body,
        type: 'daily_tip',
        data: {}
      };

      await this.sendToAllUsers(notification);
      console.log('✅ تم إرسال التوصيات اليومية');
    } catch (error) {
      console.error('❌ خطأ في إرسال التوصيات:', error);
    }
  }

  /**
   * إرسال إشعار بتحديث شكوى
   */
  async sendComplaintUpdate(userId, complaint) {
    try {
      const statusMessages = {
        'pending': 'قيد المراجعة',
        'in_progress': 'جاري المعالجة',
        'resolved': 'تم الحل',
        'rejected': 'لم يتم القبول'
      };

      const notification = {
        title: '📋 تحديث حالة الشكوى',
        body: `شكواك "${complaint.title}" أصبحت: ${statusMessages[complaint.status]}`,
        type: 'complaint_update',
        data: {
          complaintId: complaint._id,
          status: complaint.status
        }
      };

      await this.sendToUser(userId, notification);
    } catch (error) {
      console.error('❌ خطأ في إرسال تحديث الشكوى:', error);
    }
  }

  /**
   * إرسال إشعار ترحيبي لمستخدم جديد
   */
  async sendWelcomeNotification(user) {
    const notification = {
      title: '👋 مرحباً بك في التطبيق',
      body: `أهلاً ${user.name}، يمكنك الآن متابعة جودة الهواء في منطقتك`,
      type: 'welcome',
      data: {}
    };

    await this.sendToUser(user._id, notification);
  }

  /**
   * إرسال إشعار للمشرفين
   */
  async sendToAdmins(notification) {
    try {
      const admins = await User.find({ role: 'admin', notifications: true });
      const adminIds = admins.map(a => a._id);
      return await this.sendToMultipleUsers(adminIds, notification);
    } catch (error) {
      console.error('❌ خطأ في إرسال إشعار للمشرفين:', error);
    }
  }

  /**
   * إرسال إشعار عن شكوى جديدة للمشرفين
   */
  async sendNewComplaintToAdmins(complaint, user) {
    const notification = {
      title: '📝 شكوى جديدة',
      body: `من ${user.name}: ${complaint.title}`,
      type: 'admin_complaint',
      data: {
        complaintId: complaint._id,
        userId: user._id
      }
    };

    await this.sendToAdmins(notification);
  }

  /**
   * جلب إشعارات المستخدم
   */
  async getUserNotifications(userId, page = 1, limit = 20) {
    try {
      // فلترة الإشعارات الخاصة بالمستخدم
      const userNotifications = this.notifications
        .filter(n => n.userId.toString() === userId.toString())
        .sort((a, b) => b.createdAt - a.createdAt);

      const start = (page - 1) * limit;
      const end = start + limit;

      return {
        notifications: userNotifications.slice(start, end),
        total: userNotifications.length,
        page,
        totalPages: Math.ceil(userNotifications.length / limit),
        unread: userNotifications.filter(n => !n.read).length
      };
    } catch (error) {
      console.error('❌ خطأ في جلب الإشعارات:', error);
      return { notifications: [], total: 0, page, totalPages: 0, unread: 0 };
    }
  }

  /**
   * تحديث حالة الإشعار كمقروء
   */
  async markAsRead(notificationId, userId) {
    const notification = this.notifications.find(
      n => n.id === notificationId && n.userId.toString() === userId.toString()
    );
    
    if (notification) {
      notification.read = true;
      return true;
    }
    return false;
  }

  /**
   * تحديث جميع الإشعارات كمقروءة
   */
  async markAllAsRead(userId) {
    this.notifications
      .filter(n => n.userId.toString() === userId.toString())
      .forEach(n => n.read = true);
    
    return true;
  }

  /**
   * حذف الإشعارات القديمة
   */
  async deleteOldNotifications(days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.notifications = this.notifications.filter(
      n => n.createdAt > cutoffDate
    );

    console.log(`🧹 تم حذف الإشعارات الأقدم من ${days} يوم`);
  }

  /**
   * الحصول على AQI الحالي لمحطة (مؤقت)
   */
  async getCurrentAQI(stationName) {
    // دي دالة مؤقتة - هتجبها من قاعدة البيانات
    // هنستخدم random للاختبار
    return Math.floor(Math.random() * 200) + 50;
  }

  /**
   * إرسال إشعار عن طريق Firebase (لو مستخدم)
   */
  async sendFirebaseNotification(fcmToken, notification) {
    try {
      // لو عايز تستخدم Firebase، هتحتاج تنصب المكتبة:
      // npm install firebase-admin
      
      /*
      const admin = require('firebase-admin');
      
      const message = {
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: {
          type: notification.type,
          ...notification.data
        },
        token: fcmToken
      };

      await admin.messaging().send(message);
      */
      
      console.log(`🔥 Firebase notification sent to token: ${fcmToken.substring(0, 10)}...`);
      return true;
    } catch (error) {
      console.error('❌ Firebase error:', error);
      return false;
    }
  }

  /**
   * تحديث FCM Token للمستخدم
   */
  async updateUserToken(userId, fcmToken) {
    try {
      await User.findByIdAndUpdate(userId, { fcmToken });
      console.log(`✅ تم تحديث token للمستخدم ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ خطأ في تحديث token:', error);
      return false;
    }
  }
}

module.exports = NotificationService;
