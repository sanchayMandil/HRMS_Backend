const { StatusCodes } = require("http-status-codes");
const User = require("./user.model");
const AppError = require("../../shared/utils/AppError");
const asyncHandler = require("../../shared/utils/asyncHandler");
const redis = require("../../config/redis");
const ROLES = require("../../shared/constants/roles");
const { userKey, refreshKey } = require("../../shared/utils/cacheKeys");

const getAllUsers = asyncHandler(async (req, res) => {
  const { role, department, search } = req.query;

  const filter = {};

  if (role) {
    if (!Object.values(ROLES).includes(role)) {
      throw new AppError("Invalid role filter", StatusCodes.BAD_REQUEST);
    }
    filter.role = role;
  }

  if (department) {
    filter.department = { $regex: department, $options: "i" };
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const users = await User.find(filter)
    .select("-password")
    .populate("managerId", "name email")
    .sort({ createdAt: -1 });

  res.status(StatusCodes.OK).json({
    success: true,
    total: users.length,
    users,
  });
});

const updateUserRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!role) {
    throw new AppError("Role is required", StatusCodes.BAD_REQUEST);
  }

  if (!Object.values(ROLES).includes(role)) {
    throw new AppError(
      `Invalid role. Must be one of: ${Object.values(ROLES).join(", ")}`,
      StatusCodes.BAD_REQUEST
    );
  }

  if (id === String(req.user._id)) {
    throw new AppError("You cannot change your own role", StatusCodes.FORBIDDEN);
  }

  const user = await User.findById(id);
  if (!user) {
    throw new AppError("User not found", StatusCodes.NOT_FOUND);
  }

  const previousRole = user.role;
  user.role = role;
  await user.save();

  // Revoke refresh token + clear user cache so the user re-logs in with the new role
  await Promise.all([
    redis.del(refreshKey(previousRole, user._id)),
    redis.del(userKey(previousRole, user._id)),
  ]);

  res.status(StatusCodes.OK).json({
    success: true,
    message: `User role updated from ${previousRole} to ${role}`,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
    },
  });
});

module.exports = { getAllUsers, updateUserRole };
