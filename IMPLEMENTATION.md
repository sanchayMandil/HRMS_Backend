# HRMS Attendance Management System — Backend Implementation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Express 5.x |
| Database | MongoDB Atlas + Mongoose 9 |
| Cache / Session Store | Redis (Upstash) via ioredis with TLS (`rediss://`) |
| Auth | JWT access (15 min) + refresh (7 day) tokens in httpOnly cookies |
| File Storage | Cloudinary (punch-in/out selfies, base64 upload) |
| Excel Export | SheetJS (`xlsx`) |
| Geofence | Haversine formula (configurable radius, default 100 m) |

---

## Environment Variables Required

```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173

MONGODB_URI=mongodb+srv://...

JWT_SECRET=long_random_string_min_32_chars
JWT_EXPIRES_IN=15m

JWT_REFRESH_SECRET=different_long_random_string
JWT_REFRESH_EXPIRES_IN=7d

REDIS_URL=rediss://...

CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

> `JWT_EXPIRES_IN` must be `15m` — not `7d`. The cookie lives 7 days (so the browser keeps sending the expired JWT), but the JWT itself expires in 15 min to trigger silent refresh.

---

## What Was Required by the PDF

### 1. Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login — sets `token` + `refreshToken` httpOnly cookies |
| POST | `/api/auth/refresh` | Manually rotate tokens (rarely needed — server does it silently) |
| POST | `/api/auth/logout` | Clear cookies + delete Redis session |
| GET | `/api/auth/me` | Get current user from cache |

### 2. Punch In / Punch Out
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/attendance/punch-in` | Punch in with GPS + optional base64 selfie |
| POST | `/api/attendance/punch-out` | Punch out with GPS + optional selfie + early exit reason |

- Geofence: rejects if employee is more than `radius` metres from office
- Selfie uploaded to Cloudinary, URL stored in DB
- Rate limited: 5 punches/hr per user ID (not IP — office shares one IP)

### 3. Attendance Records
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/attendance/today` | All | Today's record (Redis cached until midnight) |
| GET | `/api/attendance/me` | All | Own history with filters |
| GET | `/api/attendance/` | Admin, Manager | All records — manager scoped to team |
| PATCH | `/api/attendance/:id/validate` | Admin, Manager | Approve or reject a record |

### 4. Overtime
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/overtime/` | All | Submit overtime request |
| GET | `/api/overtime/my` | All | Own requests |
| GET | `/api/overtime/` | Admin, Manager | All requests — manager scoped to team |
| PATCH | `/api/overtime/:id/review` | Admin, Manager | Approve or reject |

### 5. Reports
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/reports/attendance` | All | Attendance report with filters — role scoped |

### 6. Dashboard
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/dashboard/` | All | Role-based dashboard — employee / manager / admin |

**Query params accepted:**
| Param | Type | Default | Effect |
|-------|------|---------|--------|
| `date` | `YYYY-MM-DD` | today | Attendance snapshot date |
| `month` | `YYYY-MM` | derived from `date` | Month for stats and overtime summary |

**Employee response:**
```json
{
  "success": true,
  "dashboard": {
    "date": "2026-06-08",
    "month": "2026-06",
    "today": {
      "_id": "664abc...",
      "date": "2026-06-08",
      "punchIn": { "time": "2026-06-08T09:15:00.000Z", "selfie": "https://res.cloudinary.com/...", "location": { "latitude": 28.6139, "longitude": 77.2090 } },
      "punchOut": null,
      "workingHours": null,
      "status": "ongoing",
      "validationStatus": "pending"
    },
    "monthStats": {
      "totalRecords": 18,
      "completedDays": 15,
      "incompleteDays": 1,
      "halfDays": 1,
      "absentDays": 1,
      "totalHours": 122.5,
      "averageHours": 8.17
    },
    "overtime": { "total": 3, "pending": 1, "approved": 2, "rejected": 0 }
  }
}
```
> `today` is `null` if the employee has not punched in yet for that date.

**Manager response:**
```json
{
  "success": true,
  "dashboard": {
    "date": "2026-06-08",
    "month": "2026-06",
    "team": {
      "total": 4,
      "present": 2,
      "absent": 1,
      "notPunched": 1,
      "members": [
        { "_id": "663a...", "name": "Rahul Gupta", "email": "rahul@company.com", "department": "Engineering", "todayStatus": "ongoing" },
        { "_id": "663b...", "name": "Priya Sharma", "email": "priya@company.com", "department": "Engineering", "todayStatus": "completed" },
        { "_id": "663c...", "name": "Amit Singh",  "email": "amit@company.com",  "department": "Engineering", "todayStatus": "absent" },
        { "_id": "663d...", "name": "Neha Verma",  "email": "neha@company.com",  "department": "Engineering", "todayStatus": "not_punched" }
      ]
    },
    "pendingOvertime": {
      "count": 2,
      "requests": [
        { "_id": "665...", "userId": { "name": "Rahul Gupta", "email": "rahul@company.com" }, "date": "2026-06-07", "requestedHours": 2, "reason": "Project deadline", "status": "pending" }
      ]
    }
  }
}
```

