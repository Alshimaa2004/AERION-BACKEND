const mongoose = require('mongoose');
const { Pool } = require('pg');
require('dotenv').config();

// MongoDB Connection
const connectMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

// PostgreSQL Connection
const pgPool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DB,
  max: 20,
  idleTimeoutMillis: 30000,
});

const connectPostgreSQL = async () => {
  try {
    const client = await pgPool.connect();
    console.log('✅ PostgreSQL Connected');
    client.release();
  } catch (error) {
    console.error('❌ PostgreSQL Connection Error:', error.message);
  }
};

module.exports = { connectMongoDB, connectPostgreSQL, pgPool };
