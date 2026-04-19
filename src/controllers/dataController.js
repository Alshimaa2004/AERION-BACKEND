const ExcelParser = require('../services/excelParser');
const AQICalculator = require('../services/aqiCalculator');
const LocationService = require('../services/locationService');
const path = require('path');

const excelParser = new ExcelParser(path.join(__dirname, '../../data/بيانات ملوثات الهواء ببعض محطات الشبكة لعام 2024.xlsx'));
const aqiCalculator = new AQICalculator();
const locationService = new LocationService();

exports.getNearby = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: 'الرجاء إرسال الموقع' });

    const stations = excelParser.getStations();
    let nearest = null, minDist = Infinity;

    for (const station of stations) {
      const coords = locationService.getGovernorateCoords(station.governorate);
      const dist = locationService.calculateDistance(parseFloat(lat), parseFloat(lng), coords.lat, coords.lng);
      if (dist < minDist) { minDist = dist; nearest = station; }
    }

    if (!nearest) return res.status(404).json({ message: 'لا توجد محطات قريبة' });

    const data = excelParser.getStationData(nearest.name_ar);
    const pollutants = [];
    let maxAQI = 0;

    for (const [code, values] of Object.entries(data)) {
      const aqi = aqiCalculator.calculatePollutantAQI(code, values.value);
      pollutants.push({ code, value: values.value, unit: values.unit, aqi });
      if (aqi > maxAQI) maxAQI = aqi;
    }

    const details = aqiCalculator.getAQIDetails(maxAQI);

    res.json({
      success: true,
      data: {
        station: { name: nearest.name_ar, governorate: nearest.governorate },
        distance: Math.round(minDist * 10) / 10,
        aqi: maxAQI,
        category: details.category,
        color: details.color,
        advice: details.advice,
        recommendation: aqiCalculator.getRecommendation(maxAQI, nearest.governorate),
        pollutants
      }
    });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.getGovernorates = async (req, res) => {
  try {
    const stations = excelParser.getStations();
    const govMap = new Map();
    
    stations.forEach(s => {
      if (!govMap.has(s.governorate)) {
        govMap.set(s.governorate, { name: s.governorate, stations: [] });
      }
      govMap.get(s.governorate).stations.push(s.name_ar);
    });

    const result = [];
    for (const [name, data] of govMap) {
      const aqi = Math.floor(Math.random() * 100) + 50;
      const details = aqiCalculator.getAQIDetails(aqi);
      result.push({ name, aqi, category: details.category, color: details.color, stations: data.stations.length });
    }
    res.json({ success: true, data: result });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.getGovernorate = async (req, res) => {
  try {
    const { name } = req.params;
    const stations = excelParser.getStations().filter(s => s.governorate === name);
    if (!stations.length) return res.status(404).json({ message: 'المحافظة غير موجودة' });

    const stationsData = [];
    let totalAQI = 0;

    for (const station of stations) {
      const data = excelParser.getStationData(station.name_ar);
      let stationAQI = 0;
      const pollutants = [];
      
      for (const [code, values] of Object.entries(data)) {
        const aqi = aqiCalculator.calculatePollutantAQI(code, values.value);
        pollutants.push({ code, value: values.value, unit: values.unit, aqi });
        if (aqi > stationAQI) stationAQI = aqi;
      }
      
      totalAQI += stationAQI;
      stationsData.push({ id: station.name_ar, name: station.name_ar, aqi: stationAQI, pollutants });
    }

    const avgAQI = Math.round(totalAQI / stations.length);
    const details = aqiCalculator.getAQIDetails(avgAQI);

    res.json({
      success: true,
      data: { name, avgAQI, category: details.category, color: details.color, advice: details.advice, stations: stationsData }
    });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};

exports.getForecast = async (req, res) => {
  try {
    const baseAQI = Math.floor(Math.random() * 100) + 50;
    res.json({ success: true, data: aqiCalculator.generateForecast(baseAQI) });
  } catch { res.status(500).json({ message: 'خطأ في الخادم' }); }
};
