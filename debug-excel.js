const xlsx = require('xlsx');
const path = require('path');

const excelFilePath = path.join(__dirname, 'data', 'data.xlsx');
const stationName = 'العباسية';

try {
  const workbook = xlsx.readFile(excelFilePath);
  
  const sheetsToCheck = ['PM10', 'PM2.5', 'SO2', 'NO2', 'CO', 'O3'];
  
  for (const sheetName of sheetsToCheck) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Sheet: ${sheetName}`);
    console.log('='.repeat(60));
    
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      console.log('❌ Sheet not found');
      continue;
    }
    
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    // Find header row
    let headerRow = null;
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      if (data[i] && data[i].length > 1 && data[i][1]) {
        headerRow = data[i];
        headerRowIndex = i;
        break;
      }
    }
    
    if (!headerRow) {
      console.log('❌ No header row found');
      continue;
    }
    
    console.log(`Header row (index ${headerRowIndex}):`, headerRow);
    
    // Find station
    let stationIndex = -1;
    for (let i = 1; i < headerRow.length; i++) {
      if (headerRow[i]?.toString().trim().includes(stationName)) {
        stationIndex = i;
        console.log(`✓ Station "${stationName}" found at index ${i}`);
        break;
      }
    }
    
    if (stationIndex === -1) {
      console.log(`❌ Station "${stationName}" not found in this sheet`);
      continue;
    }
    
    // Get last value
    for (let i = data.length - 1; i > headerRowIndex; i--) {
      const row = data[i];
      const value = row?.[stationIndex];
      if (value !== undefined && value !== null && value !== '') {
        console.log(`Last value at row ${i}: ${value}`);
        console.log(`Is number: ${!isNaN(parseFloat(value))}`);
        break;
      }
    }
  }
  
} catch (error) {
  console.error('Error:', error.message);
}
