# Security and reliability

What the ERP does to protect school data and stay up. Each item names the code that does it,
so it can be checked and tested.

## Data isolation between schools

- Every school's rows carry `schoolId`. A Prisma query extension pins every read and write
  to the signed-in user's school (`backend/src/config/tenancy.ts`, `config/database.ts`).
  Without a school context, a query fails rather than reading every school's data.
- Teachers see only their own sections. Parents see only their linked children
  (`utils/scope.ts`).
- Tests try to read another school's records and expect 404/403
  (`__tests__/db/tenantIsolation.db.test.ts`).

## Injection

- **SQL:**
  - All database access goes through Prisma, which sends every value as a bound parameter.
  - Application code has no raw SQL. A test fails the build if `$queryRawUnsafe`,
    `$executeRawUnsafe`, `Prisma.raw(` or string-built `$queryRaw(` appear outside the
    tests (`__tests__/unit/hardening.test.ts`).
  - The only raw statement is the readiness probe's fixed `SELECT 1`, written as a tagged
    template, which Prisma also parameterises.
- **Input:** every request body and query string is checked against a schema (zod) before
  use. Unknown fields are rejected where it matters (`.strict()`). Bodies are capped at 1 MB.
- **Files:**
  - Uploads are identified by their content, never by the name or type the browser
    sends.
  - Files are stored under generated names, and file paths are checked to stay inside the
    upload folder (`utils/storage.ts`).
  - Downloads use signed, expiring links.
- **HTML/script (XSS):**
  - React escapes everything it renders.
  - The web app sends a Content-Security-Policy that only allows scripts from its own
    site (`frontend/next.config.js`).
- **Spreadsheets:** Excel exports write text as plain values, never as formulas.

## Sign-in and sessions

- **Passwords:** stored with bcrypt (cost `BCRYPT_ROUNDS`, default 10), and at least 8
  characters long.
- **Unknown accounts:** a wrong email takes as long to answer as a wrong password, so
  response timing doesn't reveal which accounts exist.
- **Brute force** (`middleware/rateLimits.ts`):
  - 10 failed sign-ins per account and IP in 15 minutes.
  - 50 failed sign-ins per IP.
  - 10 password-reset attempts per IP per hour.
  - 10 two-step code attempts per 15 minutes.
- **Two-step login:**
  - Optional, using an authenticator app.
  - Turning it off needs the password.
  - An active setup can't be silently replaced.
- **Tokens** (`utils/jwt.ts`, `utils/sessions.ts`):
  - Access tokens are short-lived (`JWT_EXPIRES_IN`, default 1 hour) and signed with a
    pinned algorithm (HS256).
  - Each device gets its own session. Signing out ends only that device.
  - Changing the password signs out the user's other devices.
  - A password reset, deactivation or role change signs the person out everywhere, at
    once.
- **Password reset:** links expire after 1 hour. The response never reveals whether an
  email has an account.

## Transport and headers

- **HTTPS:** Caddy handles HTTPS with automatic certificates, and sends HSTS.
- **API headers:** helmet. CORS allows only the configured web address(es).
- **Web app headers:** CSP, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy,
  and a permissions policy.
- **Not public:** `/metrics` (blocked by Caddy, and `METRICS_TOKEN` can lock it too) and
  `/ready`.

## Audit trail

- Every successful change (POST/PUT/PATCH/DELETE) records who, which school, the action,
  the record id, the time and the IP address in `audit_logs`
  (`middleware/audit.ts`).
- Request bodies are never stored.
- Owners and principals can read it at `GET /api/v1/audit`.

## Error handling and logs

- **One global error handler** (`middleware/errorHandler.ts`):
  - Known errors (validation, duplicates, linked records, conflicts, malformed JSON, too
    large) get clear 4xx messages.
  - Anything else is a generic 500 that includes a `requestId`. Internal details never
    reach the user.
- **Request IDs:** every response has an `X-Request-Id`. The same id appears in the
  access log and the error log, so a user can quote it.
- **Logs** (`utils/logger.ts`, `middleware/requestContext.ts`):
  - In production, one JSON line per request goes to stdout.
  - Requests slower than `SLOW_REQUEST_MS` get a warning.
  - Passwords, tokens, keys and similar fields are masked in all log output.
  - Query strings are never logged, because signed links carry their signature there.
- **Error reporting:** off unless you set your own Sentry project (`SENTRY_DSN`,
  `NEXT_PUBLIC_SENTRY_DSN`). There is no session replay.

## Running under load

- **Workers:** `WEB_CONCURRENCY` runs several worker processes on one port, so one server
  uses all its CPU cores. A crashed worker is replaced (`src/index.ts`).
- **Shared state in Redis:** sessions, rate-limit counters and the daily-job lock. Workers
  and servers agree with each other, and limits don't multiply with the number of
  processes.
- **Daily jobs:** they run in exactly one process at a time, using a Redis lock that frees
  itself if the holder dies. The jobs are also idempotent.
- **Database:**
  - Transactions retry on MySQL deadlocks and races (`config/database.ts`).
  - The connection pool per worker is set by `DB_POOL`.
  - At start-up, the server retries the database connection with back-off.
- **Dashboard:** cached per school for up to 30 s, and cleared on any change in that school.
  Requests that arrive together share one computation.
- **Timeouts:**
  - API requests: 120 s on the server.
  - Web client: 30 s, mobile client: 20 s.
  - Keep-alive is tuned for the proxy.
- **Health:** `/health` reports whether the process is alive. `/ready` checks MySQL and
  Redis, and reports 503 while shutting down. Docker uses `/ready`.
- **Graceful shutdown:** on SIGTERM, the server stops taking new requests, finishes the
  ones in flight, closes MySQL and Redis, then exits. It forces the exit after
  `SHUTDOWN_TIMEOUT_MS`. A crash (uncaught exception or unhandled rejection) is logged,
  and a fresh process takes over.
- **Start-up check:** in production, the server refuses to start with missing or weak
  secrets, placeholder values, identical token secrets, a missing Redis, or the test
  payment gateway (`config/env.ts`).

## Measured

Load test on one development PC, production build, 4 workers, 100 simultaneous
connections for 20 s:

| Workload | Throughput | p50 | p99 | Errors |
|---|---|---|---|---|
| Mixed office screens (dashboard, students, classes, invoices, notifications) | 429 req/s | 220 ms | 476 ms | 0 |
| Signed-in check (`/auth/me`) | 1,100 req/s | 112 ms | 286 ms | 0 |

The rate-limit test sent 100 requests at a 60-request limit across 4 workers: exactly 60
were allowed, so the limit is shared.

## Things to do on the server

- Use long random secrets: `openssl rand -hex 32`. The server won't start without them.
- Keep the VPS patched (`unattended-upgrades`), allow only ports 22, 80 and 443, and use
  SSH keys rather than passwords.
- Copy the nightly backups off the server, and test a restore (`docs/DEPLOY.md`).
- Turn on two-step login for owner, principal and accountant accounts.
