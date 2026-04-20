const mongoose = require('mongoose');

mongoose.connect("mongodb+srv://alshimaaehab22_db_user:Shimaa2004@cluster0.ioxfgeh.mongodb.net/?appName=Cluster0")
.then(() => {
    console.log("Connected to MongoDB");
})
.catch((err) => {
    console.error("Error connecting to MongoDB:", err);
});