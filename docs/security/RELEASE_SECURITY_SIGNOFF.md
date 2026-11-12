# Release security sign-off

Release: branch `erp-v2` after the production security audit (13 Nov 2026).

## Status

| Severity | Found | Fixed / mitigated | Open | Accepted |
|---|---|---|---|---|
| P0 | 0 | — | 0 | — |
| P1 | 4 (AUTH-1, AUTHZ-1, AUTHZ-2, SEC-1) | 4 | 0 | 0 |
| P2 | 24 | 21 (3 only partly: AUTH-6, AUTH-7, OPS-1) | 2 (AUTH-8, OPS-3) | 1 (AUTHZ-4) |
| P3 | 29 | 18 (5 only partly: API-3, AUTH-15, HOOK-5, LOG-4, INFRA-5) | 11 | — |

All P1 issues are fixed and covered by automated regression tests (backend: 387 / 387 passing).

## Decision: **NO-GO for production yet** — conditional GO once the checks below pass

The code is ready; the release is not, because these could not be verified from the audit machine:

1. **CI green on GitHub** — `ci.yml` (secret scan, audits, MySQL tests, web build) must pass, and branch
   protection must require it.
2. **Images built and run** on a Docker host: containers run as non-root, uploads volume writable after
   the one-time `chown`, migrations apply, sign-in works behind Caddy, `/metrics` and `/ready` answer 404
   from outside.
3. **Production settings updated** (DEPLOY.md “Upgrading to the security-hardened release”): distinct
   `REDIS_PASSWORD`, `METRICS_TOKEN`, `FILE_URL_SECRET`; no `ALLOW_DEMO_SEED`; OAuth left off unless
   configured for a single tenant. Confirm the demo seed was never run on the production database
   (`SELECT email FROM users WHERE email LIKE '%@school.com' OR email='superadmin@platform.com'`).
4. **One restore** of a fresh backup into a scratch stack, and backups copied off the server.

## Exceptions (need an owner's signature and a date)

| ID | Risk | Compensating control | Deadline proposed |
|---|---|---|---|
| AUTH-7 (part) | Platform admin without enforced MFA | strong unique password; per-account lock-out; sign-in audit | before onboarding a second customer school |
| AUTH-8 | Tokens in browser storage | no XSS sink found; strict CSP except inline scripts; 1 h access tokens | next release |
| OPS-3 | No alerting / runbook | backup success ping (if configured) | 2 weeks |
| AUTHZ-4 | Withdraw/transfer approval toggles not enforced | change recorded in the activity log with previous status | decide this month |
| DATA-1/2/3 | Rare races on balances, loan repayments, plan limit | audit trail; single-office usage pattern | next release |

Sign-off: ____________________ (platform operator)   Date: __________

> This document records evidence from code review and automated tests on a development machine.
> It is not proof of production security; verify against the real deployed environment.
