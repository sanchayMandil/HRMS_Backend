const dns = require("dns");
const dotenv = require("dotenv");

dotenv.config();

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = require("./app");
const connectDatabase = require("./database/connectDatabase");
require("./config/redis");
const { appLogger } = require("./shared/logger");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      appLogger.info("Server started", {
        port: PORT,
        env: process.env.NODE_ENV || "development",
        url: `http://localhost:${PORT}`,
      });
    });
  } catch (error) {
    appLogger.error("Failed to start server", { message: error.message });
    process.exit(1);
  }
};

startServer();
