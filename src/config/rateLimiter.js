const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const json429 = (message) => ({
  success: false,
  message,
});

// Login / Register — brute-force guard
// 10 failed attempts per 15 min per IP; successful logins don't count
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429("Too many login attempts. Please try again in 15 minutes."),
});

// Token refresh — slightly looser but still guarded
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429("Too many token refresh attempts. Please try again shortly."),
});

// Punch-in / Punch-out — keyed by userId (set AFTER protect middleware)
// 5 attempts per hour per user — covers the requiresReason retry flow
const punchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?._id ? `punch:${req.user._id}` : `punch:${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429("Too many punch attempts. Please wait before trying again."),
});

// Global API limiter — catches everything else, protects overall spend
// 200 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429("Too many requests. Please slow down."),
  skip: (req) => req.path === "/api/health",
});

module.exports = { authLimiter, refreshLimiter, punchLimiter, apiLimiter };
