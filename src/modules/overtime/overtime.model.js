const mongoose = require("mongoose");

const overtimeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      default: null,
    },
    date: {
      type: String, // "YYYY-MM-DD"
      required: true,
    },
    requestedHours: {
      type: Number,
      required: true,
      min: [0.5, "Minimum overtime is 0.5 hours"],
      max: [8, "Maximum overtime is 8 hours"],
    },
    reason: {
      type: String,
      required: [true, "Reason for overtime is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewRemarks: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// One OT request per employee per day
overtimeSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Overtime", overtimeSchema);
