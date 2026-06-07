const { StatusCodes } = require("http-status-codes");
const Attendance = require("./attendance.model");
const User = require("../users/user.model");
const AppError = require("../../shared/utils/AppError");
const asyncHandler = require("../../shared/utils/asyncHandler");
const cloudinary = require("../../config/cloudinary");
const haversineDistance = require("../../shared/utils/haversine");
const redis = require("../../config/redis");
const Settings = require("../settings/settings.model");
const { CACHE_KEY, CACHE_TTL } = require("../settings/settings.controller");
const {
  attendanceKey,
  todayAttendanceKey,
  ATTENDANCE_TTL,
  ttlUntilMidnight,
} = require("../../shared/utils/cacheKeys");

const todayDate = () => new Date().toISOString().slice(0, 10);

// ── Admin-lock guard ─────────────────────────────────────────────────────────
// Call before any write on an attendance record. Throws 403 if admin has
// already locked the record and the caller is not an admin.
const assertNotAdminLocked = (record, callerRole) => {
  if (record.adminLocked && callerRole !== "admin") {
    throw new AppError(
      "This record has been finalised by an admin and cannot be modified.",
      StatusCodes.FORBIDDEN
    );
  }
};

// ── Cache helpers ─────────────────────────────────────────────────────────────

// Store a record in Redis by its _id, and also under today's key if it's today's record
const cacheRecord = async (record) => {
  const obj = record.toObject ? record.toObject() : record;
  const id = obj._id.toString();
  const userId = (obj.userId?._id || obj.userId).toString();

  await redis.set(attendanceKey(id), JSON.stringify(obj), "EX", ATTENDANCE_TTL);

  if (obj.date === todayDate()) {
    await redis.set(todayAttendanceKey(userId), JSON.stringify(obj), "EX", ttlUntilMidnight());
  }
};

// Remove a record from all cache keys
const invalidateRecord = async (id, userId, date) => {
  await redis.del(attendanceKey(id.toString()));
  if (date === todayDate()) {
    await redis.del(todayAttendanceKey(userId.toString()));
  }
};

// ── Office / geofence ────────────────────────────────────────────────────────

const uploadSelfie = async (base64Image, folder) => {
  if (!base64Image) throw new AppError("Selfie is required", StatusCodes.BAD_REQUEST);
  const result = await cloudinary.uploader.upload(base64Image, {
    folder,
    resource_type: "image",
    transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
  });
  return { url: result.secure_url, publicId: result.public_id };
};

const getOfficeConfig = async () => {
  const cached = await redis.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const setting = await Settings.findOne({ key: "office_location" });
  if (!setting) throw new AppError("Office location not configured. Contact admin.", 503);

  await redis.set(CACHE_KEY, JSON.stringify(setting.value), "EX", CACHE_TTL);
  return setting.value;
};

const checkGeofence = async (latitude, longitude) => {
  if (latitude == null || longitude == null) {
    throw new AppError("Location (latitude & longitude) is required", StatusCodes.BAD_REQUEST);
  }
  const office = await getOfficeConfig();
  const distance = haversineDistance(latitude, longitude, office.latitude, office.longitude);
  if (distance > office.radiusMeters) {
    throw new AppError(
      `You are ${Math.round(distance)}m away from ${office.name}. Must be within ${office.radiusMeters}m to punch in.`,
      StatusCodes.FORBIDDEN
    );
  }
};

// ── Employee endpoints ────────────────────────────────────────────────────────

// POST /api/attendance/punch-in
const punchIn = asyncHandler(async (req, res) => {
  const { selfie, location } = req.body;
  const userId = req.user._id;
  const date = todayDate();

  await checkGeofence(location?.latitude, location?.longitude);

  const existing = await Attendance.findOne({ userId, date });
  if (existing) throw new AppError("Already punched in today", StatusCodes.CONFLICT);

  const { url, publicId } = await uploadSelfie(selfie, `hrms/attendance/${userId}/punch-in`);

  const attendance = await Attendance.create({
    userId,
    date,
    punchIn: {
      time: new Date(),
      selfie: url,
      selfiePublicId: publicId,
      location: { latitude: location.latitude, longitude: location.longitude },
    },
    status: "ongoing",
  });

  await cacheRecord(attendance);

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Punched in successfully",
    attendance,
  });
});

