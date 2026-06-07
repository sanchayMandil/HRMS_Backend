const mongoose = require("mongoose");

const { appLogger } = require("../shared/logger");

const connectDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing in environment variables");
  }

  try {
    const connection = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      family: 4,
    });

    appLogger.info("MongoDB connected", {
      host: connection.connection.host,
      database: connection.connection.name,
    });
  } catch (error) {
    appLogger.error("MongoDB connection failed", {
      message: error.message,
    });
    throw error;
  }
};

module.exports = connectDatabase;
