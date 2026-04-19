// Script to free port 5002 by killing any process using it
const { execSync } = require('child_process');

const PORT = process.env.PORT || 5002;

console.log(`🔍 Checking if port ${PORT} is in use...`);

try {
  // Find process using the port
 const output = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
  
  if (output.trim()) {
   const lines = output.split('\n').filter(line => line.includes('LISTENING'));
    
    for (const line of lines) {
     const parts = line.trim().split(/\s+/);
     const pid = parts[parts.length -1];
      
     console.log(`⚠️  Found process with PID ${pid} using port ${PORT}`);
     console.log(`🛑 Stopping process ${pid}...`);
      
     try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
       console.log(`✅ Process ${pid} stopped successfully`);
      } catch (error) {
       console.error(`❌ Failed to stop process ${pid}:`, error.message);
      }
    }
    
   console.log(`✅ Port ${PORT} is now free`);
  } else {
   console.log(`✅ Port ${PORT} is already free`);
  }
} catch (error) {
  if (error.status === 1) {
   console.log(`✅ Port ${PORT} is not in use`);
  } else {
   console.error('❌ Error checking port:', error.message);
  }
}