// POST /api/attendance/punch-out
const punchOut = asyncHandler(async (req, res) => {
  const { selfie, location, reason } = req.body;
  const userId = req.user._id;
  const date = todayDate();

  // Check Redis first for today's record
  let attendance;
  const cached = await redis.get(todayAttendanceKey(userId.toString()));
  if (cached) {
    const cachedObj = JSON.parse(cached);
    attendance = await Attendance.findById(cachedObj._id);
  } else {
    attendance = await Attendance.findOne({ userId, date });
  }

  if (!attendance) throw new AppError("No punch-in found for today", StatusCodes.BAD_REQUEST);
  if (attendance.punchOut?.time) throw new AppError("Already punched out today", StatusCodes.CONFLICT);

  const punchOutTime = new Date();
  const workingHours = (punchOutTime - attendance.punchIn.time) / (1000 * 60 * 60);

  if (workingHours < 8 && !reason) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      requiresReason: true,
      workedHours: parseFloat(workingHours.toFixed(2)),
      message: `You have only worked ${workingHours.toFixed(2)} hours. Please provide a reason for early punch-out.`,
    });
  }

  const { url, publicId } = await uploadSelfie(selfie, `hrms/attendance/${userId}/punch-out`);

  attendance.punchOut = {
    time: punchOutTime,
    selfie: url,
    selfiePublicId: publicId,
    location: { latitude: location?.latitude, longitude: location?.longitude },
  };
  attendance.workingHours = parseFloat(workingHours.toFixed(2));
  attendance.status = workingHours >= 8 ? "completed" : "incomplete";
  if (reason) attendance.earlyExitReason = reason;

  await attendance.save();
  await cacheRecord(attendance);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Punched out successfully",
    attendance,
  });
});

// GET /api/attendance/today
const getTodayStatus = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();

  // Redis first
  const cached = await redis.get(todayAttendanceKey(userId));
  if (cached) {
    return res.status(StatusCodes.OK).json({
      success: true,
      attendance: JSON.parse(cached),
    });
  }

  // DB fallback
  const attendance = await Attendance.findOne({ userId, date: todayDate() });
  if (attendance) await cacheRecord(attendance);

  res.status(StatusCodes.OK).json({
    success: true,
    attendance: attendance || null,
  });
});

// GET /api/attendance/me?month=2026-06
const getMyAttendance = asyncHandler(async (req, res) => {
  const { month } = req.query;
  const filter = { userId: req.user._id };

  if (month) filter.date = { $regex: `^${month}` };

  const records = await Attendance.find(filter).sort({ date: -1 });

  res.status(StatusCodes.OK).json({
    success: true,
    total: records.length,
    records,
  });
});

// ── Admin + Manager endpoints ─────────────────────────────────────────────────

// PATCH /api/attendance/:id/validate
const validateAttendance = asyncHandler(async (req, res) => {
  const { validationStatus, remarks } = req.body;

  if (!["valid", "invalid"].includes(validationStatus)) {
    throw new AppError("validationStatus must be 'valid' or 'invalid'", StatusCodes.BAD_REQUEST);
  }

  // Check Redis first
  const cKey = attendanceKey(req.params.id);
  const cached = await redis.get(cKey);
  const attendance = cached
    ? await Attendance.findById(JSON.parse(cached)._id).populate("userId", "name email role managerId")
    : await Attendance.findById(req.params.id).populate("userId", "name email role managerId");

  if (!attendance) throw new AppError("Attendance record not found", StatusCodes.NOT_FOUND);

  assertNotAdminLocked(attendance, req.user.role);

  if (req.user.role === "manager") {
    const employeeManagerId = attendance.userId?.managerId?.toString();
    if (employeeManagerId !== req.user._id.toString()) {
      throw new AppError("You can only validate attendance of your own team members", StatusCodes.FORBIDDEN);
    }
  }

  attendance.validationStatus = validationStatus;
  attendance.validatedBy = req.user._id;
  if (remarks) attendance.remarks = remarks;
  if (req.user.role === "admin") attendance.adminLocked = true;

  await attendance.save();
  await cacheRecord(attendance);

  res.status(StatusCodes.OK).json({
    success: true,
    message: `Attendance marked as ${validationStatus}`,
    attendance,
  });
});

