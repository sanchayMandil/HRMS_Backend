# HRMS Attendance Management System — Backend Implementation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Express 5.x |
| Database | MongoDB Atlas + Mongoose 9 |
| Cache / Session Store | Redis (Upstash) via ioredis |
| Auth | JWT (access + refresh tokens) in httpOnly cookies |
| File Storage | Cloudinary (punch-in/out selfies) |
| Excel Export | SheetJS (xlsx) |

---

## What Was Required by the PDF

### 1. Authentication
- `POST /api/auth/register` — register new user
- `POST /api/auth/login` — login with email + password
- `POST /api/auth/logout` — logout, clear session
- `GET /api/auth/me` — get current user

### 2. Punch In / Punch Out
- `POST /api/attendance/punch-in` — punch in with location + optional selfie
- `POST /api/attendance/punch-out` — punch out with location + optional selfie + early exit reason
- Geofence validation — 100m radius from office location
- Selfie upload to Cloudinary

### 3. Attendance Records
- `GET /api/attendance/today` — employee's today record
- `GET /api/attendance/me` — employee's own history
- `GET /api/attendance/` — admin/manager view all records
- `PATCH /api/attendance/:id/validate` — approve or reject a record

### 4. Overtime
- `POST /api/overtime/` — employee submits overtime request
- `GET /api/overtime/my` — employee's own requests
- `GET /api/overtime/` — admin/manager view all
- `PATCH /api/overtime/:id/review` — approve or reject overtime

### 5. Reports
- `GET /api/reports/attendance` — attendance report with filters

### 6. Dashboard
- `GET /api/dashboard/` — role-based dashboard (employee / manager / admin)

### 7. Settings
- `GET /api/settings/office` — get office geofence location
- `PUT /api/settings/office` — admin sets office location + radius

### 8. RBAC
- Three roles: `admin` / `manager` / `employee`
- Every route protected with `protect` + `authorize` middleware

### Bonus Features (from PDF)
- `GET /api/reports/export` — CSV + Excel download (bonus)
- `GET /api/attendance/missed-punch` — detect employees who punched in but not out (bonus)

---

## What Was Built Extra (Beyond PDF)

### 1. Silent Token Refresh (Server-Side)
Access token expires in 15 min. Instead of returning 401 and making the frontend call the refresh endpoint manually, the `protect` middleware automatically:
1. Detects expired access token
2. Reads the refresh token cookie
3. Verifies it + checks Redis
4. Issues new access + refresh tokens silently
5. Continues the original request

Frontend never sees a 401 for token expiry. Zero frontend interceptors needed.

### 2. Redis Caching Layer
| Cache Key | TTL | Purpose |
|-----------|-----|---------|
| `user:{role}:{id}` | 15 min | User object — skips DB on every request |
| `refresh:{role}:{id}` | 7 days | Refresh token validation + instant revocation |
| `attendance:record:{id}` | 24 hr | Individual attendance records |
| `attendance:today:{userId}` | Until midnight | Today's punch status |

### 3. Rate Limiting
| Limiter | Limit | Scope |
|---------|-------|-------|
| Auth (login/register) | 10 req / 15 min | Per IP, skips successful requests |
| Token refresh | 30 req / 15 min | Per IP |
| Punch in/out | 5 req / hr | Per user ID (not IP — office shares one IP) |
| Global API | 200 req / 15 min | Per IP |

### 4. Team Assignment System
- `PATCH /api/users/:id/assign-manager` — admin assigns employee to a manager's team
- `DELETE /api/users/:id/assign-manager` — remove from team
- `GET /api/users/teams` — view all teams with members + unassigned employees
- `GET /api/users/my-team` — manager sees their own team
- Managers are scoped to their team across all endpoints (attendance, overtime, reports)

### 5. Admin Lock on Records
- `adminLocked: Boolean` field on every attendance record
- Once an admin validates/edits a record, `adminLocked = true`
- Managers cannot override admin-locked records
- Bulk validate skips locked records and reports `skipped` count

