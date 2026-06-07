const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

const mongoose = require("mongoose");
const { corsOptions } = require("./config/cors");
const { requestLogger } = require("./shared/logger");
const { apiLimiter } = require("./config/rateLimiter");
const redis = require("./config/redis");
const apiRouter = require("./routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

// Disable ETags so API responses are never cached — attendance data changes in real-time
app.set("etag", false);

app.use(helmet());
app.use(cors(corsOptions));
app.use(morgan("dev", { stream: requestLogger.stream }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/api/health", async (req, res) => {
  // MongoDB — 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
  const mongoState = ["disconnected", "connected", "connecting", "disconnecting"];
  const mongoStatus = mongoose.connection.readyState;
  const mongoOk = mongoStatus === 1;

  // Redis — send a PING and expect PONG
  let redisOk = false;
  try {
    const pong = await redis.ping();
    redisOk = pong === "PONG";
  } catch {
    redisOk = false;
  }

  const allOk = mongoOk && redisOk;

  res.status(allOk ? 200 : 503).json({
    success: allOk,
    status: allOk ? "healthy" : "degraded",
    services: {
      server: "up",
      mongodb: { status: mongoState[mongoStatus] || "unknown", ok: mongoOk },
      redis:   { status: redisOk ? "connected" : "unreachable", ok: redisOk },
    },
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", apiLimiter, apiRouter);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