// GET /api/attendance
const getAllAttendance = asyncHandler(async (req, res) => {
  const {
    date, userId, status, validationStatus, month,
    department, page = 1, limit = 50,
  } = req.query;

  const filter = {};
  if (date) filter.date = date;
  if (month) filter.date = { $regex: `^${month}` };
  if (status) filter.status = status;
  if (validationStatus) filter.validationStatus = validationStatus;

  if (req.user.role === "manager") {
    const teamMembers = await User.find({ managerId: req.user._id }, "_id");
    const teamIds = teamMembers.map((u) => u._id.toString());

    if (userId) {
      if (!teamIds.includes(userId)) throw new AppError("This employee is not in your team", StatusCodes.FORBIDDEN);
      filter.userId = userId;
    } else {
      filter.userId = { $in: teamIds };
    }
  } else {
    if (userId) {
      filter.userId = userId;
    } else if (department) {
      const deptUsers = await User.find({ department }, "_id");
      filter.userId = { $in: deptUsers.map((u) => u._id) };
    }
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [records, total] = await Promise.all([
    Attendance.find(filter)
      .populate("userId", "name email department role")
      .populate("validatedBy", "name")
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Attendance.countDocuments(filter),
  ]);

  res.status(StatusCodes.OK).json({
    success: true,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    records,
  });
});

// GET /api/attendance/admin/summary
const getAdminSummary = asyncHandler(async (req, res) => {
  const { month, userId, department } = req.query;

  if (!month) throw new AppError("month query param is required (YYYY-MM)", StatusCodes.BAD_REQUEST);

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, mon - 1, d).getDay();
    if (dow !== 0 && dow !== 6) workingDays++;
  }

  const userFilter = { isActive: true, role: { $ne: "admin" } };
  if (req.user.role === "manager") {
    userFilter.managerId = req.user._id;
  } else {
    if (userId) userFilter._id = userId;
    if (department) userFilter.department = department;
  }

  const users = await User.find(userFilter, "name email department role");
  const userIds = users.map((u) => u._id);

  const records = await Attendance.find({
    userId: { $in: userIds },
    date: { $regex: `^${month}` },
  });

  const byUser = {};
  for (const r of records) {
    const key = r.userId.toString();
    if (!byUser[key]) byUser[key] = [];
    byUser[key].push(r);
  }

  const summary = users.map((user) => {
    const uid = user._id.toString();
    const rows = byUser[uid] || [];
    const present = rows.filter((r) => r.status === "completed").length;
    const incomplete = rows.filter((r) => r.status === "incomplete").length;
    const absent = Math.max(0, workingDays - rows.length);
    const totalHours = rows.reduce((s, r) => s + (r.workingHours || 0), 0);
    const avgHours = rows.length ? parseFloat((totalHours / rows.length).toFixed(2)) : 0;
    const pendingValidation = rows.filter((r) => r.validationStatus === "pending").length;

    return {
      user: { _id: user._id, name: user.name, email: user.email, department: user.department, role: user.role },
      present,
      incomplete,
      absent,
      totalWorkingHours: parseFloat(totalHours.toFixed(2)),
      avgDailyHours: avgHours,
      pendingValidation,
    };
  });

  res.status(StatusCodes.OK).json({
    success: true,
    month,
    workingDays,
    totalEmployees: users.length,
    summary,
  });
});

// GET /api/attendance/admin/absent
const getAbsentEmployees = asyncHandler(async (req, res) => {
  const { date } = req.query;

  if (!date) throw new AppError("date query param is required (YYYY-MM-DD)", StatusCodes.BAD_REQUEST);

  const userFilter = { isActive: true, role: { $ne: "admin" } };
  if (req.user.role === "manager") userFilter.managerId = req.user._id;

  const allUsers = await User.find(userFilter, "name email department role managerId");

  const present = await Attendance.find({ date }, "userId");
  const presentSet = new Set(present.map((r) => r.userId.toString()));
  const absent = allUsers.filter((u) => !presentSet.has(u._id.toString()));

  res.status(StatusCodes.OK).json({ success: true, date, total: absent.length, employees: absent });
});

// ── Admin-only endpoints ──────────────────────────────────────────────────────

// POST /api/attendance/admin/manual
const createManualAttendance = asyncHandler(async (req, res) => {
  const { userId, date, punchInTime, punchOutTime, reason } = req.body;

  if (!userId || !date || !punchInTime) {
    throw new AppError("userId, date, and punchInTime are required", StatusCodes.BAD_REQUEST);
  }

  const existing = await Attendance.findOne({ userId, date });
  if (existing) throw new AppError("Attendance record already exists for this user on this date", StatusCodes.CONFLICT);

  const punchInDate = new Date(punchInTime);
  let workingHours = null;
  let status = "ongoing";

  if (punchOutTime) {
    const punchOutDate = new Date(punchOutTime);
    workingHours = parseFloat(((punchOutDate - punchInDate) / (1000 * 60 * 60)).toFixed(2));
    status = workingHours >= 8 ? "completed" : "incomplete";
  }

  const attendance = await Attendance.create({
    userId,
    date,
    punchIn: { time: punchInDate },
    ...(punchOutTime && { punchOut: { time: new Date(punchOutTime) } }),
    workingHours,
    status,
    isManual: true,
    validationStatus: "valid",
    validatedBy: req.user._id,
    remarks: `Manual entry by admin${reason ? ": " + reason : ""}`,
    ...(reason && { earlyExitReason: reason }),
  });

  await cacheRecord(attendance);

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Manual attendance created",
    attendance,
  });
});

