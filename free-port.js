const { execSync } = require('child_process');

const PORT = 5002;

console.log(`Checking if port ${PORT} is in use...\n`);

try {
  // Find process using the port
  const output = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
  const lines = output.trim().split('\n');
  
  if (lines.length > 0) {
    console.log('Found processes using port', PORT + ':');
    console.log(output);
    
    // Extract PIDs and kill them
    const pids = new Set();
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(pid)) {
        pids.add(pid);
      }
    });
    
    console.log('\nKilling processes...\n');
    
    pids.forEach(pid => {
      try {
        execSync(`taskkill /PID ${pid} /F`);
        console.log(`✓ Killed process ${pid}`);
      } catch (error) {
        console.log(`✗ Failed to kill process ${pid}: ${error.message}`);
      }
    });
    
    console.log('\n✅ Port', PORT, 'is now free!\n');
  } else {
    console.log('✅ Port', PORT, 'is already free\n');
  }
} catch (error) {
  if (error.stdout && error.stdout.includes('5002')) {
    console.log('Error parsing output:', error.message);
  } else {
    console.log('✅ Port', PORT, 'is free\n');
  }
}
