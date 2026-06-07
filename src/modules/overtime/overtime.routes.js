const express = require("express");
const {
  requestOvertime,
  getMyOvertime,
  getOvertimeById,
  getAllOvertime,
  reviewOvertime,
  cancelOvertime,
} = require("./overtime.controller");
const { protect, authorize } = require("../../middlewares/auth.middleware");

const router = express.Router();

router.use(protect);

// Employee
router.post("/", requestOvertime);
router.get("/my", getMyOvertime);   // must be before /:id
router.get("/:id", getOvertimeById);
router.delete("/:id", cancelOvertime);

// Admin + Manager
router.get("/", authorize("admin", "manager"), getAllOvertime);
router.patch("/:id/review", authorize("admin", "manager"), reviewOvertime);

module.exports = router;
