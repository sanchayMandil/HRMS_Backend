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

// PATCH /api/users/:id/assign-manager  — admin assigns employee to a manager's team
const assignManager = asyncHandler(async (req, res) => {
  const { managerId } = req.body;
  const { id } = req.params;

  if (!managerId) throw new AppError("managerId is required", StatusCodes.BAD_REQUEST);

  const [employee, manager] = await Promise.all([
    User.findById(id),
    User.findById(managerId),
  ]);

  if (!employee) throw new AppError("Employee not found", StatusCodes.NOT_FOUND);
  if (!manager) throw new AppError("Manager not found", StatusCodes.NOT_FOUND);
  if (manager.role !== ROLES.MANAGER) {
    throw new AppError("Target user is not a manager", StatusCodes.BAD_REQUEST);
  }
  if (employee.role === ROLES.ADMIN) {
    throw new AppError("Cannot assign a manager to an admin", StatusCodes.BAD_REQUEST);
  }

  employee.managerId = managerId;
  await employee.save();

  // Invalidate cache so protect middleware picks up the new managerId
  await redis.del(userKey(employee.role, employee._id));

  res.status(StatusCodes.OK).json({
    success: true,
    message: `${employee.name} assigned to ${manager.name}'s team`,
    employee: {
      _id: employee._id,
      name: employee.name,
      email: employee.email,
      manager: { _id: manager._id, name: manager.name },
    },
  });
});

// DELETE /api/users/:id/assign-manager  — admin removes employee from team
const unassignManager = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.id);
  if (!employee) throw new AppError("Employee not found", StatusCodes.NOT_FOUND);

  employee.managerId = undefined;
  await employee.save();

  await redis.del(userKey(employee.role, employee._id));

  res.status(StatusCodes.OK).json({
    success: true,
    message: `${employee.name} removed from their team`,
  });
});

// GET /api/users/teams  — admin sees every manager + their team members
const getAllTeams = asyncHandler(async (req, res) => {
  const managers = await User.find(
    { role: ROLES.MANAGER, isActive: true },
    "name email department"
  );

  const teams = await Promise.all(
    managers.map(async (manager) => {
      const members = await User.find(
        { managerId: manager._id, isActive: true },
        "name email department role"
      );
      return {
        manager: { _id: manager._id, name: manager.name, email: manager.email, department: manager.department },
        memberCount: members.length,
        members,
      };
    })
  );

  const unassigned = await User.find(
    { role: ROLES.EMPLOYEE, isActive: true, managerId: { $exists: false } },
    "name email department"
  );

  res.status(StatusCodes.OK).json({
    success: true,
    totalTeams: teams.length,
    teams,
    unassigned: { total: unassigned.length, employees: unassigned },
  });
});

// GET /api/users/my-team  — manager sees their own team
const getMyTeam = asyncHandler(async (req, res) => {
  const members = await User.find(
    { managerId: req.user._id, isActive: true },
    "name email department role createdAt"
  );

  res.status(StatusCodes.OK).json({
    success: true,
    total: members.length,
    members,
  });
});

module.exports = { getAllUsers, updateUserRole, assignManager, unassignManager, getAllTeams, getMyTeam };
