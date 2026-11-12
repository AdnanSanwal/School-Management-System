# Security findings register

Production security audit against `production_security_agent_checklist.txt` (sections 01–17),
branch `erp-v2`, 13 Nov 2026. Scope: `backend/` (Express + Prisma/MySQL), `frontend/` (Next.js 16),
`mobile/` (Expo), Docker / Caddy / compose / k8s files, CI, git history.

**Severity:** P0 = unauthorized access, tenant leak, active leaked secret, exposed data store, RCE,
money corruption · P1 = serious weakness · P2 = important hardening gap · P3 = defence in depth.
**Status:** Fixed (code changed + regression test) · Fixed† (code changed, no automated test —
reason given) · Mitigated (risk reduced, not removed) · Open · Accepted (by design; needs owner sign-off).
**Owner:** the person who signs `RELEASE_SECURITY_SIGNOFF.md` (school-platform operator) unless noted.

No P0 was found. There is no evidence of cross-tenant data access, no leaked real credential in
git history (54 commits, every ref), and the production compose file exposes only ports 80/443.

## P1

| ID | Area | Finding (evidence) | Exploit scenario | Fix | Test | Status |
|---|---|---|---|---|---|---|
| AUTH-1 | OAuth | `auth/oauth.routes.ts` (before): accounts matched by the provider's `mail`/UPN; `MS_TENANT_ID` defaulted to `common`; Google `email_verified` not checked; routes always mounted. | Attacker creates own Entra tenant, sets a user's mail to `owner@school.com`, opens `/api/v1/auth/oauth/microsoft` → signed in as the owner (or SUPER_ADMIN). P0 the moment OAuth credentials are configured. | Rewritten: off unless `OAUTH_ENABLED=true`; Microsoft only with a pinned single tenant; Google needs `email_verified`; state + PKCE bound to an HttpOnly cookie; one-time code instead of tokens in URL. | `db/security.db.test.ts` “OAuth sign-in” (5 tests) | Fixed |
| AUTHZ-1 | Roles | `utils/accounts.ts` `canManageRole` only checked the base role, so a deliberately limited custom role (e.g. “Front desk” on Office admin) could create or reset an **Accountant** login and use its finance/payroll rights. | Front-desk user: `POST /users {role:'ACCOUNTANT', password}` → signs in as that accountant. | A custom-role holder may only create/reset/manage logins whose every permission they already hold; same check when granting a custom role. | `security.db` “custom role limits” (3 tests) | Fixed |
| AUTHZ-2 | Staff | `staff.routes.ts` `changeStaffStatus` switched the linked login on/off and ended sessions without checking the actor may manage that login. | Office admin sets the principal's staff status to *Terminated* → principal's login disabled; or re-activates a login the owner disabled. | Requires `canManageRole(actor, targetRole)`; nobody changes their own status. | `security.db` “AUTHZ-2” | Fixed |
| SEC-1 | Seed | `database/seed.ts` creates `superadmin@platform.com` etc. with the README-published password and no production guard; compiled into the image. | Seed run on a live server → anyone who read the README is platform admin of every school. | Seed exits in `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`; the server refuses to start while that is set. | `unit/security.test.ts` (env refuses `ALLOW_DEMO_SEED`); seed guard itself Fixed† (calls `process.exit`) | Fixed |

## P2

