const mongoose = require("mongoose");

const connectMongoDB = async () => {
  const DB = process.env.DATABASE.replace(
              "<password>", process.env.DATABASE_PASSWORD);

  await mongoose.connect(DB, {
    // useNewUrlParser: true,
    // useUnifiedTopology: true,
  });
  console.log("MongoDB connection successful");
};

module.exports = connectMongoDB;