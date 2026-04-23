const xlsx = require('xlsx');
const path = require('path');

const excelFilePath = path.join(__dirname, 'data', 'data.xlsx');

try {
  const workbook = xlsx.readFile(excelFilePath);
  console.log('Available sheets in Excel file:');
  console.log('================================\n');
  console.log(workbook.SheetNames);
  
  // Check first sheet structure
  if (workbook.SheetNames.length > 0) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(firstSheet, { header: 1 });
    console.log('\n\nFirst 5 rows of first sheet:');
    console.log('================================\n');
    for (let i = 0; i < Math.min(5, data.length); i++) {
      console.log(`Row ${i}:`, data[i]);
    }
  }
} catch (error) {
  console.error('Error reading Excel file:', error.message);
}
