const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

const { corsOptions } = require("./config/cors");
const { requestLogger } = require("./shared/logger");
const apiRouter = require("./routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

app.use(helmet());
app.use(cors(corsOptions));
app.use(morgan("dev", { stream: requestLogger.stream }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "HRMS attendance backend is running",
  });
});

app.use("/api", apiRouter);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