**`todayStatus` values (manager + admin):**
| Value | Meaning |
|-------|---------|
| `ongoing` | Punched in, not yet out |
| `completed` | Punched in + out |
| `incomplete` | Punched in, missed punch-out (auto-marked at midnight) |
| `half_day` | Set manually by manager/admin |
| `absent` | Explicitly marked absent by manager/admin |
| `not_punched` | No record — hasn't arrived yet today |

**Admin response:**
```json
{
  "success": true,
  "dashboard": {
    "date": "2026-06-08",
    "month": "2026-06",
    "users": { "total": 12, "nonAdmin": 10 },
    "today": {
      "present": 7,
      "absent": 3,
      "records": [
        { "_id": "664...", "userId": { "name": "Rahul Gupta", "role": "employee", "department": "Engineering" }, "date": "2026-06-08", "status": "ongoing", "punchIn": { "time": "2026-06-08T09:15:00.000Z" }, "punchOut": null, "workingHours": null, "validationStatus": "pending" }
      ]
    },
    "month": {
      "totalRecords": 180,
      "completed": 140,
      "incomplete": 15,
      "halfDay": 10,
      "absent": 15,
      "totalHours": 1140.5,
      "pendingValidation": 22
    },
    "pendingOvertime": 5
  }
}
```
> `today.absent` = `nonAdmin` total − employees with a punch record. Admins are always excluded from all counts.

### 7. Settings
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/settings/office` | All | Get office location + radius |
| PUT | `/api/settings/office` | Admin | Set office location + radius |

### 8. RBAC
- Three roles: `admin` / `manager` / `employee`
- Every route protected with `protect` middleware (JWT verify + silent refresh)
- Role gating via `authorize(...roles)` middleware
- Managers scoped to their team across all modules

### Bonus Features (from PDF)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/export` | CSV or Excel download — role scoped |
| GET | `/api/attendance/missed-punch` | Employees who punched in but not out |

---

## What Was Built Extra (Beyond PDF)

### 1. Silent Token Refresh (Server-Side)
The `protect` middleware silently handles expired access tokens — no frontend interceptor needed:

```
Request with expired access token
  ↓ jwt.verify() → TokenExpiredError
  ↓ reads req.cookies.refreshToken
  ↓ jwt.verify(refreshToken, JWT_REFRESH_SECRET) → OK
  ↓ redis.get("refresh:{role}:{id}") → matches cookie → OK
  ↓ issues new access token + new refresh token
  ↓ sets both as new httpOnly cookies in the response
  ↓ original request continues normally ✓
```

- Access token cookie `maxAge` = 7 days (so browser keeps sending the expired JWT)
- JWT `expiresIn` = 15 min (what actually expires for security)
- If refresh token is also expired → 401 "Session expired" → frontend redirects to login

### 2. Redis Caching Layer
| Cache Key | TTL | Purpose |
|-----------|-----|---------|
| `user:{role}:{id}` | 15 min | User object — skips DB on every authenticated request |
| `refresh:{role}:{id}` | 7 days | Stored refresh token for validation + instant revocation on logout |
| `attendance:record:{id}` | 24 hr | Individual attendance record lookup |
| `attendance:today:{userId}` | Until midnight | Today's punch status — dashboard + getTodayStatus |

Historical date queries bypass the today cache and go directly to DB.

### 3. Rate Limiting
| Limiter | Window | Max | Key | Notes |
|---------|--------|-----|-----|-------|
| Auth (login/register) | 15 min | 10 | IP | `skipSuccessfulRequests: true` — only counts failures |
| Token refresh | 15 min | 30 | IP | — |
| Punch in/out | 1 hour | 5 | User ID | Uses `ipKeyGenerator` fallback for IPv6 safety |
| Global API | 15 min | 200 | IP | Skips `/api/health` |

### 4. Team Assignment System
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| PATCH | `/api/users/:id/assign-manager` | Admin | Assign employee to a manager's team |
| DELETE | `/api/users/:id/assign-manager` | Admin | Remove employee from team |
| GET | `/api/users/teams` | Admin | All teams + members + unassigned employees |
| GET | `/api/users/my-team` | Admin, Manager | Manager sees own team |

