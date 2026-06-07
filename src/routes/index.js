const express = require("express");

const authRouter = require("../modules/auth/auth.routes");
const userRouter = require("../modules/users/users.routes");
const attendanceRouter = require("../modules/attendance/attendance.routes");
const overtimeRouter = require("../modules/overtime/overtime.routes");
const reportRouter = require("../modules/reports/reports.routes");
const dashboardRouter = require("../modules/dashboard/dashboard.routes");

const router = express.Router();

router.use("/auth", authRouter);
router.use("/users", userRouter);
router.use("/attendance", attendanceRouter);
router.use("/overtime", overtimeRouter);
router.use("/reports", reportRouter);
router.use("/dashboard", dashboardRouter);

module.exports = router;