| ID | Area | Finding (evidence) | Fix | Test | Status |
|---|---|---|---|---|---|
| AUTH-2 | OAuth | OAuth issued tokens without the user's two-step code. | Accounts with MFA must use password sign-in (`error=mfa_required`). | `security.db` | Fixed |
| AUTH-3 | OAuth | `state` generated but never checked (login CSRF); tokens in the callback URL; web callback accepted tokens from any link. | State/PKCE + one-time code; `oauth-callback/page.tsx` only exchanges a code. | `security.db` | Fixed |
| AUTH-4 | Login | Account limiter keyed by IP+account (resets per IP); temporary passwords ≈20 bits (`Kite-7342-Moon`). | New per-account limiter (30 failures/h across all IPs); temporary passwords ≈38 bits (`Kite-Moon-Rose-482913`). | `security.db`, `unit/security` | Fixed |
| AUTH-5 | Login | `/change-password`, `/profile`, `/mfa/*` verified the current password with no limit. | `passwordCheckLimiter` (10 wrong/15 min per user). | covered by limiter tests pattern; Fixed† for these routes | Fixed† |
| AUTH-6 | MFA | MFA could be switched on without the password (lock-out by a borrowed session). | Password required on `/mfa/enable`. Admin “reset MFA” action **not added** (see plan). | `security.db`, `fixes.db` | Fixed (reset: Open) |
| AUTH-7 | MFA | TOTP secrets plaintext; codes replayable; MFA never required for SUPER_ADMIN/OWNER. | Secrets AES-GCM encrypted at rest (`enc:` prefix, legacy plaintext still read); each code accepted once; disabling MFA signs other devices out. **Enforcing MFA for platform admin: Open** (needs an enrolment flow and a decision). | `security.db` | Partly fixed |
| AUTH-8 | Web | Access + 30-day refresh token in `localStorage` (`authStore.ts`); CSP `script-src 'unsafe-inline'`. No XSS sink was found (no `dangerouslySetInnerHTML`/`eval`). | Plan: refresh token in HttpOnly cookie + nonce CSP. | — | Open |
| AUTHZ-3 | Dashboard | Overview cached per *base role*: a limited custom role could get the full admin copy (fees). | Cache key includes a hash of the effective permission set. | `security.db` | Fixed |
| AUTHZ-4 | Students | `student.status.request/approve` permissions are never enforced; status changes need `student.manage`. | The client change request asks that the **admin** changes status directly, so the route stays on `student.manage`; sessions of leaving students are now ended. Either remove the two toggles from the settings screen or build request→approve. | — | Accepted (needs owner decision) |
| AUTHZ-5 | Duties | Admin could set own salary or bank details; requester could approve own expense/concession; preparer could approve own payroll. | Refused unless the actor is the OWNER; bank-detail changes are logged. | `security.db` (salary, bank) | Fixed (decisions Fixed†) |
| API-1 / HOOK-3 | SSRF | `/push/subscribe` stored any URL and the server POSTed to it. | Only https browser push services (FCM, Mozilla, WNS, Apple) and well-formed keys. | `security.db`, `unit/security` (11 URLs) | Fixed |
| HOOK-2 | Service | `services/notifications` `/enqueue` had no auth (email/SMS/push via the school's providers); dev compose published it on all interfaces. | Shared-token check (constant time); dev ports bound to 127.0.0.1. The service is unused by the app — delete it when convenient. | Fixed† (service has no test harness) | Fixed† |
| LOG-1 | Logs | OAuth errors `console.error`'d the axios error (client secret, bearer token). | Structured `logger.warn` with the message only. | code review | Fixed† |
| LOG-2 | Sentry | Backend Sentry sent request bodies, query strings (signed links), user info. | `sendDefaultPii:false`, `beforeSend`/`beforeSendTransaction` scrub request, user, span URLs. Stack-frame local variables are not separately disabled (SDK option) — verify on first real event. | `unit/security` | Fixed (verify live) |
| LOG-3 | Audit | Sign-ins, failures and resets were never logged. | `Signed in`, `Sign-in failed` (+reason, IP), `Password reset by email link`, `Password reset by office`, `Login access changed`. | `security.db` | Fixed |
| INFRA-1 | Docker | No `.dockerignore` (and it was git-ignored): `.git`, `.env*`, backups, uploads went into the build context. | Committed `.dockerignore`. | not buildable here (no Docker) | Fixed† |
| INFRA-2 | Docker | Containers ran as root. | `USER node` in backend and web images; uploads volume owned by `node` (one-time chown in DEPLOY.md). Dev dependencies still ship in the backend image (Prisma CLI needed for migrations). | not buildable here | Fixed† |
| INFRA-3 | Dev compose | `docker-compose.yml` published MySQL, Redis, ES, Grafana (`admin`), exporters on all interfaces. | All ports bound to `127.0.0.1`; Grafana password required; file marked “local only”. | — | Fixed† |
| OPS-1 | Backups | Plain gzip dumps, default umask, same host, no failure alert, no restore drill. | `umask 077`; optional AES-256 encryption (`BACKUP_PASSPHRASE`, restore decrypts); optional success ping (`BACKUP_PING_URL`). Off-site copy + restore drill: Open. | `bash -n` only | Partly fixed |
| OPS-2 | Metrics | Raw URL used as a Prometheus label → unbounded series from random 404s. | Route pattern or `unmatched`. | code review | Fixed† |
| OPS-3 | Ops | No alerting, no incident-response runbook, no disclosure contact. | Plan item. | — | Open |
| DEP-1 | Runtime | Node 20 (EOL 30 Apr 2026) in images, CI, Netlify. | Node 22 LTS everywhere, `engines >=22`, Dependabot for npm/actions/Docker. Local tests ran on Node 24. | not buildable here | Fixed† |
| DEP-2 | Uploads | `multer` 1.4.5-lts.2 (multipart DoS advisories fixed in 2.x). | `multer@2.5.0`. | upload suite 10/10 | Fixed |
| CI-1 | CI | Workflows used PostgreSQL, missing lockfiles, wrong Docker context, `lint || true`, no audit/secret scan, stub deploy. | One `ci.yml`: gitleaks (history + tree, checksum-verified binary), `npm audit`, backend on MySQL 8.4 with all tests, web types/lint/build + bundle check, images only after every gate. | not yet run on GitHub | Fixed (verify) |

## P3

| ID | Finding | Status / note |
|---|---|---|
| AUTH-9 | Refresh tokens not rotated; no reuse detection. | Rate limit added; rotation **Open** (needs client changes in web + mobile). |
| AUTH-10 / AUTHZ-7 | Leaving students, graduates and suspended schools kept working tokens/logins. | Fixed: sessions ended; school-wide revocation cut-off; graduates' logins disabled. Test: suspension. |
| AUTH-11 | `/auth/username-check` platform-wide oracle for any user. | Mitigated: 60/min per user. |
| AUTH-12 | Forgot-password timing differed for known emails. | Fixed† (email not awaited; not measured). |
| AUTH-13 | k8s: no `TRUST_PROXY`, ingress CORS `*`. | Mitigated: CORS override removed; k8s marked unmaintained (`k8s/README.md`). |
| AUTH-14 | Access/refresh tokens had no type claim; file links fell back to `JWT_SECRET`. | Fixed: `typ` claim enforced; `FILE_URL_SECRET` required and distinct in production. Test: unit. |
| AUTH-15 | Length-only policy; bcrypt's 72-byte cut; rehash could downgrade. | Fixed: offline common-password list, own-name check, 72-byte cap, upgrade-only rehash. No breached-password (HIBP) lookup — Open. |
| AUTHZ-6 | Parents/students could list classmates' homework status. | Fixed† (no fixture for diary in the security suite). |
| API-2 | Broadcast / push send bodies unvalidated; teachers with `notice.publish` could SMS everyone. | Fixed: zod schemas; email/SMS need `message.broadcast`. |
| API-3 | `/reports/__proto__` → 500; mark sheet allowed 10,000 entries; unbounded date ranges. | Fixed: own-key lookup, 3,000-entry cap. Date-range caps Open. Test: reports. |
| DATA-1/2/3 | Check-then-act races: account overdraw, double loan repayment, licence `maxStudents`. | Open (need row locks; low likelihood, single school, auditable). |
| DATA-4 / HOOK-4 | Gateway callback has no amount/currency/event-id; no raw-body signature. | Open — only the test gateway exists (refused in production). Do before adding a real gateway. |
| TENANT-1 | A known Expo device token can be moved between users across schools. | Open (tokens are not guessable). |
| HOOK-5 | `MESSAGING_PROVIDER=test` allowed in production; `/messaging/test` has no per-school limit; no outbound timeouts. | Production refusal Fixed (unit test); limits/timeouts Open. |
| LOG-4 | No audit of exports, role/active changes without before/after, 403s. | Role/active and office resets Fixed; exports Open. |
| LOG-5 | GDPR middleware is headers only; no erasure/export process. | Open (process + documentation). |
| LOG-6 | Dev nginx logs full query strings (signed links). | Open (dev only; production Caddy has no access log). |
| FILE-1 | No per-school storage quota / upload rate limit. | Open. |
| FILE-2 | Signed links cached by the browser for 50 min. | Mitigated: `no-store`; link lifetime unchanged (1 h). |
| FILE-3 | `photoUrl` / `logoUrl` accepted `javascript:`/`data:`/`file:`. | Fixed: http(s) only. |
| WS-1 | Socket.IO kept connections after sign-out / expiry. | Fixed: re-check every minute. No Redis adapter across workers (functional, not security). |
| JOB-1 | Daily job lock not renewed; duplicate alerts possible on long runs. | Open (late fees are idempotent already). |
| SEC-2 | `k8s/secrets.yml` tracked (placeholders only). | Fixed: renamed `secrets.example.yml`, real file git-ignored. |
| SEC-3 | `FILE_URL_SECRET`, `PAYMENT_GATEWAY_SECRET`, `METRICS_TOKEN` not validated. | Fixed (unit tests). |
| SEC-4 | Local `refs/stash` holds a committed `.next-dev` build (no secrets found). | Open — drop with `git stash drop` (needs your OK; not pushed anywhere). |
| INFRA-4 | Caddy `/metrics` 404 rule never ran. | Fixed† (`handle @internal`; `/ready` also hidden). |
| INFRA-5 | Redis without password; MySQL root password on a command line; no resource limits; no TLS inside the Docker network. | Redis password + healthcheck Fixed†; limits/TLS Open. |
| DEP-3 | `services/notifications` has no lockfile. | Open (delete the unused service). |
| CI-2 | Actions pinned to tags; no `permissions:`. | Fixed: SHA pins, `contents: read` default. |

## Checklist items verified as already in place (evidence in SECURITY_TEST_REPORT.md)

Tenant isolation by a Prisma extension pinning `schoolId` (11/11 isolation tests); no raw SQL except
`SELECT 1`; zod on every body, `.strict()` PATCHes; generic error responses; HS256-only JWT with
production secret validation; per-device sessions with sign-out-everywhere; reset tokens hashed,
single-use, 1 h; uploads typed by magic bytes (PDF/JPEG/PNG/WebP), random keys, path checks,
HMAC-signed downloads with `timingSafeEqual`, sandbox CSP + nosniff; no cookie auth (no CSRF surface
apart from the new OAuth state cookie); strict CORS allow-list; Next.js security headers, no source
maps, no server actions/route handlers; `.env` files ignored and never committed; production compose
publishes only Caddy; `npm audit` 0 vulnerabilities (backend + web + mobile).
