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

## Phases (from the spec)

1. **MVP** — school settings & academic year, users & roles, students (admission, guardians,
   documents), staff, classes/sections, student + staff attendance, fee structure → invoices →
   collection → receipts → defaulters, Owner dashboard.
2. Parent app (child switcher, attendance calendar, fee status, notices), daily diary, push notifications.
3. Exams, marks entry, grade scales, report-card PDFs, timetable.
4. Reports (PDF/Excel), online payments (JazzCash/Easypaisa), leave + approvals, calendar.
5. Transport, library, student app, WhatsApp/SMS.