- `managerId` field on User model links employee → manager
- Every attendance, overtime, and report query checks `managerId` for manager-role requests
- Assigning clears the Redis user cache for the affected employee

### 5. Admin Lock on Attendance Records
- `adminLocked: Boolean` field on every Attendance document
- Set to `true` automatically when admin creates, edits, or validates a record
- `assertNotAdminLocked(record, callerRole)` guard called at the top of every write handler
- Bulk validate skips locked records and reports `{ updated, skipped }` count

### 6. Overtime Approval Hierarchy
```
Employee submits → assigned to team manager

Manager reviews → status: approved / rejected

Admin can override manager's decision at any time

Once admin makes a decision → FINAL
  No one can change it — not another admin, not the manager
```

- `reviewedBy` is populated at query time so the role can be checked server-side
- `approvedOvertimeHours` field on Attendance records the actual approved hours

### 7. Mark Absent
- `POST /api/attendance/team/mark-absent`
- Manager can only mark their own team members
- Creates an Attendance document with `status: "absent"`, `isManual: true`
- If record already exists for that date → returns conflict error

### 8. Set Day Type
- `PATCH /api/attendance/:id/day-type`
- Body: `{ "dayType": "half_day" | "full_day" }`
- `full_day` resets status back to `completed` or `incomplete` based on whether punchOut exists
- Respects admin lock — managers blocked if `adminLocked: true`

### 9. Manual Attendance Entry
- `POST /api/attendance/admin/manual` — admin only
- Creates a full attendance record for any employee for any past/present date
- Auto-sets `isManual: true` and `adminLocked: true`
- Calculates `workingHours` from provided punch times

### 10. Bulk Validate
- `PATCH /api/attendance/admin/bulk-validate`
- Body: `{ ids: [...], validationStatus: "approved", remarks: "..." }`
- Processes up to N records in one call
- Skips `adminLocked` records for non-admins
- Returns: `{ updated: 3, skipped: 1 }`

### 11. Auto-Mark Incomplete (Midnight Job)
- Runs at server startup + schedules itself for next midnight + every 24 h
- `Attendance.updateMany({ status: "ongoing", date: { $lt: today } }, { status: "incomplete" })`
- No external cron package — uses native `setTimeout` with dynamic delay to midnight
- Note: not suitable for Render free tier (server sleeps); workaround is a manual trigger endpoint or external cron service (cron-job.org)

