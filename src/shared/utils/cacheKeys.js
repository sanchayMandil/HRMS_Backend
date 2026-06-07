const USER_CACHE_TTL = 15 * 60;          // 15 min — matches access token lifetime
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const ATTENDANCE_TTL = 24 * 60 * 60;     // 1 day

const userKey = (role, id) => `user:${role}:${id}`;
const refreshKey = (role, id) => `refresh:${role}:${id}`;
const attendanceKey = (id) => `attendance:record:${id}`;
const todayAttendanceKey = (userId) => `attendance:today:${userId}`;

// Seconds until next midnight — used for today's attendance TTL
const ttlUntilMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(60, Math.floor((midnight - now) / 1000));
};

module.exports = {
  USER_CACHE_TTL,
  REFRESH_TTL_SECONDS,
  ATTENDANCE_TTL,
  userKey,
  refreshKey,
  attendanceKey,
  todayAttendanceKey,
  ttlUntilMidnight,
};
