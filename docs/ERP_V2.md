# ERP v2 — developer guide

Branch `erp-v2` rebuilds the domain on top of the existing platform, following
`School_ERP_Complete_Feature_Report.docx`. The pre-rebuild app is tagged `pre-erp`.

## What is in place

| Piece | Where |
|---|---|
| Multi-school schema (tenancy, people, academics, attendance, leave, exams, diary, notices, finance) | `backend/prisma/schema.prisma` |
| Tenant-scoped Prisma client | `backend/src/config/database.ts`, `backend/src/config/tenancy.ts` |
| Permission catalogue + role map (Owner, Principal, Admin, Accountant, Teacher, Parent, Student, Super Admin) | `backend/src/middleware/rbac.ts` |
| Row-level scope helpers (teacher → own sections, parent → own children, student → self) | `backend/src/utils/scope.ts` |
| School onboarding / suspension for the SaaS operator | `backend/src/modules/platform` |
| Demo data: school `greenfield` (every role) + school `riverside` (isolation checks) | `backend/src/database/seed.ts` |

Legacy modules (students, fees, exams, …), GraphQL and public self-registration were removed;
they are rebuilt per phase below. The frontend and mobile app still call the old endpoints
until their phase lands.

## Rules for writing a module

1. **Mount behind `authenticate`.** It verifies the token and runs the request inside the
   user's tenant context. The default `prisma` export refuses to touch tenant tables
   without a context, so a missing `authenticate` fails loudly instead of leaking.
2. **Guard routes with `can('permission')`,** not role names. Add new permissions to
   `PERMISSIONS` and the role map, with a line in `__tests__/unit/permissions.test.ts`.
3. **Narrow by row for Teacher/Parent/Student.** Use `studentScope(user)`,
   `assertStudentAccess`, `assertSectionAccess`. Return 404, not 403, for out-of-scope IDs.
4. **Pass `schoolId: currentSchoolId()` on every create** (TypeScript requires it; the
   client verifies it matches). Never use `school: { connect }`.
5. **Check foreign keys from request input** with `ensureInSchool(prisma.section, id, 'Section')`
   before writing them. Scoping filters queries; it cannot stop a row pointing at another school.
6. **No nested writes for tenant children** (create them with their own top-level call),
   and no `$queryRaw` without an explicit `schoolId` filter.
7. Use `basePrisma` only for trusted cross-school code: auth, platform, seed, jobs.
8. **Middleware that resumes the request from a callback or stream event** (multer, busboy, some
   rate limiters) loses the AsyncLocalStorage tenant context. Capture `tenantStorage.getStore()`
   and call `next` inside `tenantStorage.run(ctx, …)` — see `uploadOne` in `modules/files`.
   Symptom if you forget: a 403 "Forbidden" from the scoped client.
9. **Multi-step writes use `transaction()`** from `config/database`, not `prisma.$transaction`.
    It retries MySQL deadlocks and upsert races (concurrent writers to the same unique index),
    which really happen — see `__tests__/db/concurrency.db.test.ts`.
10. **Tell people things with `notify()` / `notifyEach()`** (`utils/notify.ts`): one call saves the
    in-app notification, pushes to phones (Expo) and browsers (Web Push), and updates open screens.
11. **Uploads** go through `uploadOne` + `assertKind` (content sniffing, 5 MB) + `saveFile`;
   never return a storage key, return `signedUrl(key)`. Files live in `UPLOAD_DIR`
   (default `backend/uploads/<schoolId>/…`, gitignored). An S3 driver can replace the four
   functions in `utils/storage.ts` without touching callers.

## Running

```bash
cd backend
npx prisma migrate reset --force   # drops the dev DB, applies migrations, seeds
npm test                           # unit + API tests
RUN_DB_TESTS=1 npm test            # also the tenant-isolation tests against MySQL
```

Demo logins (password `Admin@123`): `superadmin@platform.com`, `owner@school.com`,
`principal@school.com`, `admin@school.com`, `accountant@school.com`, `teacher@school.com`,
`parent@school.com` (two children), `student@school.com`, `owner@riverside.com`.

## Phase 1 API (done)

| Area | Endpoints (`/api/v1/…`) |
|---|---|
| School | `school` (profile), `school/academic-years`, `…/:id/make-current` |
| Users | `users` list/create, `users/:id` update, `users/:id/reset-password` (role hierarchy enforced) |
| Classes | `academics/classes`, `academics/sections/:id`, `academics/subjects`, `academics/sections/:id/subjects` |
| Staff | `staff`, `staff/:id`, `staff/:id/login` |
| Students | `students` (scoped list), `students/:id` (profile + attendance % + fee balance), admission with guardians/siblings, `students/:id/status`, `…/guardians`, `students/guardians/search`, `students/guardians/:id/login`, `…/documents` |
| Attendance | `attendance/students` (roster / bulk mark, parents notified on absence), `attendance/students/:id/calendar`, `attendance/summary`, `attendance/staff` |
| Fees | `fees/heads`, `fees/structure/:classId`, `fees/invoices/generate`, `fees/invoices`, `fees/students/:id` (ledger), `fees/payments` (collect / daily report), `fees/payments/:id/receipt`, `fees/defaulters`, `fees/concessions` (+ `/:id/decision`) |
| Dashboard | `dashboard/overview` (blocks shown per permission) |

Web screens: `/dashboard`, `/students`, `/students/new`, `/students/[id]`, `/staff`, `/classes`,
`/attendance`, `/attendance/summary`, `/attendance/staff`, `/fees` (collect), `/fees/receipt/[id]`,
`/fees/payments`, `/fees/defaulters`, `/fees/invoices`, `/fees/concessions`, `/fees/structure`,
`/users`, `/settings/school`, `/family` (minimal parent view until Phase 2).

Money is `DECIMAL(12,2)` end to end (`Prisma.Decimal`, serialised as strings); pure fee maths lives in
`modules/fees/fees.calc.ts`. "Today" is always the school's local day (`utils/dates.ts`).

## Phase 2 (done)

API: `diary` (post with up to 3 attachments, scoped reads), `notices` (audiences ALL / STAFF /
PARENTS / STUDENTS / SECTIONS, drafts, read tracking), `calendar` (holidays & events),
`family/children` + `family/home` (parent home screen), `push/devices` (Expo tokens),
`fees/reminders` (once per parent per child per day).

Mobile (`mobile/`, Expo SDK 51, expo-router): one app, three areas by role —
**family** (Home · Attendance calendar · Fees + receipts · Diary · More), **teacher** (Home ·
Mark attendance · Diary + post with attachments · More), **office/owner** (Dashboard · More).
Run in a browser with `npm run web --prefix mobile` (port 8081); on a phone with Expo Go and
`EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:5000/api/v1`. Real push needs an EAS project id
(`EXPO_PUBLIC_PROJECT_ID`) and a development build — Expo Go on Android no longer receives remote push.

Web: `/notices`, `/diary`, `/calendar`, "Send reminders" on `/fees/defaulters`.

## Phases (from the spec)

1. **MVP — done** (see above). Not yet: file uploads (documents are links), mobile screens.
2. **Done** — parent app (child switcher, attendance calendar, fee status, notices), daily diary, push notifications.
3. Exams, marks entry, grade scales, report-card PDFs, timetable.
4. Reports (PDF/Excel), online payments (JazzCash/Easypaisa), leave + approvals, calendar.
5. Transport, library, student app, WhatsApp/SMS.
