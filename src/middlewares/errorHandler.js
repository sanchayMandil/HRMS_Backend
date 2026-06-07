const { StatusCodes } = require("http-status-codes");

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  let message = err.message || "Something went wrong";

  // Mongoose validation error
  if (err.name === "ValidationError") {
    statusCode = StatusCodes.BAD_REQUEST;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = StatusCodes.CONFLICT;
    const field = Object.keys(err.keyValue)[0];
    message = `${field} already exists`;
  }

  // JWT errors — should only reach here if a raw JWT error escapes a handler
  if (err.name === "JsonWebTokenError") {
    statusCode = StatusCodes.UNAUTHORIZED;
    message = "Invalid token, please log in again";
  }
  if (err.name === "TokenExpiredError") {
    statusCode = StatusCodes.UNAUTHORIZED;
    message = "Session expired, please log in again";
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};

module.exports = errorHandler;
