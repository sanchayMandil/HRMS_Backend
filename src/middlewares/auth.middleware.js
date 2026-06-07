const jwt = require("jsonwebtoken");
const { StatusCodes } = require("http-status-codes");
const asyncHandler = require("../shared/utils/asyncHandler");
const AppError = require("../shared/utils/AppError");
const User = require("../modules/users/user.model");
const redis = require("../config/redis");
const {
  userKey,
  refreshKey,
  USER_CACHE_TTL,
  REFRESH_TTL_SECONDS,
} = require("../shared/utils/cacheKeys");

const setAccessCookie = (res, token) =>
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: REFRESH_TTL_SECONDS * 1000, // cookie lives 7 days — JWT inside expires in 15 min
  });

const setRefreshCookie = (res, token) =>
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });

const protect = asyncHandler(async (req, res, next) => {
  let token = req.cookies.token;

  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new AppError("Not authenticated", StatusCodes.UNAUTHORIZED);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name !== "TokenExpiredError") {
      throw new AppError("Invalid token, please log in again", StatusCodes.UNAUTHORIZED);
    }

    // Access token expired — attempt silent refresh
    if (!req.cookies.refreshToken) {
      throw new AppError("No refresh token found, please log in again", StatusCodes.UNAUTHORIZED);
    }

    // Step 1: verify the refresh token JWT itself
    let refreshDecoded;
    try {
      refreshDecoded = jwt.verify(req.cookies.refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (refreshErr) {
      console.error("[auth:refresh] refresh JWT failed:", refreshErr.name);
      throw new AppError("Refresh token expired, please log in again", StatusCodes.UNAUTHORIZED);
    }

    const { id, role } = refreshDecoded;

    // Step 2: check Redis — the stored value must match what the cookie holds
    const stored = await redis.get(refreshKey(role, id));
    console.log("[auth:refresh] Redis key:", refreshKey(role, id), "| stored:", stored ? "FOUND" : "NULL", "| match:", stored === req.cookies.refreshToken);

    if (!stored) {
      throw new AppError("Session not found in store, please log in again", StatusCodes.UNAUTHORIZED);
    }
    if (stored !== req.cookies.refreshToken) {
      throw new AppError("Refresh token was already rotated, please log in again", StatusCodes.UNAUTHORIZED);
    }

    // Step 3: rotate both tokens
    const newAccess = jwt.sign({ id, role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    });
    const newRefresh = jwt.sign({ id, role }, process.env.JWT_REFRESH_SECRET, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    });

    await redis.set(refreshKey(role, id), newRefresh, "EX", REFRESH_TTL_SECONDS);
    setAccessCookie(res, newAccess);
    setRefreshCookie(res, newRefresh);

    console.log("[auth:refresh] silent refresh OK for", role, id);
    decoded = { id, role };
  }

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
