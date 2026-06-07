const USER_CACHE_TTL = 15 * 60; // 15 min — matches access token lifetime
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const userKey = (role, id) => `user:${role}:${id}`;
const refreshKey = (role, id) => `refresh:${role}:${id}`;

module.exports = { USER_CACHE_TTL, REFRESH_TTL_SECONDS, userKey, refreshKey };
