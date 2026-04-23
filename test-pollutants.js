const ExcelParser = require('./src/services/excelParser');
const AQICalculator = require('./src/services/aqiCalculator');
const path = require('path');

const excelFilePath = path.join(__dirname, 'data', 'data.xlsx');
const excelParser = new ExcelParser(excelFilePath);
const aqiCalculator = new AQICalculator();

console.log('Testing Pollutant Codes Format\n');

// Test 1: Check if Excel file exists
if (!excelParser.fileExists()) {
  console.log('❌ Excel file not found at:', excelFilePath);
  process.exit(1);
}
console.log('✓ Excel file found\n');

// Test 2: Get stations
const stations = excelParser.getStations();
console.log(`✓ Found ${stations.length} stations\n`);

// Test 3: Get data for first station
if (stations.length > 0) {
  const firstStation = stations[0];
  console.log(`Testing station: ${firstStation.name_ar} (${firstStation.governorate})\n`);
  
  const stationData = excelParser.getStationData(firstStation.name_ar);
  
  console.log('Pollutants data:');
  console.log('================\n');
  
  const expectedPollutants = ['PM2.5', 'PM10', 'CO', 'NO₂', 'SO₂', 'O₃'];
  
  for (const [code, data] of Object.entries(stationData)) {
    const aqi = aqiCalculator.calculatePollutantAQI(code, data.value);
    const isExpected = expectedPollutants.includes(code);
    
    console.log(`Code: ${code}`);
    console.log(`  Value: ${data.value} ${data.unit}`);
    console.log(`  AQI: ${aqi}`);
    console.log(`  Format Correct: ${isExpected ? '✓' : '❌'}`);
    console.log('');
  }
  
  // Test 4: Verify all expected pollutants are present
  console.log('\nPollutant Code Verification:');
  console.log('===========================\n');
  
  for (const expected of expectedPollutants) {
    const found = stationData.hasOwnProperty(expected);
    console.log(`${expected}: ${found ? '✓ Found' : '❌ Not Found'}`);
  }
  
  // Test 5: Build pollutants array as per your requirement
  console.log('\n\nSample Pollutants Array (as required):');
  console.log('=====================================\n');
  
  const pollutants = [];
  for (const [code, data] of Object.entries(stationData)) {
    pollutants.push({
      code: code,
      value: data.value,
      unit: data.unit
    });
  }
  
  console.log(JSON.stringify(pollutants, null, 2));
  
} else {
  console.log('❌ No stations found in Excel file');
}

console.log('\n\n✅ Test completed successfully!');
