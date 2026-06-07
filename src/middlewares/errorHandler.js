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

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    statusCode = StatusCodes.UNAUTHORIZED;
    message = "Invalid token";
  }
  if (err.name === "TokenExpiredError") {
    statusCode = StatusCodes.UNAUTHORIZED;
    message = "Token expired";
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};

module.exports = errorHandler;
