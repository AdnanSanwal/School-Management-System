# Brand and branch tenancy

A **Brand** owns its subscription and branches. The existing `School` model is an operational **branch**; operational tables continue to use `schoolId` so attendance, students, accounts, payroll, files and academic records stay separated.

## Access

| Actor | Access |
|---|---|
| Superadmin | Provision brands, first owner and branch; add branches; set licences; record/undo latest renewal; suspend brands or branches |
| Owner | All branches of owned brands; switch branch; read consolidated summary; change shared name/logo; assign/revoke same-brand staff access |
| Staff | Home branch plus explicit additional branches; role/custom role can differ by branch |
| Parent/student | Own linked family/student records in the home branch; no staff branch assignments |

Home-branch user roles remain managed under Users & logins. Additional access is managed under All branches → Staff branch access. An optional unlinked, on-roll HR profile in the target branch links a shared login to that branch's leave, timetable and payslips. Profiles, salaries and attendance remain local; no HR records are copied automatically. Self-service salary/bank/status/leave protections resolve both kinds of HR links.

Each request checks current branch access against the database. Tokens carry the active branch and effective role. Switching creates a new sign-in session and invalidates the old device's refresh/access token; other devices retain their own session. Refresh and password change preserve the active branch. The web switch cancels/clears queries and fully navigates to discard local component state. Mobile clears queries/selected child and routes to the effective role's area. Socket rooms and push delivery are scoped by branch as well as user.

## Licensing

A brand has one plan, paid-until date, grace/notice period, optional provider override and message. Expiry/renewal apply to every branch.

- `maxBranches`: all existing branches, including suspended ones, count toward this limit. Only superadmin creates branches.
- `maxStudents`: maximum active students in **each** branch. Places are not pooled across branches. LEFT/TRANSFERRED/GRADUATED students do not consume active places; reactivation checks capacity again.
- Null means unlimited/no expiry. Modules are never licence-gated.
- New branch creation locks the brand row; admissions/reactivations lock the branch row. Limits cannot be reduced below existing usage.
- Licence payments belong to the brand. Only the latest payment can be undone, restoring the previous expiry. Old per-school licence-write routes refuse brand-linked branches.

The consolidated owner summary is read-only and currently shows all-time fee collections, approved expenses, other income, active students and on-roll staff by branch. It is not a consolidated accounting ledger. Financial writes require a selected branch. Branch currency is inherited at provisioning.

## Schema and demo setup

Migration: `20261114090000_brands_branches`. Adds `Brand`, `BrandOwner`, `BranchAccess` and `BrandLicencePayment`; links `School.brandId`. It is additive and preserves earlier records as one brand per school, copying subscription/payment history and owner assignments. The optional legacy brand link and old school licence columns remain for existing integrations/test fixtures; new provisioned branches always have a brand and use its licence.

Run from `backend/`:

```sh
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

On Windows, stop running backends first if Prisma generation reports a locked engine DLL. No reset is required. Seeding adds Greenfield North Campus to the Greenfield owner's brand even if the main demo already exists, and retains Riverside as an isolated brand. The local demo has been configured to allow 3 branches and 500 active students per branch.

## Verification

- Full backend suite: 37 suites / 397 tests passed before the final additional shared-HR regression.
- Follow-up brand/HR/payroll/security run: 4 suites / 51 tests passed, including that additional shared-HR test.
- Final brand run: all 11 tests passed, verifying renewal reversal alongside branch isolation, membership revocation, role changes, independent student caps and concurrent branch/admission limits.
- Backend/web/mobile TypeScript checks passed; targeted web lint: no errors (existing warnings remain).
- Production Next.js Webpack build passed. Default Turbopack build hit a local worker-process failure; no release was deployed.
- In-app browser: owner login, switching to North Campus with no previous-branch dashboard data, consolidated brand overview, platform brand/branch forms and saved licence limits verified.
- Local Redis was unavailable, so development tests/preview used the existing in-memory fallback. Shared Redis behavior across production workers, native mobile device builds/push delivery and production deployment have not been verified.

### Additional owner management

Superadmin uses Manage owners on an existing brand to create more owner logins or reset an assigned owner’s password. Both operations are platform-only and audited without password values. Owner creation validates the home branch against the target brand; resets require an explicit brand-owner link and preserve MFA. The current temporary password is displayed in the modal and discarded when closed. Backend regression coverage includes brand-scoped authorization, duplicate email rejection, forced password changes, refresh/access-session revocation and MFA preservation. All 13 brand tests pass; backend/web type-checks and targeted lint pass. UI and reset confirmation were verified in-app without changing demo credentials.
