const fs = require("fs");
const path = require("path");
const winston = require("winston");

const logsDirectory = path.join(process.cwd(), "logs");

if (!fs.existsSync(logsDirectory)) {
  fs.mkdirSync(logsDirectory, { recursive: true });
}

const appLogger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDirectory, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logsDirectory, "combined.log"),
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  appLogger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

const requestLogger = {
  stream: {
    write: (message) => {
      appLogger.http(message.trim());
    },
  },
};

module.exports = {
  appLogger,
  requestLogger,
};