// PATCH /api/attendance/:id  — admin: full edit | manager: status/remarks/validationStatus only
const editAttendance = asyncHandler(async (req, res) => {
  const { punchInTime, punchOutTime, status, remarks, validationStatus } = req.body;

  // Check Redis for existing record
  const cKey = attendanceKey(req.params.id);
  const cached = await redis.get(cKey);

  const attendance = cached
    ? await Attendance.findById(JSON.parse(cached)._id).populate("userId", "name managerId")
    : await Attendance.findById(req.params.id).populate("userId", "name managerId");

  if (!attendance) throw new AppError("Attendance record not found", StatusCodes.NOT_FOUND);

  assertNotAdminLocked(attendance, req.user.role);

  if (req.user.role === "manager") {
    const employeeManagerId = attendance.userId?.managerId?.toString();
    if (employeeManagerId !== req.user._id.toString()) {
      throw new AppError("You can only edit attendance of your own team members", StatusCodes.FORBIDDEN);
    }
    if (punchInTime || punchOutTime) {
      throw new AppError("Managers cannot modify punch times. Contact admin.", StatusCodes.FORBIDDEN);
    }
  }

  if (req.user.role === "admin") {
    if (punchInTime) {
      if (!attendance.punchIn) attendance.punchIn = {};
      attendance.punchIn.time = new Date(punchInTime);
    }
    if (punchOutTime) {
      if (!attendance.punchOut) attendance.punchOut = {};
      attendance.punchOut.time = new Date(punchOutTime);
      const inTime = attendance.punchIn?.time;
      if (inTime) {
        attendance.workingHours = parseFloat(
          ((new Date(punchOutTime) - new Date(inTime)) / (1000 * 60 * 60)).toFixed(2)
        );
        attendance.status = attendance.workingHours >= 8 ? "completed" : "incomplete";
      }
    }
  }

  if (status) attendance.status = status;
  if (remarks) attendance.remarks = remarks;
  if (validationStatus) {
    attendance.validationStatus = validationStatus;
    attendance.validatedBy = req.user._id;
  }
  if (req.user.role === "admin") attendance.adminLocked = true;

  await attendance.save();
  await cacheRecord(attendance);

  res.status(StatusCodes.OK).json({ success: true, message: "Attendance updated", attendance });
});

// DELETE /api/attendance/:id
const deleteAttendance = asyncHandler(async (req, res) => {
  const attendance = await Attendance.findById(req.params.id);
  if (!attendance) throw new AppError("Attendance record not found", StatusCodes.NOT_FOUND);

  if (attendance.punchIn?.selfiePublicId) {
    await cloudinary.uploader.destroy(attendance.punchIn.selfiePublicId).catch(() => {});
  }
  if (attendance.punchOut?.selfiePublicId) {
    await cloudinary.uploader.destroy(attendance.punchOut.selfiePublicId).catch(() => {});
  }

  await attendance.deleteOne();
  await invalidateRecord(attendance._id, attendance.userId, attendance.date);

  res.status(StatusCodes.OK).json({ success: true, message: "Attendance record deleted" });
});

// PATCH /api/attendance/admin/bulk-validate
const bulkValidate = asyncHandler(async (req, res) => {
  const { ids, validationStatus, remarks } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError("ids array is required", StatusCodes.BAD_REQUEST);
  }
  if (!["valid", "invalid"].includes(validationStatus)) {
    throw new AppError("validationStatus must be 'valid' or 'invalid'", StatusCodes.BAD_REQUEST);
  }

  // Admin locks are respected — only update records not locked by admin
  // (admins bypass this and can update everything)
  const query = req.user.role === "admin"
    ? { _id: { $in: ids } }
    : { _id: { $in: ids }, adminLocked: { $ne: true } };

  const updatePayload = {
    validationStatus,
    validatedBy: req.user._id,
    ...(remarks && { remarks }),
    ...(req.user.role === "admin" && { adminLocked: true }),
  };

  const result = await Attendance.updateMany(query, { $set: updatePayload });

  const skipped = ids.length - result.matchedCount;

  // Invalidate all affected cache keys
  if (ids.length > 0) {
    await redis.del(...ids.map(attendanceKey));
  }

  res.status(StatusCodes.OK).json({
    success: true,
    message: `${result.modifiedCount} records marked as ${validationStatus}${skipped > 0 ? `, ${skipped} skipped (admin locked)` : ""}`,
    modifiedCount: result.modifiedCount,
    skipped,
  });
});

