# Security implementation plan

What was done in this audit, and the prioritized work that remains. IDs refer to
`SECURITY_FINDINGS.md`. Effort: S ≤ ½ day, M ≤ 2 days, L > 2 days.

## Done in this change set

| Order | Item | Files | Rollback |
|---|---|---|---|
| 1 | OAuth hardening (AUTH-1/2/3, LOG-1) | `backend/src/modules/auth/oauth.routes.ts`, `frontend/src/app/oauth-callback/page.tsx` | OAuth is off by default; revert both files together. |
| 2 | Escalation fixes (AUTHZ-1/2/3/5/6), revocation (AUTH-10, AUTHZ-7) | `utils/accounts.ts`, `staff`, `hr`, `finance`, `fees`, `payroll`, `dashboard`, `diary`, `students`, `promotions`, `platform`, `utils/sessions.ts` | Per file; the school-wide cut-off key in Redis expires after 31 days. |
| 3 | Sign-in hardening (AUTH-4/5/6/7/11/12/14/15) | `middleware/rateLimits.ts`, `auth.*`, `utils/jwt.ts`, `utils/password.ts`, `utils/passwordPolicy.ts`, `utils/accounts.ts` | Old tokens without `typ` are still accepted, so deploying or reverting signs nobody out. Encrypted MFA secrets need `AES_SECRET_KEY` to stay the same forever. |
| 4 | Input / SSRF (API-1/2/3, FILE-3) | `push.controller.ts`, `notification.controller.ts`, `reports.routes.ts`, `exams.routes.ts`, `students`/`school` routes | Existing push subscriptions with odd endpoints keep working until re-subscribed. |
| 5 | Logging (LOG-2/3/4), metrics (OPS-2), sockets (WS-1), files (FILE-2) | `utils/sentry.ts`, `auth.service.ts`, `users.routes.ts`, `utils/metrics.ts`, `config/socket.ts`, `files.routes.ts` | Independent. |
| 6 | Configuration (SEC-1/3, HOOK-5) | `database/seed.ts`, `config/env.ts`, `.env.production.example`, `docker-compose.prod.yml` | **Breaking for deploys:** `REDIS_PASSWORD`, `METRICS_TOKEN` now required. See DEPLOY.md “Upgrading to the security-hardened release”. |
| 7 | Containers & infra (INFRA-1..5, DEP-1/2, OPS-1, SEC-2, HOOK-2) | Dockerfiles, `.dockerignore`, compose files, Caddyfile, `deploy/backup.sh`, `deploy/restore.sh`, `k8s/`, `services/notifications` | One-time `chown` of the uploads volume; to revert run as root again. |
| 8 | CI gates (CI-1/2) | `.github/workflows/ci.yml` (replaces `ci-cd.yml`), `.github/dependabot.yml` | Docker Hub publishing from the old `ci.yml` was dropped (it pushed from a broken context); images go to GHCR. |
| 9 | Regression tests | `backend/src/__tests__/db/security.db.test.ts` (19), `backend/src/__tests__/unit/security.test.ts` (23), 5 older tests adjusted to the new rules | — |

## Remaining work (prioritized)

| Pri | ID | Task | Effort | Depends on | Notes |
|---|---|---|---|---|---|
| 1 | CI-1 | Push the branch and get `ci.yml` green on GitHub (gitleaks may need a `.gitleaksignore` for test fixtures; first run tells). Turn on branch protection requiring it. | S | GitHub access | Release gate. |
| 2 | INFRA-1/2, DEP-1 | Build both images on a machine with Docker; run the stack; check `docker compose exec backend id` ≠ 0, uploads still writable, migrations run as `node`. | S | Docker host | Not possible on the audit machine (no Docker). |
| 3 | AUTH-7 | Require MFA for SUPER_ADMIN (and optionally OWNER): restricted enrolment token at login until set up; admin “reset two-step login” action (+ audit, end sessions). | M | decision on which roles | Closes the platform-admin phishing risk. |
| 4 | OPS-1 | Off-site encrypted backups (rclone to object storage) + monthly restore drill into a scratch stack; record the date. | S | storage account | |
| 5 | OPS-3 | External uptime check on `/health`, alert on backup ping missing, 1-page incident runbook (rotate secrets, `endSchoolSessions`, restore), security contact in `docs/SECURITY.md`. | S | | |
| 6 | AUTH-8 | Refresh token in HttpOnly Secure SameSite=Strict cookie scoped to `/api/v1/auth/refresh` + CSRF check on that route; access token in memory; nonce-based CSP (drop `'unsafe-inline'`). | M–L | web + mobile login code | Mobile keeps SecureStore. |
| 7 | AUTH-9 | Rotate refresh tokens with reuse detection (handle two tabs refreshing at once). | M | 6 | |
| 8 | AUTHZ-4 | Decide: remove the “ask/approve withdrawal” toggles, or implement request → approve. | S/M | owner decision | |
| 9 | DATA-1/2/3 | `SELECT … FOR UPDATE` on money account / loan / counter rows inside the transaction. | M | | |
| 10 | DATA-4/HOOK-4 | Before any real payment gateway: raw-body signatures, amount/currency/event-id checks, reconcile action. | M | gateway choice | |
| 11 | FILE-1, HOOK-5 | Per-school storage quota; per-school SMS limit on `/messaging/test`; timeouts on Twilio/Expo/web-push calls. | S | | |
| 12 | LOG-4/5 | Audit exports; retention job for audit logs / notifications / outbound messages; written erasure & export procedure. | M | legal input | |
| 13 | AUTH-15 | Optional HIBP k-anonymity check for new passwords. | S | outbound internet from server | |
| 14 | SEC-4, DEP-3, k8s | `git stash drop`; delete `services/notifications` and `k8s/` if unused. | S | your OK | Housekeeping. |
| 15 | INFRA-5 | `mem_limit`/`cpus` in prod compose; MySQL `require_secure_transport` if the DB ever leaves the Docker network. | S | | |
