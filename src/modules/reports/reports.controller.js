const { StatusCodes } = require("http-status-codes");
const asyncHandler = require("../../shared/utils/asyncHandler");
const Attendance = require("../attendance/attendance.model");
const User = require("../users/user.model");
const XLSX = require("xlsx");

// GET /api/reports/attendance
// Employee → own, Manager → team, Admin → all
const attendanceReport = asyncHandler(async (req, res) => {
  const { date, month, userId, status, validationStatus } = req.query;
  const role = req.user.role;

  const filter = {};

  // Scope by role
  if (role === "employee") {
    filter.userId = req.user._id;
  } else if (role === "manager") {
    const teamMembers = await User.find({ managerId: req.user._id }).select("_id");
    const teamIds = teamMembers.map((u) => u._id);
    filter.userId = userId ? userId : { $in: teamIds };
  } else if (role === "admin" && userId) {
    filter.userId = userId;
  }

  if (date) filter.date = date;
  if (month) filter.date = { $regex: `^${month}` };
  if (status) filter.status = status;
  if (validationStatus) filter.validationStatus = validationStatus;

  const records = await Attendance.find(filter)
    .populate("userId", "name email department role")
    .populate("validatedBy", "name")
    .sort({ date: -1 });

  // Shape report rows
  const report = records.map((r) => ({
    _id: r._id,
    date: r.date,
    employee: r.userId,
    punchIn: {
      time: r.punchIn?.time,
      selfie: r.punchIn?.selfie,
      location: r.punchIn?.location,
    },
    punchOut: {
      time: r.punchOut?.time,
      selfie: r.punchOut?.selfie,
      location: r.punchOut?.location,
    },
    workingHours: r.workingHours,
    status: r.status,
    validationStatus: r.validationStatus,
    validatedBy: r.validatedBy,
    remarks: r.remarks,
    earlyExitReason: r.earlyExitReason,
  }));

  res.status(StatusCodes.OK).json({
    success: true,
    total: report.length,
    report,
  });
});

// GET /api/reports/daily?date=2026-06-07
// Returns every employee with their attendance for that date (present + absent combined)
// Employee → own only | Manager → team only | Admin → everyone
const dailyReport = asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const role = req.user.role;

  // Determine which users to include — admins are never part of attendance tracking
  let userFilter = { isActive: true, role: { $ne: "admin" } };
  if (role === "employee") {
    userFilter._id = req.user._id;
  } else if (role === "manager") {
    userFilter.managerId = req.user._id;
  }
  // admin → sees all non-admin users

  const users = await User.find(userFilter, "name email department role managerId");
  const userIds = users.map((u) => u._id);

  // Get attendance records for those users on that date
  const records = await Attendance.find(
    { userId: { $in: userIds }, date },
    "userId punchIn punchOut workingHours status validationStatus earlyExitReason remarks isManual"
  );

  // Key records by userId string for O(1) lookup
  const recordMap = {};
  for (const r of records) {
    recordMap[r.userId.toString()] = r;
  }

  // Build combined rows — one per user regardless of whether they punched in
  const rows = users.map((user) => {
    const uid = user._id.toString();
    const record = recordMap[uid] || null;

    return {
      employee: {
        _id: user._id,
        name: user.name,
        email: user.email,
        department: user.department,
        role: user.role,
      },
      date,
      status: record ? record.status : "absent",
      punchIn: record?.punchIn
        ? {
            time: record.punchIn.time,
            selfie: record.punchIn.selfie,
            location: record.punchIn.location,
          }
        : null,
      punchOut: record?.punchOut?.time
        ? {
            time: record.punchOut.time,
            selfie: record.punchOut.selfie,
            location: record.punchOut.location,
          }
        : null,
      workingHours: record?.workingHours ?? null,
      earlyExitReason: record?.earlyExitReason ?? null,
      validationStatus: record?.validationStatus ?? null,
      remarks: record?.remarks ?? null,
      isManual: record?.isManual ?? false,
      attendanceId: record?._id ?? null,
    };
  });

  // Summary counts
  const summary = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    { completed: 0, ongoing: 0, incomplete: 0, half_day: 0, absent: 0 }
  );

  res.status(StatusCodes.OK).json({
    success: true,
    date,
    total: rows.length,
    summary,
    records: rows,
  });
});

// GET /api/reports/export?format=csv&month=2026-06  (or &date=2026-06-07)
// Same role scoping as attendanceReport — downloads a CSV file
const exportReport = asyncHandler(async (req, res) => {
  const { date, month, userId, status, format = "csv" } = req.query;
  const role = req.user.role;

  const filter = {};

  if (role === "employee") {
    filter.userId = req.user._id;
  } else if (role === "manager") {
    const teamMembers = await User.find({ managerId: req.user._id }, "_id");
    filter.userId = userId ? userId : { $in: teamMembers.map((u) => u._id) };
  } else if (role === "admin" && userId) {
    filter.userId = userId;
  }

  if (date) filter.date = date;
  if (month) filter.date = { $regex: `^${month}` };
  if (status) filter.status = status;

  const records = await Attendance.find(filter)
    .populate("userId", "name email department")
    .sort({ date: -1 });

  const headers = [
    "Name", "Email", "Department",
    "Date",
    "Punch In Time", "Punch In Lat", "Punch In Lng", "Punch In Selfie",
    "Punch Out Time", "Punch Out Lat", "Punch Out Lng", "Punch Out Selfie",
    "Working Hours", "Status", "Validation Status",
    "Early Exit Reason", "Remarks",
  ];

  const rows = records.map((r) => [
    r.userId?.name        ?? "",
    r.userId?.email       ?? "",
    r.userId?.department  ?? "",
    r.date                ?? "",
    r.punchIn?.time  ? new Date(r.punchIn.time).toISOString()  : "",
    r.punchIn?.location?.latitude  ?? "",
    r.punchIn?.location?.longitude ?? "",
    r.punchIn?.selfie  ?? "",
    r.punchOut?.time ? new Date(r.punchOut.time).toISOString() : "",
    r.punchOut?.location?.latitude  ?? "",
    r.punchOut?.location?.longitude ?? "",
    r.punchOut?.selfie ?? "",
    r.workingHours     ?? "",
    r.status           ?? "",
    r.validationStatus ?? "",
    r.earlyExitReason  ?? "",
    r.remarks          ?? "",
  ]);

  const label = month || date || "report";
  const isExcel = format === "excel" || format === "xlsx";

  if (isExcel) {
    // ── Proper .xlsx using SheetJS ───────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Bold header row
    const headerRange = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { font: { bold: true } };
    }

    // Auto column widths based on content
    ws["!cols"] = headers.map((h, i) => {
      const maxLen = Math.max(
        h.length,
        ...rows.map((r) => String(r[i] ?? "").length)
      );
      return { wch: Math.min(maxLen + 2, 40) };
    });

    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="attendance_${label}.xlsx"`);
    return res.status(200).send(buffer);
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  const escapeCSV = (val) => {
    if (val == null) return "";
    const str = String(val);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCSV).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="attendance_${label}.csv"`);
  res.status(200).send(csv);
});

module.exports = { attendanceReport, dailyReport, exportReport };
