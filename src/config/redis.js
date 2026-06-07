const Redis = require("ioredis");
const { appLogger } = require("../shared/logger");

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
});

redis.on("connect", () => {
  appLogger.info("Redis connected");
});

redis.on("error", (err) => {
  appLogger.error("Redis error", { message: err.message });
});

module.exports = redis;
