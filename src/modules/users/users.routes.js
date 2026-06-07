const express = require("express");
const {
  getAllUsers,
  updateUserRole,
  assignManager,
  unassignManager,
  getAllTeams,
  getMyTeam,
} = require("./users.controller");
const { protect, authorize } = require("../../middlewares/auth.middleware");

const router = express.Router();

router.use(protect);

// Manager + Admin
router.get("/my-team", authorize("admin", "manager"), getMyTeam);

// Admin only
router.get("/", authorize("admin"), getAllUsers);
router.get("/teams", authorize("admin"), getAllTeams);
router.patch("/:id/role", authorize("admin"), updateUserRole);
router.patch("/:id/assign-manager", authorize("admin"), assignManager);
router.delete("/:id/assign-manager", authorize("admin"), unassignManager);

module.exports = router;
