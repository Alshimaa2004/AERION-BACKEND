
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect("mongodb+srv://alshimaa918_db_user:Shimaa2004@cluster0.vjl7eqi.mongodb.net/");
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1); // يوقف السيرفر لو فشل الاتصال
  }
};

module.exports = connectDB;