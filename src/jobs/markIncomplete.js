const Attendance = require("../modules/attendance/attendance.model");
const { appLogger } = require("../shared/logger");

const runMarkIncomplete = async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Any "ongoing" record from before today = employee never punched out
    const result = await Attendance.updateMany(
      { status: "ongoing", date: { $lt: today } },
      { $set: { status: "incomplete" } }
    );

    if (result.modifiedCount > 0) {
      appLogger.info("markIncomplete job: records updated", {
        count: result.modifiedCount,
        date: today,
      });
    }
  } catch (err) {
    appLogger.error("markIncomplete job failed", { message: err.message });
  }
};

const scheduleMarkIncomplete = () => {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0); // next midnight
  const msUntilMidnight = nextMidnight - now;

  appLogger.info("markIncomplete job scheduled", {
    runsAt: nextMidnight.toISOString(),
    inMinutes: Math.round(msUntilMidnight / 60000),
  });

  // First run at next midnight, then every 24 hours
  setTimeout(() => {
    runMarkIncomplete();
    setInterval(runMarkIncomplete, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  // Also run immediately on startup to catch any records missed while server was down
  runMarkIncomplete();
};

module.exports = scheduleMarkIncomplete;
