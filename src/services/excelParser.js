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
      
      // Find the first row that has station names (usually row 1)
      let headerRow = null;
      for (let i = 0; i < Math.min(5, data.length); i++) {
        if (data[i] && data[i].length > 1 && data[i][1]) {
          headerRow = data[i];
          break;
        }
      }
      
      if (!headerRow) return [];
      
      return headerRow.slice(1).map(name => ({
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
      
      // Mapping between sheet names and standardized pollutant codes
      const sheetsMapping = [
        { sheetName: 'PM10', code: 'PM10', unit: 'μg/m³' },
        { sheetName: 'PM2.5', code: 'PM2.5', unit: 'μg/m³' },
        { sheetName: 'SO2', code: 'SO₂', unit: 'ppb' },
        { sheetName: 'NO2', code: 'NO₂', unit: 'ppb' },
        { sheetName: 'CO', code: 'CO', unit: 'ppm' },
        { sheetName: 'O3', code: 'O₃', unit: 'ppm' }
      ];
      
      for (const { sheetName, code, unit } of sheetsMapping) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        
        // Find the header row with station names
        let headerRow = null;
        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(5, data.length); i++) {
          if (data[i] && data[i].length > 1 && data[i][1]) {
            headerRow = data[i];
            headerRowIndex = i;
            break;
          }
        }
        
        if (!headerRow) continue;
        
        // Find station index in header
        let stationIndex = -1;
        for (let i = 1; i < headerRow.length; i++) {
          if (headerRow[i]?.toString().trim().includes(stationName)) {
            stationIndex = i;
            break;
          }
        }

        if (stationIndex > 0) {
          // Find the last non-empty value in the station column
          for (let i = data.length - 1; i > headerRowIndex; i--) {
            const row = data[i];
            const value = row?.[stationIndex];
            if (value !== undefined && value !== null && value !== '' && !isNaN(parseFloat(value))) {
              result[code] = {
                value: parseFloat(value),
                unit: unit
              };
              break;
            }
          }
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
      if (stationName?.includes(key)) return value;
    }
    return 'القاهرة';
  }
}

module.exports = ExcelParser;
