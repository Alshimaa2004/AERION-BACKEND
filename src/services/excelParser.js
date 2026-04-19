const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

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
      return data[0].slice(1).map(name => ({
        name_ar: name?.toString().trim() || '',
        governorate: this.guessGovernorate(name)
      })).filter(s => s.name_ar);
    } catch (error) {
      console.error('Excel error:', error);
      return [];
    }
  }

  getStationData(stationName) {
    try {
      if (!this.fileExists()) return {};
      
      const workbook = xlsx.readFile(this.filePath);
      const result = {};
      const sheets = ['PM10', 'PM2.5', 'SO2', 'NO2', 'CO', 'O3'];
      
      for (const sheetName of sheets) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        const headers = data[0];
        
        let stationIndex = -1;
        for (let i = 1; i < headers.length; i++) {
          if (headers[i]?.toString().includes(stationName)) {
            stationIndex = i;
            break;
          }
        }

        if (stationIndex > 0) {
          for (let i = data.length - 1; i > 0; i--) {
            const row = data[i];
            const value = row?.[stationIndex];
            if (value !== undefined && value !== null && value !== '') {
              result[sheetName] = {
                value: parseFloat(value),
                unit: sheetName === 'CO' ? 'ppm' : 
                      ['SO2', 'NO2', 'O3'].includes(sheetName) ? 'ppb' : 'μg/m³'
              };
              break;
            }
          }
        }
      }
      return result;
    } catch (error) {
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
      if (stationName?.includes(key)) return value;
    }
    return 'القاهرة';
  }
}

module.exports = ExcelParser;