// POST /api/attendance/team/mark-absent
const markAbsent = asyncHandler(async (req, res) => {
  const { userId, date, remarks } = req.body;

  if (!userId || !date) throw new AppError("userId and date are required", StatusCodes.BAD_REQUEST);

  if (req.user.role === "manager") {
    const employee = await User.findOne({ _id: userId, managerId: req.user._id });
    if (!employee) throw new AppError("This employee is not in your team", StatusCodes.FORBIDDEN);
  }

  const existing = await Attendance.findOne({ userId, date });
  if (existing) {
    throw new AppError(
      "Attendance record already exists for this date. Use edit endpoint to change status.",
      StatusCodes.CONFLICT
    );
  }

  const attendance = await Attendance.create({
    userId,
    date,
    status: "absent",
    isManual: true,
    validationStatus: "valid",
    validatedBy: req.user._id,
    remarks: remarks || `Marked absent by ${req.user.role}`,
  });

  await cacheRecord(attendance);

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Employee marked as absent",
    attendance,
  });
});

// PATCH /api/attendance/:id/day-type
const setDayType = asyncHandler(async (req, res) => {
  const { dayType } = req.body;

  if (!["half_day", "full_day"].includes(dayType)) {
    throw new AppError("dayType must be 'half_day' or 'full_day'", StatusCodes.BAD_REQUEST);
  }

  // Check Redis first
  const cKey = attendanceKey(req.params.id);
  const cached = await redis.get(cKey);

  const attendance = cached
    ? await Attendance.findById(JSON.parse(cached)._id).populate("userId", "name email managerId")
    : await Attendance.findById(req.params.id).populate("userId", "name email managerId");

  if (!attendance) throw new AppError("Attendance record not found", StatusCodes.NOT_FOUND);

  assertNotAdminLocked(attendance, req.user.role);

  if (req.user.role === "manager") {
    const employeeManagerId = attendance.userId?.managerId?.toString();
    if (employeeManagerId !== req.user._id.toString()) {
      throw new AppError("You can only update attendance of your own team members", StatusCodes.FORBIDDEN);
    }
  }

  attendance.status = dayType === "full_day" ? "completed" : "half_day";
  attendance.validatedBy = req.user._id;
  attendance.validationStatus = "valid";
  if (req.user.role === "admin") attendance.adminLocked = true;

  await attendance.save();
  await cacheRecord(attendance);

  res.status(StatusCodes.OK).json({
    success: true,
    message: `Attendance marked as ${dayType.replace("_", " ")}`,
    attendance,
  });
});

// GET /api/attendance/missed-punch?date=2026-06-07
// Returns employees who punched in but never punched out on the given date
// Manager → team only | Admin → everyone | Employee → own only
const getMissedPunches = asyncHandler(async (req, res) => {
  const date = req.query.date || todayDate();
  const role = req.user.role;

  const filter = {
    date,
    "punchIn.time": { $exists: true, $ne: null },
    $or: [
      { "punchOut.time": { $exists: false } },
      { "punchOut.time": null },
    ],
    status: { $ne: "absent" }, // exclude manually-created absent records
  };

  if (role === "employee") {
    filter.userId = req.user._id;
  } else if (role === "manager") {
    const teamMembers = await User.find({ managerId: req.user._id }, "_id");
    filter.userId = { $in: teamMembers.map((u) => u._id) };
  }
  // admin → no userId filter

  const records = await Attendance.find(filter).populate(
    "userId",
    "name email department"
  );

  const now = Date.now();
  const result = records.map((r) => {
    const punchInTime = new Date(r.punchIn.time).getTime();
    const hoursElapsed = parseFloat(((now - punchInTime) / 3_600_000).toFixed(2));
    return {
      attendanceId: r._id,
      date: r.date,
      employee: r.userId,
      punchIn: {
        time: r.punchIn.time,
        location: r.punchIn.location,
        selfie: r.punchIn.selfie,
      },
      status: r.status,
      hoursElapsed,
    };
  });

  res.status(StatusCodes.OK).json({
    success: true,
    date,
    total: result.length,
    records: result,
  });
});

module.exports = {
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
};
