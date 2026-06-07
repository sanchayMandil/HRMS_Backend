const express = require("express");
const { attendanceReport, dailyReport, exportReport } = require("./reports.controller");
const { protect } = require("../../middlewares/auth.middleware");

const router = express.Router();

router.use(protect);

router.get("/attendance", attendanceReport);
router.get("/daily", dailyReport);
router.get("/export", exportReport);

module.exports = router;
