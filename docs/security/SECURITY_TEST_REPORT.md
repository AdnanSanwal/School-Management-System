# Security test report

**Environment:** Windows 11 dev machine, Node v24.22.0, npm 11, local MySQL `school_db` (dev data plus
throw-away test schools created and deleted by each suite), Redis not running (in-memory fallback, as
in development). Docker, gitleaks, trivy and semgrep are **not installed**, so container builds and
tool-based scans were not run here; CI runs gitleaks and the audits.
**Method:** four parallel read-only code reviews (sections 02/07, 03–06, 08–11/14, 12/13/15/16), each
finding re-checked against the code before fixing; fixes covered by automated tests where practical.

## Commands and results

| Command | Result |
|---|---|
| `RUN_DB_TESTS=1 npx jest` (backend, all suites) | **36 suites, 387 tests passed** (was 34 / 345 before the audit) |
| `RUN_DB_TESTS=1 npx jest src/__tests__/db/security` | 19 / 19 passed |
| `npx jest src/__tests__/unit/security` | 23 / 23 passed |
| `RUN_DB_TESTS=1 npx jest src/__tests__/db/tenantIsolation` | 11 / 11 passed (reviewer run) |
| `RUN_DB_TESTS=1 npx jest src/__tests__/db/uploads` | 10 / 10 passed, also after `multer` 2.5.0 |
| `npx tsc --noEmit` backend · `npx tsc --noEmit -p .` frontend · mobile | clean (exit 0) |
| `npx eslint .` (frontend) | 0 errors, 38 warnings (pre-existing style warnings) |
| `npm audit --omit=dev --audit-level=high` (root: backend + web) | 0 vulnerabilities |
| `npm audit` (mobile) | 0 vulnerabilities (reviewer run) |
| `npm audit signatures` | 129 verified attestations, 0 failures (reviewer run) |
| `git log --all -p` regex scan (SG., sk_live/test, AKIA, `-----BEGIN`, AIza, Twilio AC…, xox, ghp_, whsec_, `*_SECRET=`, `*PASSWORD=`, `DATABASE_URL=`) | only placeholders / test values; `.env` never committed |
| `bash -n deploy/backup.sh deploy/restore.sh` | syntax OK |
| Browser smoke test (dev servers on 3001/5001): sign in through the login form | lands on the dashboard; `GET /api/v1/auth/oauth/google` → 404 (disabled) |

## Regression cases (new)

`db/security.db.test.ts` — OAuth: disabled by default and refuses a multi-tenant Microsoft setup ·
mismatched/missing state refused · unverified Google email never linked · MFA accounts can't use OAuth ·
one-time code, single use, state not replayable · refresh token refused as access token · MFA enable
needs password, secret encrypted at rest, code replay refused · common/over-long/personal passwords
refused · per-account lock-out across 31 addresses · sign-in success/failure logged without passwords ·
limited custom role can't create or reset an accountant login (standard admin still can) · dashboard
cache doesn't leak fees to the limited role · admin can't terminate the principal via staff status ·
no self-set salary or bank details (owner can, and it's logged) · push subscriptions to internal or
look-alike hosts refused · `/reports/__proto__` etc. → 404 · suspending a school ends its sessions.

`unit/security.test.ts` — production config refuses missing/duplicate `FILE_URL_SECRET`, missing
`METRICS_TOKEN`, `MESSAGING_PROVIDER=test`, `ALLOW_DEMO_SEED`, gateway without secret · password
policy · temporary-password shape and uniqueness · bcrypt never downgraded · token types with a shared
secret · 11 push URLs · Sentry scrubbing removes bodies, query strings, headers and user details.

Older tests adjusted to the new, stricter rules (not weakened): temporary-password format (phase1),
MFA enable now sends the password and a used code is cleared for the same-30-second sign-in (fixes),
push test uses a real push-service shape (fixes), roles test password no longer equals the guardian's
name, production config fixture has the new required secrets (hardening), audit/finance/payroll tests
from the earlier owner-rights change.

## Not tested / not verifiable here

- **Docker:** image builds, non-root runtime, `.dockerignore` effect, Node 22 images, Caddy routing,
  backup/restore scripts in the `mysql:8.4` container (openssl/curl availability).
- **CI on GitHub:** the new `ci.yml` has not run yet; gitleaks may flag test fixtures on first run.
- **Real OAuth providers:** only mocked; no live Google/Microsoft round trip.
- **Sentry:** no live event captured; stack-frame variables not separately disabled.
- **Production server:** firewall, real `.env.production`, whether the demo seed was ever run there,
  backup permissions and off-site copies, TLS, GitHub branch protection and secret scanning.
- **Timing:** forgot-password timing equality (AUTH-12) not measured.
- **Load:** rate limits under real Redis across several workers; metrics cardinality under attack.
- **DAST / penetration test:** not run (no authorized staging target).
