const { StatusCodes } = require("http-status-codes");
const Settings = require("./settings.model");
const AppError = require("../../shared/utils/AppError");
const asyncHandler = require("../../shared/utils/asyncHandler");
const redis = require("../../config/redis");

const OFFICE_KEY = "office_location";
const CACHE_KEY = "settings:office_location";
const CACHE_TTL = 60 * 60; // 1 hour

// GET /api/settings/office
const getOfficeLocation = asyncHandler(async (req, res) => {
  const setting = await Settings.findOne({ key: OFFICE_KEY }).populate(
    "updatedBy",
    "name email"
  );

  if (!setting) {
    throw new AppError("Office location not configured yet", StatusCodes.NOT_FOUND);
  }

  res.status(StatusCodes.OK).json({
    success: true,
    office: setting.value,
    lastUpdatedBy: setting.updatedBy,
    updatedAt: setting.updatedAt,
  });
});

// PUT /api/settings/office  — admin only
const setOfficeLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude, name, radiusMeters } = req.body;

  if (latitude == null || longitude == null) {
    throw new AppError("latitude and longitude are required", StatusCodes.BAD_REQUEST);
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new AppError("Invalid coordinates", StatusCodes.BAD_REQUEST);
  }

  const value = {
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    name: name || "Office",
    radiusMeters: radiusMeters ? parseInt(radiusMeters) : 100,
  };

  const setting = await Settings.findOneAndUpdate(
    { key: OFFICE_KEY },
    { value, updatedBy: req.user._id },
    { upsert: true, new: true }
  );

  // Invalidate cache so next punch-in picks up the new location
  await redis.del(CACHE_KEY);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Office location updated",
    office: setting.value,
  });
});

module.exports = { getOfficeLocation, setOfficeLocation, OFFICE_KEY, CACHE_KEY, CACHE_TTL };
