const express = require("express");
const { getAllUsers, updateUserRole } = require("./users.controller");
const { protect, authorize } = require("../../middlewares/auth.middleware");

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/", getAllUsers);
router.patch("/:id/role", updateUserRole);

module.exports = router;
