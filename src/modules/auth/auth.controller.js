const jwt = require("jsonwebtoken");
const { StatusCodes } = require("http-status-codes");
const User = require("../users/user.model");
const AppError = require("../../shared/utils/AppError");
const asyncHandler = require("../../shared/utils/asyncHandler");
const redis = require("../../config/redis");
const {
  userKey,
  refreshKey,
  USER_CACHE_TTL,
  REFRESH_TTL_SECONDS,
} = require("../../shared/utils/cacheKeys");

const signAccessToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
  });

const signRefreshToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  });

const setAccessCookie = (res, token) => {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: 15 * 60 * 1000,
  });
};

const setRefreshCookie = (res, token) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: REFRESH_TTL_SECONDS * 1000,
    path: "/api/auth/refresh",
  });
};

const sendTokenResponse = async (res, statusCode, user) => {
  const { _id, role } = user;

  const accessToken = signAccessToken(_id, role);
  const refreshToken = signRefreshToken(_id, role);

  const { password: _pw, ...userObj } = user.toObject
    ? user.toObject()
    : user;

  // Store refresh token in Redis
  await redis.set(refreshKey(role, _id), refreshToken, "EX", REFRESH_TTL_SECONDS);

  // Cache user so protect middleware skips DB for 15 min
  await redis.set(userKey(role, _id), JSON.stringify(userObj), "EX", USER_CACHE_TTL);

  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);

  res.status(statusCode).json({
    success: true,
    accessToken,
    user: userObj,
  });
};

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, department, managerId } = req.body;

  if (!name || !email || !password) {
    throw new AppError(
      "Name, email and password are required",
      StatusCodes.BAD_REQUEST
    );
  }

  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError("Email already registered", StatusCodes.CONFLICT);
  }

  const assignedRole = req.user?.role === "admin" && role ? role : undefined;

  const user = await User.create({
    name,
    email,
    password,
    ...(assignedRole && { role: assignedRole }),
    ...(department && { department }),
    ...(managerId && { managerId }),
  });

  await sendTokenResponse(res, StatusCodes.CREATED, user);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError(
      "Email and password are required",
      StatusCodes.BAD_REQUEST
    );
  }

  const user = await User.findOne({ email }).select("+password");

  if (!user || !(await user.comparePassword(password))) {
    throw new AppError("Invalid email or password", StatusCodes.UNAUTHORIZED);
  }

  if (!user.isActive) {
    throw new AppError("Account is inactive", StatusCodes.FORBIDDEN);
  }

  await sendTokenResponse(res, StatusCodes.OK, user);
});

const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies.refreshToken;

  if (!token) {
    throw new AppError("No refresh token", StatusCodes.UNAUTHORIZED);
  }

  // Verify signature — no DB call
  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  const { id, role } = decoded;

  // Compare against Redis — no DB call
  const stored = await redis.get(refreshKey(role, id));
  if (!stored || stored !== token) {
    throw new AppError(
      "Refresh token is invalid or has been revoked",
      StatusCodes.UNAUTHORIZED
    );
  }

  // Rotate both tokens
  const newAccessToken = signAccessToken(id, role);
  const newRefreshToken = signRefreshToken(id, role);

  await redis.set(refreshKey(role, id), newRefreshToken, "EX", REFRESH_TTL_SECONDS);

  setAccessCookie(res, newAccessToken);
  setRefreshCookie(res, newRefreshToken);

  res.status(StatusCodes.OK).json({
    success: true,
    accessToken: newAccessToken,
  });
});

const logout = asyncHandler(async (req, res) => {
  const { _id, role } = req.user;

  await Promise.all([
    redis.del(refreshKey(role, _id)),
    redis.del(userKey(role, _id)),
  ]);

  res.clearCookie("token");
  res.clearCookie("refreshToken", { path: "/api/auth/refresh" });

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Logged out successfully",
  });
});

const getMe = asyncHandler(async (req, res) => {
  res.status(StatusCodes.OK).json({
    success: true,
    user: req.user,
  });
});

module.exports = { register, login, refresh, logout, getMe };
