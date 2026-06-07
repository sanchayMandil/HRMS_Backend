const jwt = require("jsonwebtoken");
const { StatusCodes } = require("http-status-codes");
const asyncHandler = require("../shared/utils/asyncHandler");
const AppError = require("../shared/utils/AppError");
const User = require("../modules/users/user.model");
const redis = require("../config/redis");
const { userKey, USER_CACHE_TTL } = require("../shared/utils/cacheKeys");

const protect = asyncHandler(async (req, res, next) => {
  let token = req.cookies.token;

  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new AppError("Not authenticated", StatusCodes.UNAUTHORIZED);
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const { id, role } = decoded;

  // 1. Redis cache hit — no DB call
  const cached = await redis.get(userKey(role, id));
  if (cached) {
    req.user = JSON.parse(cached);
    return next();
  }

  // 2. Cache miss — fetch from DB and cache for next request
  const user = await User.findById(id);

  if (!user || !user.isActive) {
    throw new AppError("User not found or inactive", StatusCodes.UNAUTHORIZED);
  }

  const userObj = user.toObject();
  await redis.set(userKey(role, id), JSON.stringify(userObj), "EX", USER_CACHE_TTL);

  req.user = userObj;
  next();
});

const authorize = (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError("Not authorized for this action", StatusCodes.FORBIDDEN)
      );
    }
    next();
  };

module.exports = { protect, authorize };
