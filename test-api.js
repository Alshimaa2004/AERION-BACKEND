const axios = require('axios');

async function testAPI() {
  try {
    console.log('Testing API endpoint...\n');
    
    const response = await axios.get('http://localhost:5002/api/public/air-quality/العباسية');
    
    console.log('Response Status:', response.status);
    console.log('\nFull Response:\n');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Check pollutants
    if (response.data.data && response.data.data.pollutants) {
      console.log('\n\nPollutants Array:');
      console.log('==================\n');
      
      response.data.data.pollutants.forEach((pollutant, index) => {
        console.log(`${index + 1}. Code: ${pollutant.code}`);
        console.log(`   Value: ${pollutant.value} ${pollutant.unit}`);
        console.log('');
      });
      
      // Verify codes
      console.log('\nPollutant Code Verification:');
      console.log('=============================\n');
      
      const expectedCodes = ['PM2.5', 'PM10', 'CO', 'NO₂', 'SO₂', 'O₃'];
      const receivedCodes = response.data.data.pollutants.map(p => p.code);
      
      for (const expected of expectedCodes) {
        const found = receivedCodes.includes(expected);
        console.log(`${expected}: ${found ? '✓ Present' : '✗ Not in response (no data in Excel)'}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testAPI();