### 12. Daily Report
- `GET /api/reports/daily?date=2026-06-08`
- Shows **every** employee (present AND absent) for a date in one response
- Admins excluded from count (they don't punch in/out)
- Summary counts by status: `{ completed, ongoing, incomplete, half_day, absent }`
- Manager scoped to team; employee sees only own record

### 13. Export Reports (CSV + Excel)
- `GET /api/reports/export?format=csv&month=2026-06`
- `GET /api/reports/export?format=excel&date=2026-06-07`

| Param | Options | Default |
|-------|---------|---------|
| `format` | `csv`, `excel`, `xlsx` | `csv` |
| `date` | `YYYY-MM-DD` | — |
| `month` | `YYYY-MM` | — |
| `userId` | ObjectId | — |
| `status` | enum | — |

- **CSV**: manual string build, `Content-Disposition: attachment`
- **Excel**: real `.xlsx` via SheetJS — bold headers, auto-sized columns, no format-mismatch warning
- Columns: Name, Email, Department, Date, Punch In Time/Lat/Lng/Selfie, Punch Out Time/Lat/Lng/Selfie, Working Hours, Status, Validation Status, Early Exit Reason, Remarks

### 14. Missed Punch Detection
- `GET /api/attendance/missed-punch?date=2026-06-07`
- Returns employees with `punchIn.time` set but `punchOut.time` null for the given date
- Includes `hoursElapsed` since punch-in
- Manager scoped to team; admin sees all

### 15. Enhanced Health Endpoint
- `GET /api/health` — no auth required
- Checks `mongoose.connection.readyState` (1 = connected)
- Sends Redis `PING`, expects `PONG`
- Returns HTTP 200 if both healthy, 503 if either is down

```json
{
  "success": true,
  "status": "healthy",
  "services": {
    "server": "up",
    "mongodb": { "status": "connected", "ok": true },
    "redis":   { "status": "connected", "ok": true }
  },
  "timestamp": "2026-06-08T10:00:00.000Z"
}
```

### 16. ETags Disabled
- `app.set("etag", false)` in `app.js`
- Prevents Express from sending `ETag` headers
- Fixes `304 Not Modified` responses on attendance endpoints where data changes in real time

### 17. Overtime Cancel + Get by ID
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| DELETE | `/api/overtime/:id` | Owner | Cancel own pending request only |
| GET | `/api/overtime/:id` | Owner / team manager / admin | View single overtime request |

### 18. Dashboard Date Filter
- `GET /api/dashboard/?date=2026-06-07` — historical snapshot for any date
- `GET /api/dashboard/?date=2026-06-07&month=2026-05` — different date + different month stats
- For today: Redis cache used; for historical dates: DB queried directly

### 19. Admin Count Fix in Reports
- `dailyReport`, `getAdminSummary`, `getAbsentEmployees` all apply `role: { $ne: "admin" }` to user queries
- Admins never appear as "absent" in attendance counts or daily reports

---

## Database Models

### User
```
name          String  required
email         String  required, unique
password      String  bcrypt hashed, select: false
role          String  enum: admin / manager / employee, default: employee
department    String
managerId     ObjectId  ref: User  (links employee to their manager)
isActive      Boolean default: true
```

### Attendance
```
userId              ObjectId  ref: User
date                String    YYYY-MM-DD  (unique per user per day)
punchIn             { time, selfie, selfiePublicId, location: { latitude, longitude } }
punchOut            { time, selfie, selfiePublicId, location: { latitude, longitude } }
workingHours        Number    hours, e.g. 8.5
status              String    ongoing / completed / incomplete / half_day / absent
validationStatus    String    pending / valid / invalid
validatedBy         ObjectId  ref: User
remarks             String
earlyExitReason     String
isManual            Boolean   default: false
adminLocked         Boolean   default: false
approvedOvertimeHours Number
```
Unique index: `{ userId: 1, date: 1 }`

### Overtime
```
userId          ObjectId  ref: User
attendanceId    ObjectId  ref: Attendance
date            String    YYYY-MM-DD
requestedHours  Number    min: 0.5, max: 8
reason          String    required
status          String    pending / approved / rejected
reviewedBy      ObjectId  ref: User
reviewedAt      Date
reviewRemarks   String
```
Unique index: `{ userId: 1, date: 1 }`

### Settings
```
officeName    String
location      { latitude: Number, longitude: Number }
radius        Number  metres, default: 100
```

---

## Auth Flow

```
POST /auth/login
  ↓
Server sets two httpOnly cookies:
  token         JWT, exp 15 min,  cookie maxAge 7 days
  refreshToken  JWT, exp 7 days,  cookie maxAge 7 days

Redis stores: refresh:{role}:{id} = refreshToken value

─────────────────────────────────────────────────────

Every request → protect middleware:
  reads req.cookies.token
  jwt.verify() → OK → fetch user from Redis or DB → next()

─────────────────────────────────────────────────────

After 15 min — access token expires:
  jwt.verify() → TokenExpiredError
  reads req.cookies.refreshToken
  jwt.verify(refreshToken) → OK
  redis.get("refresh:{role}:{id}") → matches → OK
  issues new access + refresh tokens
  sets new cookies
  original request continues ✓

─────────────────────────────────────────────────────

After 7 days — refresh token expires:
  jwt.verify(refreshToken) → TokenExpiredError
  → 401 "Refresh token expired, please log in again"
  → frontend redirects to /login
```

---

## Security Summary

| Feature | Detail |
|---------|--------|
| Password hashing | bcrypt |
| Access token | JWT 15 min, httpOnly cookie maxAge 7 days |
| Refresh token | JWT 7 days, httpOnly cookie + Redis store |
| Silent refresh | Server-side in `protect` — zero frontend work |
| Token revocation | Logout deletes Redis key — stolen token instantly dead |
| Single session | Each login overwrites Redis key — old device gets 401 |
| Geofence | Haversine, configurable radius via Settings |
| Rate limiting | Per-user for punch, per-IP for auth + global |
| CORS | Explicit origin whitelist, `credentials: true`, no wildcard |
| ETags | Disabled — no stale 304 on real-time attendance data |
| Admin lock | Managers cannot override admin-validated records |

---

## Frontend Integration Requirements

| Requirement | Detail |
|-------------|--------|
| `withCredentials: true` | Must be set on axios instance (or `credentials: "include"` on fetch) |
| No token storage | Tokens are in httpOnly cookies — JS cannot read them |
| No refresh interceptor | Server refreshes silently — remove any 401 interceptor that calls `/auth/refresh` |
| On 401 | Redirect to `/login` — means full session expired (7 days) |
| CSV/Excel download | Use `window.location.href = url` — not fetch — to trigger file download with cookies |

---

## API Summary

| Module | Endpoints |
|--------|-----------|
| Auth | 5 |
| Attendance | 15 |
| Users / Teams | 6 |
| Overtime | 6 |
| Reports | 3 |
| Dashboard | 1 |
| Settings | 2 |
| Health | 1 |
| **Total** | **39** |
