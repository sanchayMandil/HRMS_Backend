const mongoose = require("mongoose");

const punchSchema = new mongoose.Schema(
  {
    time: { type: Date },
    selfie: { type: String },        // Cloudinary URL
    selfiePublicId: { type: String }, // for deletion if needed
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: String, // "YYYY-MM-DD" — one record per employee per day
      required: true,
    },
    punchIn: { type: punchSchema, default: null },
    punchOut: { type: punchSchema, default: null },
    workingHours: {
      type: Number, // in hours, e.g. 8.5
      default: null,
    },
    status: {
      type: String,
      enum: ["ongoing", "completed", "incomplete", "half_day", "absent"],
      default: "ongoing",
    },
    validationStatus: {
      type: String,
      enum: ["pending", "valid", "invalid"],
      default: "pending",
    },
    validatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    remarks: {
      type: String,
      default: null,
    },
    earlyExitReason: {
      type: String,
      default: null,
    },
    isManual: {
      type: Boolean,
      default: false,
    },
    approvedOvertimeHours: {
      type: Number,
      default: null,
    },
    adminLocked: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// One record per employee per day
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
