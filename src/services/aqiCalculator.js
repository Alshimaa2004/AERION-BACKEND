class AQICalculator {
  calculatePollutantAQI(pollutant, value) {
    if (pollutant === 'PM2.5') {
      if (value <= 12) return Math.round((value / 12) * 50);
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
    return 50;
  }

  getAQIDetails(aqi) {
    if (aqi <= 50) return { category: 'ممتاز', color: '#00E400', advice: 'جودة الهواء ممتازة' };
    if (aqi <= 100) return { category: 'جيد', color: '#FFFF00', advice: 'جودة الهواء جيدة' };
    if (aqi <= 150) return { category: 'متوسط', color: '#FF7E00', advice: 'جودة الهواء متوسطة' };
    if (aqi <= 200) return { category: 'غير صحي', color: '#FF0000', advice: 'جودة الهواء غير صحية' };
    return { category: 'خطير', color: '#7E0023', advice: 'جودة الهواء خطيرة' };
  }

  getRecommendation(aqi, governorate) {
    if (aqi <= 50) return `🌿 جودة الهواء ممتازة في ${governorate}`;
    if (aqi <= 100) return `👍 جودة الهواء جيدة في ${governorate}`;
    if (aqi <= 150) return `⚠️ جودة الهواء متوسطة في ${governorate}`;
    if (aqi <= 200) return `🚨 جودة الهواء غير صحية في ${governorate}`;
    return `🆘 تحذير: جودة الهواء خطيرة في ${governorate}`;
  }

  generateForecast(baseAQI) {
    const days = ['الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return days.map((day, i) => {
      const aqi = Math.max(0, baseAQI + (Math.random() * 30 - 15));
      const details = this.getAQIDetails(aqi);
      return {
        date: new Date(Date.now() + (i + 1) * 86400000).toISOString().split('T')[0],
        day, aqi: Math.round(aqi),
        category: details.category,
        color: details.color
      };
    });
  }
}

module.exports = AQICalculator;
