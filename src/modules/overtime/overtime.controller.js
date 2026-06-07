const { StatusCodes } = require("http-status-codes");
const Overtime = require("./overtime.model");
const Attendance = require("../attendance/attendance.model");
const User = require("../users/user.model");
const AppError = require("../../shared/utils/AppError");
const asyncHandler = require("../../shared/utils/asyncHandler");

// POST /api/overtime
const requestOvertime = asyncHandler(async (req, res) => {
  const { date, requestedHours, reason, attendanceId } = req.body;
  const userId = req.user._id;

  if (!date || !requestedHours || !reason) {
    throw new AppError(
      "date, requestedHours and reason are required",
      StatusCodes.BAD_REQUEST
    );
  }

  const existing = await Overtime.findOne({ userId, date });
  if (existing) {
    throw new AppError(
      "Overtime request already submitted for this date",
      StatusCodes.CONFLICT
    );
  }

  const overtime = await Overtime.create({
    userId,
    date,
    requestedHours,
    reason,
    attendanceId: attendanceId || null,
  });

  // Tell the employee who will review their request
  const employee = await User.findById(userId, "managerId").populate("managerId", "name email role");

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Overtime request submitted",
    overtime,
    willBeReviewedBy: employee?.managerId
      ? { _id: employee.managerId._id, name: employee.managerId.name, role: employee.managerId.role }
      : null,
  });
});

// GET /api/overtime/my
const getMyOvertime = asyncHandler(async (req, res) => {
  const { status, month } = req.query;
  const filter = { userId: req.user._id };

  if (status) filter.status = status;
  if (month) filter.date = { $regex: `^${month}` };

  const records = await Overtime.find(filter)
    .populate("attendanceId", "workingHours status approvedOvertimeHours")
    .populate("reviewedBy", "name role")
    .populate({ path: "userId", select: "name managerId", populate: { path: "managerId", select: "name role" } })
    .sort({ createdAt: -1 });

  res.status(StatusCodes.OK).json({
    success: true,
    total: records.length,
    records,
  });
});

// GET /api/overtime  — manager/admin
const getAllOvertime = asyncHandler(async (req, res) => {
  const { status, userId, month, date } = req.query;
  const filter = {};

  if (status) filter.status = status;
  if (date) filter.date = date;
  if (month) filter.date = { $regex: `^${month}` };

  if (req.user.role === "manager") {
    const teamMembers = await User.find({ managerId: req.user._id }, "_id");
    const teamIds = teamMembers.map((u) => u._id.toString());

    if (userId) {
      if (!teamIds.includes(userId)) {
        throw new AppError("This employee is not in your team", StatusCodes.FORBIDDEN);
      }
      filter.userId = userId;
    } else {
      filter.userId = { $in: teamIds };
    }
  } else if (userId) {
    filter.userId = userId;
  }

  const records = await Overtime.find(filter)
    .populate("userId", "name email department")
    .populate("reviewedBy", "name role")
    .sort({ createdAt: -1 });

  res.status(StatusCodes.OK).json({
    success: true,
    total: records.length,
    records,
  });
});

