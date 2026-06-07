const { StatusCodes } = require("http-status-codes");
const asyncHandler = require("../../shared/utils/asyncHandler");
const Attendance = require("../attendance/attendance.model");
const Overtime = require("../overtime/overtime.model");
const User = require("../users/user.model");
const redis = require("../../config/redis");
const { todayAttendanceKey, ttlUntilMidnight } = require("../../shared/utils/cacheKeys");

const todayDate = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

// ── Employee dashboard ────────────────────────────────────────────────────────
const employeeDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const month = currentMonth();

  // Fix 1: check Redis before hitting DB for today's record
  let todayAttendance = null;
  const cached = await redis.get(todayAttendanceKey(userId.toString()));
  if (cached) {
    todayAttendance = JSON.parse(cached);
  } else {
    todayAttendance = await Attendance.findOne({ userId, date: todayDate() });
    if (todayAttendance) {
      await redis.set(
        todayAttendanceKey(userId.toString()),
        JSON.stringify(todayAttendance.toObject()),
        "EX",
        ttlUntilMidnight()
      );
    }
  }

  const [monthlyRecords, overtimeRecords] = await Promise.all([
    Attendance.find({ userId, date: { $regex: `^${month}` } }),
    Overtime.find({ userId, date: { $regex: `^${month}` } }),
  ]);

  // Fix 2: include half_day and absent in monthly counts
  const completedDays  = monthlyRecords.filter((r) => r.status === "completed").length;
  const incompleteDays = monthlyRecords.filter((r) => r.status === "incomplete").length;
  const halfDays       = monthlyRecords.filter((r) => r.status === "half_day").length;
  const absentDays     = monthlyRecords.filter((r) => r.status === "absent").length;
  const totalHours     = monthlyRecords.reduce((sum, r) => sum + (r.workingHours || 0), 0);
  const workedDays     = monthlyRecords.filter((r) => r.workingHours > 0).length;

  res.status(StatusCodes.OK).json({
    success: true,
    dashboard: {
      today: todayAttendance,
      month: {
        totalRecords: monthlyRecords.length,
        completedDays,
        incompleteDays,
        halfDays,
        absentDays,
        totalHours: parseFloat(totalHours.toFixed(2)),
        averageHours: workedDays > 0 ? parseFloat((totalHours / workedDays).toFixed(2)) : 0,
      },
      overtime: {
        total: overtimeRecords.length,
        pending:  overtimeRecords.filter((o) => o.status === "pending").length,
        approved: overtimeRecords.filter((o) => o.status === "approved").length,
        rejected: overtimeRecords.filter((o) => o.status === "rejected").length,
      },
    },
  });
});

// ── Manager dashboard ────────────────────────────────────────────────────────
const managerDashboard = asyncHandler(async (req, res) => {
  const managerId = req.user._id;

  const teamMembers = await User.find({ managerId, isActive: true }, "_id name email department");
  const teamIds = teamMembers.map((u) => u._id);

  const [todayAttendance, pendingOvertime] = await Promise.all([
    Attendance.find({ userId: { $in: teamIds }, date: todayDate() }).populate("userId", "name email"),
    Overtime.find({ userId: { $in: teamIds }, status: "pending" }).populate("userId", "name email"),
  ]);

  // Fix: exclude manually-marked absent records from "present" count
  const presentRecords = todayAttendance.filter((a) => a.status !== "absent");
  const presentIdSet   = new Set(presentRecords.map((a) => String(a.userId._id)));

  res.status(StatusCodes.OK).json({
    success: true,
    dashboard: {
      team: {
        total:   teamMembers.length,
        present: presentRecords.length,
        absent:  teamMembers.length - presentRecords.length,
        members: teamMembers.map((m) => {
          const record = todayAttendance.find((a) => String(a.userId._id) === String(m._id));
          return {
            ...m.toObject(),
            todayStatus: record ? record.status : "absent",
          };
        }),
      },
      pendingOvertime: {
        count: pendingOvertime.length,
        requests: pendingOvertime,
      },
    },
  });
});

// ── Admin dashboard ───────────────────────────────────────────────────────────
const adminDashboard = asyncHandler(async (req, res) => {
  const month = currentMonth();

  const [
    totalActiveUsers,
    totalNonAdminUsers,   // Fix 3: count non-admins for absent calculation
    todayAttendance,
    pendingOvertime,
    monthlyStats,
  ] = await Promise.all([
    User.countDocuments({ isActive: true }),
    User.countDocuments({ isActive: true, role: { $ne: "admin" } }),
    Attendance.find({ date: todayDate() }).populate("userId", "name role department"),
    Overtime.countDocuments({ status: "pending" }),
    Attendance.aggregate([
      { $match: { date: { $regex: `^${month}` } } },
      {
        $group: {
          _id: null,
          totalRecords:      { $sum: 1 },
          completed:         { $sum: { $cond: [{ $eq: ["$status", "completed"] },  1, 0] } },
          incomplete:        { $sum: { $cond: [{ $eq: ["$status", "incomplete"] }, 1, 0] } },
          halfDay:           { $sum: { $cond: [{ $eq: ["$status", "half_day"] },   1, 0] } },
          absent:            { $sum: { $cond: [{ $eq: ["$status", "absent"] },     1, 0] } },
          totalHours:        { $sum: { $ifNull: ["$workingHours", 0] } },
          pendingValidation: { $sum: { $cond: [{ $eq: ["$validationStatus", "pending"] }, 1, 0] } },
        },
      },
    ]),
  ]);

  // Fix 3: present = non-absent punch records, absent = non-admin employees without a present record
  const presentRecords = todayAttendance.filter((a) => a.status !== "absent");

  const stats = monthlyStats[0] || {
    totalRecords: 0, completed: 0, incomplete: 0,
    halfDay: 0, absent: 0, totalHours: 0, pendingValidation: 0,
  };

  res.status(StatusCodes.OK).json({
    success: true,
    dashboard: {
      users: { total: totalActiveUsers, nonAdmin: totalNonAdminUsers },
      today: {
        present: presentRecords.length,
        absent:  totalNonAdminUsers - presentRecords.length,
        records: todayAttendance,
      },
      month: {
        ...stats,
        totalHours: parseFloat(stats.totalHours.toFixed(2)),
      },
      pendingOvertime,
    },
  });
});

// Single entry point — dispatches by role
const getDashboard = asyncHandler(async (req, res, next) => {
  const role = req.user.role;
  if (role === "admin")   return adminDashboard(req, res, next);
  if (role === "manager") return managerDashboard(req, res, next);
  return employeeDashboard(req, res, next);
});

module.exports = { getDashboard };
