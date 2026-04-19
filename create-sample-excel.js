// Script to create sample Excel file for testing
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Sample station names
const stations = [
  'العباسية', 'المهندسين', 'المتحف', '6 اكتوبر', 
  'بشاير الخير', 'المنصورة', 'الفيوم', 'اسيوط', 'قنا'
];

// Create sheets for different pollutants
const sheets = ['PM10', 'PM2.5', 'SO2', 'NO2', 'CO', 'O3'];

// Create workbook
const workbook = xlsx.utils.book_new();

// Generate data for each pollutant
sheets.forEach(sheetName => {
  // Header row with station names
  const header = ['التاريخ', ...stations];
  
  // Generate 10 rows of sample data
  const data = [header];
  for (let i = 0; i < 10; i++) {
   const date = new Date(2024, 0, i +1).toLocaleDateString('ar-EG');
   const values = stations.map(() => {
      // Generate random values based on pollutant type
      switch(sheetName) {
        case 'PM10': return Math.floor(Math.random() * 200) +20;
        case 'PM2.5': return Math.floor(Math.random() * 100) + 10;
        case 'SO2': return Math.floor(Math.random() * 50) + 5;
        case 'NO2': return Math.floor(Math.random() * 80) + 10;
        case 'CO': return (Math.random() * 2 + 0.5).toFixed(2);
        case 'O3': return Math.floor(Math.random() * 100) + 20;
        default: return 0;
      }
    });
    data.push([date, ...values]);
  }
  
  // Create worksheet
  const worksheet = xlsx.utils.aoa_to_sheet(data);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
});

// Write file
const filePath = path.join(dataDir, 'بيانات ملوثات الهواء لبعض محطات الشبكة لعام 2024.xlsx');
xlsx.writeFile(workbook, filePath);

console.log('✅ Excel file created successfully:', filePath);
console.log('📊 Sheets:', sheets);
console.log('🏭 Stations:', stations);
