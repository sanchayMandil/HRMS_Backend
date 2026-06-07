const express = require("express");
const { getOfficeLocation, setOfficeLocation } = require("./settings.controller");
const { protect, authorize } = require("../../middlewares/auth.middleware");

const router = express.Router();

router.get("/office", protect, getOfficeLocation);
router.put("/office", protect, authorize("admin"), setOfficeLocation);

module.exports = router;
