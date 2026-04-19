// Script to check MongoDB connection
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/air-quality';

console.log('🔍 Checking MongoDB connection...');
console.log('Connection String:', MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));

mongoose.connect(MONGODB_URI)
  .then(() => {
   console.log('✅ MongoDB connected successfully!');
   console.log('Database:', mongoose.connection.db.databaseName);
    mongoose.disconnect();
    process.exit(0);
  })
  .catch(err => {
   console.error('❌ MongoDB connection failed:', err.message);
   console.log('\n💡 Tips:');
   console.log('1. Make sure MongoDB is installed and running');
   console.log('2. Check if MongoDB service is started: net start MongoDB');
   console.log('3. Verify the connection string in .env file');
   console.log('4. For MongoDB Atlas, check network access and whitelist IP');
    process.exit(1);
  });