// PATCH /api/overtime/:id/review  — manager/admin
const reviewOvertime = asyncHandler(async (req, res) => {
  const { status, reviewRemarks } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    throw new AppError(
      "status must be 'approved' or 'rejected'",
      StatusCodes.BAD_REQUEST
    );
  }

  const overtime = await Overtime.findById(req.params.id)
    .populate("userId", "name email managerId")
    .populate("reviewedBy", "name role");

  if (!overtime) {
    throw new AppError("Overtime request not found", StatusCodes.NOT_FOUND);
  }

  // ── Already reviewed — apply hierarchy rules ──────────────────────────────
  if (overtime.status !== "pending") {
    const reviewerRole = overtime.reviewedBy?.role;
    const reviewerName = overtime.reviewedBy?.name || "someone";

    if (reviewerRole === "admin") {
      // Admin finalized it — nobody can override, not even another admin
      throw new AppError(
        `This request was finalised by admin "${reviewerName}" and cannot be changed by anyone.`,
        StatusCodes.FORBIDDEN
      );
    }

    if (req.user.role !== "admin") {
      // Manager reviewed it — only admin can override
      throw new AppError(
        `This request was ${overtime.status} by manager "${reviewerName}". Only admin can override it.`,
        StatusCodes.FORBIDDEN
      );
    }

    // Admin overriding a manager's decision — undo previous attendance update first
    if (overtime.attendanceId) {
      await Attendance.findByIdAndUpdate(overtime.attendanceId, {
        $set: { approvedOvertimeHours: null },
      });
    }
  }

  // ── Team lead check (managers only) ──────────────────────────────────────
  if (req.user.role === "manager") {
    const employeeManagerId = overtime.userId?.managerId?.toString();

    if (!employeeManagerId) {
      throw new AppError(
        "This employee has no assigned team lead. Only admin can review this request.",
        StatusCodes.FORBIDDEN
      );
    }

    if (employeeManagerId !== req.user._id.toString()) {
      throw new AppError(
        "Only this employee's direct team lead can approve or reject their overtime.",
        StatusCodes.FORBIDDEN
      );
    }
  }

  overtime.status = status;
  overtime.reviewedBy = req.user._id;
  overtime.reviewedAt = new Date();
  overtime.reviewRemarks = reviewRemarks || null;

  await overtime.save();

  // On approval — store approved overtime hours on the attendance record
  if (status === "approved" && overtime.attendanceId) {
    await Attendance.findByIdAndUpdate(overtime.attendanceId, {
      $set: { approvedOvertimeHours: overtime.requestedHours },
    });
  }

  // Populate reviewer name + role for the response
  await overtime.populate("reviewedBy", "name role");

  res.status(StatusCodes.OK).json({
    success: true,
    message: `Overtime request ${status}`,
    overtime,
  });
});

// GET /api/overtime/:id  — owner, manager (team only), admin
const getOvertimeById = asyncHandler(async (req, res) => {
  const overtime = await Overtime.findById(req.params.id)
    .populate("userId", "name email department managerId")
    .populate("attendanceId", "date workingHours status approvedOvertimeHours")
    .populate("reviewedBy", "name role");

  if (!overtime) {
    throw new AppError("Overtime request not found", StatusCodes.NOT_FOUND);
  }

  const requesterId = req.user._id.toString();
  const ownerId = overtime.userId._id.toString();

  if (req.user.role === "employee" && requesterId !== ownerId) {
    throw new AppError("Not authorized to view this request", StatusCodes.FORBIDDEN);
  }

  if (req.user.role === "manager") {
    const employeeManagerId = overtime.userId?.managerId?.toString();
    if (employeeManagerId !== requesterId) {
      throw new AppError("This employee is not in your team", StatusCodes.FORBIDDEN);
    }
  }

  res.status(StatusCodes.OK).json({ success: true, overtime });
});

// DELETE /api/overtime/:id  — employee cancels their own pending request
const cancelOvertime = asyncHandler(async (req, res) => {
  const overtime = await Overtime.findById(req.params.id);

  if (!overtime) {
    throw new AppError("Overtime request not found", StatusCodes.NOT_FOUND);
  }

  if (overtime.userId.toString() !== req.user._id.toString()) {
    throw new AppError("You can only cancel your own requests", StatusCodes.FORBIDDEN);
  }

  if (overtime.status !== "pending") {
    throw new AppError(
      `Cannot cancel a request that is already ${overtime.status}`,
      StatusCodes.CONFLICT
    );
  }

  await overtime.deleteOne();

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Overtime request cancelled",
  });
});

module.exports = { requestOvertime, getMyOvertime, getOvertimeById, getAllOvertime, reviewOvertime, cancelOvertime };
