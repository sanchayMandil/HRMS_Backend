const express = require("express");
const { register, login, refresh, logout, getMe } = require("./auth.controller");
const { protect } = require("../../middlewares/auth.middleware");
const { authLimiter, refreshLimiter } = require("../../config/rateLimiter");

const router = express.Router();

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/refresh", refreshLimiter, refresh);
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);

module.exports = router;
