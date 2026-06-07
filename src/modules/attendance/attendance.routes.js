const express = require("express");
const {
  punchIn,
  punchOut,
  getTodayStatus,
  getMyAttendance,
  validateAttendance,
  getAllAttendance,
  getAdminSummary,
  getAbsentEmployees,
  createManualAttendance,
  editAttendance,
  deleteAttendance,
  bulkValidate,
  markAbsent,
  setDayType,
  getMissedPunches,
} = require("./attendance.controller");
const { protect, authorize } = require("../../middlewares/auth.middleware");
const { punchLimiter } = require("../../config/rateLimiter");

const router = express.Router();

router.use(protect);

// ── Employee ──────────────────────────────────────────────
router.post("/punch-in", punchLimiter, punchIn);
router.post("/punch-out", punchLimiter, punchOut);
router.get("/today", getTodayStatus);
router.get("/me", getMyAttendance);

// ── Admin + Manager ───────────────────────────────────────
router.get("/missed-punch", authorize("admin", "manager"), getMissedPunches);
router.get("/", authorize("admin", "manager"), getAllAttendance);
router.patch("/:id/validate", authorize("admin", "manager"), validateAttendance);
router.post("/team/mark-absent", authorize("admin", "manager"), markAbsent);
router.patch("/:id/day-type", authorize("admin", "manager"), setDayType);

// ── Admin only ────────────────────────────────────────────
// NOTE: specific /admin/* routes must come before /:id routes
router.get("/admin/summary", authorize("admin", "manager"), getAdminSummary);
router.get("/admin/absent", authorize("admin", "manager"), getAbsentEmployees);
router.post("/admin/manual", authorize("admin"), createManualAttendance);
router.patch("/admin/bulk-validate", authorize("admin"), bulkValidate);
router.patch("/:id", authorize("admin", "manager"), editAttendance);
router.delete("/:id", authorize("admin"), deleteAttendance);

module.exports = router;
