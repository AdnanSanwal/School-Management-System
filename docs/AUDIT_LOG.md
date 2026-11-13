# Audit log

Open **System → Audit log** (`/audit`). Owner and Principal have access by default. The menu, global page search, screen and API follow the school's `audit.view` permission, including custom staff roles. No migration is required.

## Using the screen

- Search actions, actor names, module names, record IDs or source IP addresses.
- Combine From/To dates, module, person and event type. Date bounds include the entire calendar day in the current branch's timezone; timestamps use that same timezone.
- Business activity shows readable domain events; Security shows recorded authentication events; API changes show the generic successful-change trail.
- Use 25/50/100 rows per page, Previous/Next, Refresh or Reset filters.
- Details shows the event and target IDs, timestamp, actor, source IP and metadata. Recorded `{from,to}` values appear as before/after chips. Missing metadata is identified explicitly.

History is read-only: the viewer has no edit/delete controls or endpoints. Filtering and pagination do not modify logs. Rows, module options and available actors are restricted to events in the current branch. A brand owner homed in another branch is still named when they appear in this branch's history. Credential-like metadata keys are redacted recursively before returning results.

## What the history means

This screen exposes existing audit collection; it does not reconstruct unrecorded past changes. Business events and their generic request event may both appear. The generic trail records successful writes and deliberately excludes bodies, failed requests and selected noisy routes. Authentication records include recorded sign-ins and failures; unknown-account events without a branch are not exposed in a branch viewer. This is not a complete web access log. Actor names and roles come from their current profile, not a historical snapshot. Deleted users remain identifiable by their recorded user ID but may have no resolvable profile.

## Verification and retained data

`backend/src/__tests__/db/audit.db.test.ts` uses the persistent **Reports QA** fixtures. It adds 31 labelled main-branch events and one isolation-branch sentinel with stable IDs; reruns do not duplicate or delete them. Local QA login remains `reports.qa.owner` / `ReportsQA!2026`. These are non-production test credentials.

The regression tests verify authentication/permissions on both endpoints, pagination without overlapping rows, module/person/text/type filters, inclusive local-midnight boundaries, malformed dates/ranges, empty results, branch isolation and nested credential redaction. In-app browser verification covers pagination, module filtering, search/empty/reset behavior and the before/after detail dialog. TypeScript checks and targeted frontend lint are part of validation.

Results on 2026-11-13: **39 backend suites / 415 tests passed**, including four audit regression cases. The frontend production Webpack build passed with `/audit` included. Backend/frontend TypeScript and targeted lint passed (the existing API navigation warnings remain). Redis was unavailable locally, so these checks exercised the development in-memory fallback, not production Redis.

Run locally from `backend/`:

```powershell
$env:RUN_DB_TESTS='1'
npx jest src/__tests__/db/audit.db.test.ts --runInBand
```

The QA seed refuses production. Preview servers are started only for testing and stopped afterward. Production Redis, logging durability/retention and deployed infrastructure require their own operational verification.