### 6. Overtime Approval Hierarchy
```
Employee submits → goes to their team manager
Manager approves/rejects → manager decision recorded

Admin can override manager's decision
Once admin makes a decision → FINAL, nobody can change it (not even another admin)
```

### 7. Mark Absent
- `POST /api/attendance/team/mark-absent` — manager/admin marks employee as absent for a date
- Manager can only mark their own team members
- Creates an attendance record with `status: "absent"`

### 8. Set Day Type
- `PATCH /api/attendance/:id/day-type` — set `half_day` or revert to `full_day`
- Respects admin lock
- Manager team-scoped

### 9. Manual Attendance Entry (Admin)
- `POST /api/attendance/admin/manual` — admin creates attendance record for any employee for any date
- Sets `isManual: true` and `adminLocked: true` automatically

### 10. Bulk Validate
- `PATCH /api/attendance/admin/bulk-validate` — approve/reject multiple records in one call
- Skips admin-locked records, reports how many were skipped

### 11. Auto-Mark Incomplete
- Cron job that runs at midnight
- Updates all `status: "ongoing"` records from past dates to `status: "incomplete"`
- Employees who punched in but forgot to punch out are automatically marked incomplete

### 12. Daily Report
- `GET /api/reports/daily?date=2026-06-08`
- Shows EVERY employee (present AND absent) for a given date in one response
- Includes summary counts by status
- Admins excluded from the count (they don't punch in/out)

### 13. Excel Export with Proper Formatting
- `GET /api/reports/export?format=excel` — generates real `.xlsx` file using SheetJS
- `GET /api/reports/export?format=csv` — generates `.csv` file
- Bold header row, auto-sized columns
- Role-scoped (employee sees own, manager sees team, admin sees all)

### 14. Enhanced Health Endpoint
- `GET /api/health` — no auth required
- Checks MongoDB connection state
- Checks Redis with PING
- Returns 200 if healthy, 503 if degraded

### 15. ETags Disabled
- `app.set("etag", false)` — prevents browser from caching API responses
- Fixes 304 Not Modified issues on attendance data that changes frequently

### 16. Overtime Cancel
- `DELETE /api/overtime/:id` — employee cancels their own pending request
- Cannot cancel once reviewed (approved/rejected)

### 17. Get Overtime by ID
- `GET /api/overtime/:id` — access controlled
- Owner, their team manager, or admin can view

---

## Database Models

### User
```
name, email, password (bcrypt), role (admin/manager/employee),
department, managerId (ref: User), isActive
```

### Attendance
```
userId, date (YYYY-MM-DD), punchIn { time, selfie, location },
punchOut { time, selfie, location }, workingHours,
status (ongoing/completed/incomplete/half_day/absent),
validationStatus (pending/valid/invalid), validatedBy,
remarks, earlyExitReason, isManual, adminLocked, approvedOvertimeHours
```
Unique index: `{ userId, date }`

### Overtime
```
userId, attendanceId, date, requestedHours (0.5–8),
reason, status (pending/approved/rejected),
reviewedBy, reviewedAt, reviewRemarks
```
Unique index: `{ userId, date }`

### Settings
```
officeName, location { latitude, longitude }, radius (metres, default 100)
```

---

## Security

| Feature | Implementation |
|---------|---------------|
| Password hashing | bcrypt (rounds from env) |
| Access token | JWT, 15 min expiry, httpOnly cookie (7 day maxAge) |
| Refresh token | JWT, 7 day expiry, httpOnly cookie + Redis |
| Silent refresh | Server-side in `protect` middleware |
| Token revocation | Delete Redis key on logout or force-logout |
| Geofence | Haversine formula, configurable radius |
| Rate limiting | express-rate-limit, per-user for punch endpoints |
| CORS | Explicit origin whitelist + `credentials: true` |
| ETags | Disabled to prevent stale attendance data |

---

## API Summary (35 endpoints)

| Module | Endpoints |
|--------|-----------|
| Auth | 5 |
| Attendance | 14 |
| Users / Teams | 6 |
| Overtime | 6 |
| Reports | 3 |
| Dashboard | 1 |
| Settings | 2 |
| Health | 1 |
| **Total** | **38** |
